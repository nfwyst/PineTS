// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from '../../../Context.class';
import { Series } from '../../../Series';
import { clonePineGraph } from '../../../core/clonePineGraph';
import { plainTickerId, splitTickerModifier, withTickerModifier } from '../../../tickerModifier';
import { formatTimeframe, parseTimeframe, timeframeSeconds } from '../../../timeframe';
import { findSecContextIdx } from '../utils/findSecContextIdx';
import { findLTFContextIdx } from '../utils/findLTFContextIdx';
import { isNamedArgsBag, parseArgsForPineParams } from '../../utils';
import { trackRequestContext, MAX_CALC_BARS } from '../../limits';
import { runSecondary } from '../utils/runSecondary';

const DEFAULT_HTF_WARMUP_BARS = 250;

// Pine signature (v5/v6):
//   request.security(symbol, timeframe, expression, gaps, lookahead, ignore_invalid_symbol, currency, calc_bars_count)
// Multiple sub-signatures cover progressive truncation when later positional args
// are absent — required so a single named arg (e.g. `lookahead = …`) doesn't
// invalidate matching just because trailing positional slots are unfilled.
const SECURITY_SIGNATURES = [
    ['symbol', 'timeframe', 'expression'],
    ['symbol', 'timeframe', 'expression', 'gaps'],
    ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead'],
    ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead', 'ignore_invalid_symbol'],
    ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead', 'ignore_invalid_symbol', 'currency'],
    ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead', 'ignore_invalid_symbol', 'currency', 'calc_bars_count'],
];
const SECURITY_TYPES = {
    symbol: 'series',
    timeframe: 'series',
    // `expression` accepts anything: primitive, tuple, object, Series, etc.
    expression: 'any',
    gaps: 'series',
    lookahead: 'series',
    ignore_invalid_symbol: 'series',
    currency: 'series',
    calc_bars_count: 'series',
};

/**
 * Detect a request.param wrapper tuple `[value, name]`.
 * Tuple shape: 2-element array whose [1] is a string param name.
 * (Tuple expressions like `[o, c]` are 2 elements but [1] is a Series, not a string.)
 */
function isParamTuple(v: any): v is [any, string] {
    return Array.isArray(v) && v.length === 2 && typeof v[1] === 'string';
}

/**
 * Unwrap a request.param `[value, name]` tuple into just the value, and capture
 * its name into `outNames` at the same index. The trailing named-arguments bag
 * also arrives as `[bag, name]` (the transpiler wraps every argument), but its
 * [1] is the bag wrapper's own name, not an expression the secondary records;
 * leave the bag itself a plain object so its slot can never be mistaken for a
 * real Pine tuple expression (e.g. `[close > open, syminfo.ticker]`).
 */
function unwrapParamTuples(rawArgs: any[], outNames: (string | undefined)[]): any[] {
    return rawArgs.map((a) => {
        if (isParamTuple(a) && !isNamedArgsBag(a[0])) {
            outNames.push(a[1]);
            return a[0];
        }
        outNames.push(undefined);
        return isParamTuple(a) ? a[0] : a;
    });
}

/**
 * Resolve the value of a parsed slot — handles values that are themselves
 * request.param wrapper tuples. This happens when the slot was filled via
 * the named-args bag (e.g. `lookahead: p54` where p54 is a wrapper).
 */
function resolveSlotValue(v: any): any {
    return isParamTuple(v) ? v[0] : v;
}

/**
 * Resolve the request.param name attached to the expression slot:
 *  - Positionally passed expressions are plain `[value, pN]` wrappers, so the
 *    positional argName (captured during unwrapping) is the secondary's name.
 *  - A named `expression = x` slot lives inside the named-arguments bag; the
 *    transpiler wraps x itself with request.param, so the parsed slot is
 *    `[value, innerParamName]` and that inner name is the one to read.
 */
function resolveSlotName(
    slotName: string,
    signatures: string[][],
    argNames: (string | undefined)[],
    parsedSlot: any,
): string | undefined {
    // Pick the longest signature — others are prefixes of it.
    const fullSig = signatures[signatures.length - 1];
    const idx = fullSig.indexOf(slotName);
    if (idx >= 0 && idx < argNames.length && argNames[idx] !== undefined) {
        return argNames[idx];
    }
    if (isParamTuple(parsedSlot)) return parsedSlot[1];
    return undefined;
}

/**
 * Resolve raw expression values that may contain helper objects
 * (TimeComponentHelper, TimeHelper, NAHelper, Series, etc.)
 * into their primitive values.  This is needed for same-timeframe
 * and secondary-context shortcuts where the expression isn't
 * re-evaluated through a full secondary run.
 */
function resolveExprValue(v: any): any {
    if (v == null || typeof v !== 'object') return v;
    // TimeComponentHelper, TimeHelper, NAHelper — expose __value
    if ('__value' in v) return v.__value;
    // Series — get current value
    if (v instanceof Series) return v.get(0);
    // Tuple array — resolve each element
    if (Array.isArray(v)) return v.map(resolveExprValue);
    return v;
}

function copyRequestedValue(value: unknown): unknown {
    const copy = clonePineGraph(value);
    return Array.isArray(copy) ? [copy] : copy;
}

export function security(context: any) {
    return async (...rawArgs: any[]) => {
        // Pine named-arg semantics: bind to the function's known signature by name,
        // not by position. The transpiler emits a trailing options object; we let
        // parseArgsForPineParams (which already handles `remaining_options`) merge
        // it into the right named slots. This is required so that calls like
        //   request.security(symbol, tf, expr, lookahead = barmerge.lookahead_on)
        // correctly set lookahead — previously the options bag was landing in the
        // `gaps` positional slot.
        const argNames: (string | undefined)[] = [];
        const args = unwrapParamTuples(rawArgs, argNames);
        const parsed = parseArgsForPineParams<any>(args, SECURITY_SIGNATURES, SECURITY_TYPES);

        // Slots filled via named-args bag may still contain wrapped [val, name] tuples
        // (e.g. `lookahead: p54` where p54 is a request.param wrapper). Unwrap each.
        const symbolSlot = resolveSlotValue(parsed.symbol);
        const timeframeSlot = resolveSlotValue(parsed.timeframe);
        const expressionSlot = resolveSlotValue(parsed.expression);
        const gapsSlot = resolveSlotValue(parsed.gaps);
        const lookaheadSlot = resolveSlotValue(parsed.lookahead);

        // Strip exchange prefix (e.g. "BINANCE:BTCUSDC" → "BTCUSDC") so the
        // provider receives a clean ticker when creating a secondary context. A
        // chart-type modifier suffix (";heikinashi") is NOT stripped here — it rides
        // through to the data source (an embedding host honors it; PineTS' own
        // providers strip it at their boundary).
        const rawSymbol = symbolSlot instanceof Series ? symbolSlot.get(0) : symbolSlot;
        // THE CHART TYPE IS THE TICKER: on a non-standard chart the context's own ticker is
        // extended ("SYM;heikinashi"), so the chart's modifier is parsed straight off it.
        const ctxNoPrefix = typeof context.tickerId === 'string' && context.tickerId.includes(':') ? context.tickerId.split(':')[1] : context.tickerId;
        const ctxParts = typeof ctxNoPrefix === 'string' ? splitTickerModifier(ctxNoPrefix) : { symbol: ctxNoPrefix, modifier: null };
        const chartModifier = ctxParts.modifier === 'standard' ? null : ctxParts.modifier;
        // Empty string "" means "use chart's symbol" (Pine Script spec) — i.e. the chart's own
        // ticker, modifier included.
        // An encoded tickerid (ticker.new / ticker.modify with a session or adjustment) is requested
        // as its symbol.
        const resolvedSymbol = plainTickerId(rawSymbol === '' ? context.tickerId : rawSymbol);
        const _symbol = typeof resolvedSymbol === 'string' && resolvedSymbol.includes(':') ? resolvedSymbol.split(':')[1] : resolvedSymbol;
        const rawTimeframe = timeframeSlot instanceof Series ? timeframeSlot.get(0) : timeframeSlot;
        // Empty string "" means "use chart's timeframe" (Pine Script spec)
        const _timeframe = rawTimeframe === '' ? context.timeframe : (typeof rawTimeframe === 'string' ? rawTimeframe : String(rawTimeframe ?? ''));
        const _expression = expressionSlot;
        // Cache key uses the request.param name attached to the expression wrapper.
        // It identifies the expression's call-site so that secContext.params lookup
        // can find the per-bar evaluated values.
        const _expression_name = resolveSlotName('expression', SECURITY_SIGNATURES, argNames, parsed.expression);
        const _gapsRaw = gapsSlot;
        const _lookaheadRaw = lookaheadSlot;
        // barmerge.gaps_off/on and barmerge.lookahead_off/on are string enums ('gaps_off', 'gaps_on', etc.)
        // Convert to boolean for correct behavior in findLTFContextIdx/findSecContextIdx
        const _gaps = _gapsRaw === true || _gapsRaw === 'gaps_on';
        const _lookahead = _lookaheadRaw === true || _lookaheadRaw === 'lookahead_on';
        const _ignore_invalid_symbol = resolveSlotValue(parsed.ignore_invalid_symbol) === true;
        // calc_bars_count gives the secondary the requested historical depth at the
        // security TF — important when chart TF is much smaller than security TF
        // (e.g. 15m chart, daily security where 500 chart bars cover only ~5 daily bars).
        const _calc_bars_count = (() => {
            const v = resolveSlotValue(parsed.calc_bars_count);
            return typeof v === 'number' && v > 0 ? Math.min(v, MAX_CALC_BARS) : undefined;
        })();

        // CRITICAL: Prevent infinite recursion in secondary contexts
        // If this is a secondary context (created by another request.security),
        // just return the expression value directly without creating another context
        if (context.isSecondaryContext) {
            const resolved = resolveExprValue(_expression);
            return copyRequestedValue(resolved);
        }

        const ctxTimeframe = parseTimeframe(context.timeframe);
        const reqTimeframe = parseTimeframe(_timeframe);

        if (!ctxTimeframe || !reqTimeframe) {
            throw new Error(`Invalid value of the 'timeframe' argument ('${reqTimeframe ? context.timeframe : _timeframe}') in the 'security' function.`);
        }
        const ctxSeconds = timeframeSeconds(ctxTimeframe);
        const reqSeconds = timeframeSeconds(reqTimeframe);

        // Same-timeframe shortcut is only valid when the requested symbol is the
        // chart's symbol — at that point the secondary would just re-evaluate the
        // same data. If the symbol differs, the shortcut would return the chart's
        // expression verbatim (e.g. BTC close) for a request meant to fetch a
        // different ticker (e.g. ETH close). Fall through to the secondary-context
        // path (line ~280+) which builds a fresh PineTS instance for `_symbol`.
        // "Same" is also CHART-TYPE aware: the chart's data is its chart-typed view,
        // so on a Heikin-Ashi chart only "SYM;heikinashi" is the same series — a plain
        // "SYM" (e.g. via ticker.standard()) must fetch STANDARD data through a
        // secondary context, and vice versa on a standard chart.
        const reqParts = typeof _symbol === 'string' ? splitTickerModifier(_symbol) : { symbol: _symbol, modifier: null };
        const reqModifier = reqParts.modifier === 'standard' ? null : reqParts.modifier; // ";standard" ≡ no modifier
        const isSameSymbol = !_symbol || _symbol === '' || (reqParts.symbol === ctxParts.symbol && reqModifier === chartModifier);

        // Same length is not enough: "7D" bars follow the yearly day grid, "W" bars start on Mondays.
        const isSameTimeframe = formatTimeframe(ctxTimeframe) === formatTimeframe(reqTimeframe);
        if (Array.isArray(context.source) && !(isSameSymbol && isSameTimeframe)) {
            throw new Error(
                `request.security needs a market data provider to load ${_symbol || context.tickerId || 'the chart symbol'} "${_timeframe}": ` +
                `an array data source only holds the chart's own symbol and timeframe`,
            );
        }
        if (isSameTimeframe && isSameSymbol) {
            // Resolve any helper objects (TimeComponentHelper, NAHelper, Series, etc.)
            // in the expression that haven't been extracted to their primitive values yet.
            const resolved = resolveExprValue(_expression);
            return copyRequestedValue(resolved);
        }

        const isLTF = ctxSeconds > reqSeconds;

        const myOpenTime = Series.from(context.data.openTime).get(0);
        const myCloseTime = Series.from(context.data.closeTime).get(0);

        // On the realtime (live) bar, lookahead_off has no effect per TradingView behavior:
        // the current developing HTF values are returned instead of the previous completed bar.
        // A bar is realtime only if it's the last bar AND its close time is in the future
        // (i.e., the bar hasn't closed yet). In backtesting mode with a fixed eDate, all bars
        // are historical even the last one, so isRealtime stays false.
        const isRealtime = context.idx === context.length - 1 && myCloseTime > Date.now();

        // Cache key must be unique per symbol+timeframe+expression to avoid collisions
        const cacheKey = `${_symbol}_${_timeframe}_${_expression_name}`;
        // Cache key for tracking previous bar index (for gaps detection)
        const gapCacheKey = `${cacheKey}_prevIdx`;

        if (context.cache[cacheKey]) {
            const cached = context.cache[cacheKey];
            // A failed ignored request stays na on later bars without retrying.
            if (cached.failed) return NaN;

            // Refresh secondary context when main context's data has changed (streaming mode)
            if (context.dataVersion > cached.dataVersion) {
                await cached.pineTS.updateTail(cached.context);
                cached.dataVersion = context.dataVersion;
            }

            const secContext = cached.context;
            const secContextIdx = isLTF
                ? findLTFContextIdx(
                      myOpenTime,
                      myCloseTime,
                      secContext.data.openTime.data,
                      secContext.data.closeTime.data,
                      _lookahead,
                      context.eDate,
                      _gaps
                  )
                : findSecContextIdx(myOpenTime, myCloseTime, secContext.data.openTime.data, secContext.data.closeTime.data, _lookahead, isRealtime);

            if (secContextIdx == -1) {
                return NaN;
            }

            const values = secContext.params[_expression_name];
            if (values === undefined) return NaN;
            const value = values[secContextIdx];

            // Handle gaps for HTF (Higher Timeframe)
            if (!isLTF && _gaps) {
                const prevIdx = context.cache[gapCacheKey];

                // gaps=true: Only show value when the HTF bar index changes
                // - lookahead=false: Show on transition (first bar with new index)
                // - lookahead=true: Show on transition (first bar with new index)
                // Both behave the same: show only when index changes, otherwise NaN

                if (prevIdx !== undefined && prevIdx === secContextIdx) {
                    // Same index as previous call = no change = NaN
                    return NaN;
                }

                // Index changed (or first call) - update and return value
                context.cache[gapCacheKey] = secContextIdx;
                return copyRequestedValue(value);
            }

            return copyRequestedValue(value);
        }

        // Recursive indicators in an HTF secondary need history measured in that
        // requested timeframe. This is an internal warmup heuristic, not a public
        // request limit. An explicit calc_bars_count remains provider-owned.
        const htfWarmupBars = DEFAULT_HTF_WARMUP_BARS;
        const buffer = isLTF
            ? Math.max(1000 * 60 * 60 * 24 * 30, 2 * reqSeconds * 1000)
            : reqSeconds * 1000 * htfWarmupBars;

        // Determine start date for secondary context.
        // Use context.sDate if available, otherwise derive from the earliest bar's
        // openTime to ensure the secondary context covers the same time range as the main chart.
        //
        const effectiveSDate = context.sDate
            || (context.marketData?.length > 0 ? context.marketData[0].openTime : undefined);
        const boundedBuffer = effectiveSDate === undefined ? buffer : Math.min(buffer, effectiveSDate);
        const adjustedSDate = _calc_bars_count
            ? undefined
            : (effectiveSDate !== undefined ? effectiveSDate - boundedBuffer : undefined);

        // Determine end date for secondary context.
        //
        // The secondary's data range must align with the chart's actual data range so
        // that `barstate.islast` in the secondary fires at the same temporal point as
        // the chart's `barstate.islast`. This matters for scripts that gate their
        // expression on barstate.islast (e.g. `barstate.islast ? data : na`) and rely
        // on lookahead to read it from the security at the chart's last bar.
        //
        // Use the chart's actual lastBarCloseTime (NOT eDate, which can be a future
        // ceiling that the chart's data hasn't reached yet, and NOT a generous buffer,
        // which would extend the secondary into future bars where barstate.islast
        // would fire AFTER the chart's last temporal point).
        //
        // Falls back to context.eDate or Date.now() if marketData isn't populated yet.
        const lastBarCloseTime = context.marketData?.length > 0
            ? context.marketData[context.marketData.length - 1].closeTime
            : 0;
        const secEDate = lastBarCloseTime || context.eDate || Date.now();

        // Count this new secondary context against the per-run request budget
        // (one provider fetch on the host's API key); stops an uncapped fan-out,
        // e.g. a per-bar-varying symbol, from draining the host's provider quota.
        trackRequestContext(context, 'request.security');

        const pineTS = context.createSecondaryPineTS(
            context.source,
            _symbol,
            _timeframe,
            _calc_bars_count,
            adjustedSDate,
            secEDate,
            context.hostOptions,
        );

        // Mark as secondary context to prevent infinite recursion
        pineTS.markAsSecondary();

        try {
            await pineTS.ready();
        } catch (error) {
            if (!_ignore_invalid_symbol) throw error;
            const message = error instanceof Error ? error.message : String(error);
            context.cache[cacheKey] = { failed: true };
            context.warn(`request.security(${_symbol}, ${_timeframe}) returns na: ${message}`, 'request.security');
            return NaN;
        }
        const secContext: Context = await runSecondary(context, pineTS, _expression_name);

        context.cache[cacheKey] = { pineTS, context: secContext, dataVersion: context.dataVersion };

        const secContextIdx = isLTF
            ? findLTFContextIdx(
                  myOpenTime,
                  myCloseTime,
                  secContext.data.openTime.data,
                  secContext.data.closeTime.data,
                  _lookahead,
                  context.eDate,
                  _gaps
              )
            : findSecContextIdx(myOpenTime, myCloseTime, secContext.data.openTime.data, secContext.data.closeTime.data, _lookahead, isRealtime);

        if (secContextIdx == -1) {
            return NaN;
        }

        const values = secContext.params[_expression_name];
        if (values === undefined) return NaN;
        const value = values[secContextIdx];

        // Handle gaps for HTF (Higher Timeframe) - First call
        if (!isLTF && _gaps) {
            // First call: Store index and return NaN (no previous state to compare)
            context.cache[gapCacheKey] = secContextIdx;
            return NaN;
        }

        return copyRequestedValue(value);
    };
}

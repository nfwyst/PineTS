// SPDX-License-Identifier: AGPL-3.0-only

import type { PineTS } from '../../../PineTS.class';
import { Series } from '../../../Series';
import { formatTimeframe, parseTimeframe, timeframeSeconds } from '../../../timeframe';
import { plainTickerId, splitTickerModifier } from '../../../tickerModifier';
import { PineArrayObject, PineArrayType } from '../../array/PineArrayObject';
import { PineTypeObject } from '../../PineTypeObject';
import { isNamedArgsBag, parseArgsForPineParams } from '../../utils';
import { trackRequestContext, MAX_CALC_BARS } from '../../limits';
import { runSecondary } from '../utils/runSecondary';

// Pine signature (v5/v6):
//   request.security_lower_tf(symbol, timeframe, expression, ignore_invalid_symbol, currency, ignore_invalid_timeframe, calc_bars_count)
// Note: no `gaps`/`lookahead` for security_lower_tf — different surface than security.
const SECURITY_LOWER_TF_SIGNATURES = [
    ['symbol', 'timeframe', 'expression'],
    ['symbol', 'timeframe', 'expression', 'ignore_invalid_symbol'],
    ['symbol', 'timeframe', 'expression', 'ignore_invalid_symbol', 'currency'],
    ['symbol', 'timeframe', 'expression', 'ignore_invalid_symbol', 'currency', 'ignore_invalid_timeframe'],
    ['symbol', 'timeframe', 'expression', 'ignore_invalid_symbol', 'currency', 'ignore_invalid_timeframe', 'calc_bars_count'],
];
const SECURITY_LOWER_TF_TYPES = {
    symbol: 'series',
    timeframe: 'series',
    expression: 'any',
    ignore_invalid_symbol: 'series',
    currency: 'series',
    ignore_invalid_timeframe: 'series',
    calc_bars_count: 'series',
};

function isParamTuple(v: any): v is [any, string] {
    return Array.isArray(v) && v.length === 2 && typeof v[1] === 'string';
}

// The trailing named-arguments bag also arrives wrapped in a param tuple, but
// its [1] is the bag wrapper name, not an expression the secondary records;
// unwrap it to a plain object so a real Pine tuple expression (e.g.
// `[close > open, syminfo.ticker]`) is never confused with the bag.
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

function resolveSlotValue(v: any): any {
    return isParamTuple(v) ? v[0] : v;
}

function resolveSlotName(
    slotName: string,
    signatures: string[][],
    argNames: (string | undefined)[],
    parsedSlot: any,
): string | undefined {
    const fullSig = signatures[signatures.length - 1];
    const idx = fullSig.indexOf(slotName);
    if (idx >= 0 && idx < argNames.length && argNames[idx] !== undefined) {
        return argNames[idx];
    }
    if (isParamTuple(parsedSlot)) return parsedSlot[1];
    return undefined;
}

/**
 * Detect the PineArrayType from a runtime value.
 */
function detectArrayType(value: any): PineArrayType {
    if (typeof value === 'number') return PineArrayType.float;
    if (typeof value === 'boolean') return PineArrayType.bool;
    if (typeof value === 'string') return PineArrayType.string;
    return PineArrayType.any;
}

/**
 * Names of price/time builtins on `context.data` that the LTF fast path
 * can resolve directly from the secondary's market-data candles, without
 * having to run a single line of the user script in the secondary
 * context. Maps the Pine builtin name to the candle field it reads.
 */
const BUILTIN_TO_CANDLE_FIELD: Record<string, (c: any) => any> = {
    open:    (c) => c.open,
    high:    (c) => c.high,
    low:     (c) => c.low,
    close:   (c) => c.close,
    volume:  (c) => c.volume,
    hl2:     (c) => (c.high + c.low) / 2,
    hlc3:    (c) => (c.high + c.low + c.close) / 3,
    ohlc4:   (c) => (c.high + c.low + c.open + c.close) / 4,
    hlcc4:   (c) => (c.high + c.low + c.close + c.close) / 4,
    time:    (c) => c.openTime,
    openTime:  (c) => c.openTime,
    closeTime: (c) => c.closeTime,
};

/**
 * If `series` is one of `context.data.<builtin>` (by reference identity),
 * return the builtin name. Otherwise null. Reference equality is the
 * right test because every Pine Script's `close`/`high`/etc. resolves
 * to the same Series instance held on `context.data` for the lifetime
 * of the script (see PineTS.class.ts `_initializeContext`).
 */
function builtinNameOf(series: any, context: any): string | null {
    if (!(series instanceof Series)) return null;
    const data = context?.data;
    if (!data) return null;
    for (const name of Object.keys(BUILTIN_TO_CANDLE_FIELD)) {
        if (series === data[name]) return name;
    }
    return null;
}

/**
 * Descriptor returned by the pure-builtin detector. Drives the shape of
 * the values written into the synthesised secondary context's
 * `params[expression_name]`.
 *   - `kind: 'series'` — single bare builtin (e.g. `close`); each LTF
 *     bar produces one scalar.
 *   - `kind: 'tuple'`  — array of bare builtins (e.g. `[open, …, volume]`);
 *     each LTF bar produces a 5-tuple of scalars.
 *   - `kind: 'udt'`    — UDT instance whose ALL field defaults are bare
 *     builtins (e.g. `type candle { float o = open; float h = high; …}`);
 *     each LTF bar produces a fresh PineTypeObject of that type, fields
 *     populated from the candle.
 */
type BuiltinExpr =
    | { kind: 'series'; builtinNames: [string] }
    | { kind: 'tuple'; builtinNames: string[] }
    | { kind: 'udt'; builtinNames: string[]; fieldNames: string[]; udt: any };

/**
 * UDT detector — succeeds when ALL of the type's fields have bare-
 * builtin defaults (Series identity preserved on the factory's
 * `_fieldDefaults` map by Core.ts `Type()`). A field with no default
 * or a non-builtin default disqualifies the whole UDT.
 */
function detectPureBuiltinUdt(source: any, context: any): BuiltinExpr | null {
    // `let mycandle = candle.new()` stores the UDT instance inside a
    // Series slot (`$.let.glb1_mycandle`); when passed as the third
    // argument to `request.security_lower_tf`, request.param sees the
    // Series itself, not the inner PineTypeObject. Unwrap to peek at
    // the current bar's instance.
    if (source instanceof Series) {
        source = source.get(0);
    }
    if (!(source instanceof PineTypeObject)) return null;
    const udt = source._udt;
    if (!udt || !udt._fieldDefaults || !Array.isArray(udt._definitionKeys)) return null;
    const fieldNames: string[] = udt._definitionKeys;
    if (fieldNames.length === 0) return null;
    const builtinNames: string[] = [];
    for (const f of fieldNames) {
        if (!(f in udt._fieldDefaults)) return null;
        const def = udt._fieldDefaults[f];
        const name = builtinNameOf(def, context);
        if (name === null) return null;
        builtinNames.push(name);
    }
    return { kind: 'udt', builtinNames, fieldNames, udt };
}

/**
 * Inspect the original (pre-extraction) `expression` source recorded by
 * `request.param` and return a descriptor of its fast-path shape, or
 * null if the expression isn't a pure-builtin form. Three cases handled:
 *   - bare Series (e.g. `close`) → kind 'series'
 *   - tuple of bare Series (e.g. `[open, …]`) → kind 'tuple'
 *   - UDT whose every field default is a bare Series → kind 'udt'
 */
function detectPureBuiltinExpression(originalSource: any, context: any): BuiltinExpr | null {
    if (originalSource === undefined) return null;
    if (Array.isArray(originalSource)) {
        const names: string[] = [];
        for (const elem of originalSource) {
            const n = builtinNameOf(elem, context);
            if (n === null) return null;
            names.push(n);
        }
        return names.length > 0 ? { kind: 'tuple', builtinNames: names } : null;
    }
    const single = builtinNameOf(originalSource, context);
    if (single !== null) return { kind: 'series', builtinNames: [single] };
    return detectPureBuiltinUdt(originalSource, context);
}

/**
 * Fast path: build a minimal "secondary context" object from an already
 * loaded PineTS instance. Its shape
 * matches the subset of fields the downstream LTF aggregation reads —
 * `data.openTime.data`, `data.closeTime.data`, and
 * `params[expression_name]`. No user script runs in the secondary; the
 * loaded LTF candles are shredded into their requested builtin fields.
 *
 * The shape of `values[i]` (each LTF bar's contribution to the
 * captured expression) follows the descriptor:
 *   - 'series' → scalar
 *   - 'tuple'  → array of scalars
 *   - 'udt'    → fresh `PineTypeObject` whose fields are populated from
 *                that LTF candle (matching what the slow path would
 *                have produced when running `MyType.new()` per LTF bar
 *                with builtin defaults resolved against the secondary's
 *                `context.data`).
 */
function buildFastBuiltinSecContext(
    context: any,
    pineTS: PineTS,
    expr: BuiltinExpr,
    expressionName: string,
) {
    // Use the openTime/closeTime arrays already prepared by the
    // PineTS instance — these have the closeTime fallback (openTime +
    // timeframe duration) applied for providers that omit closeTime.
    // Reading raw `marketData[i].closeTime` would diverge from the
    // slow-path secondary, breaking the bar-grouping check downstream.
    const openTimes = (pineTS as any).openTime as number[];
    const closeTimes = (pineTS as any).closeTime as number[];
    const candles = (pineTS as any).data as any[];

    const fieldGetters = expr.builtinNames.map((n) => BUILTIN_TO_CANDLE_FIELD[n]);

    let values: any[];
    if (expr.kind === 'series') {
        values = candles.map((c) => fieldGetters[0](c));
    } else if (expr.kind === 'tuple') {
        values = candles.map((c) => fieldGetters.map((g) => g(c)));
    } else {
        // UDT: synthesise a PineTypeObject per LTF bar. We bypass
        // `udt.new(...)` and construct directly so the fields are
        // populated from the LTF candle (not from the primary
        // context's `context.data.<builtin>`, which is what the
        // factory's defaults would resolve to).
        const fieldNames = (expr as any).fieldNames as string[];
        const udt = (expr as any).udt;
        values = candles.map((c) => {
            const fields: Record<string, any> = {};
            for (let i = 0; i < fieldNames.length; i++) {
                fields[fieldNames[i]] = fieldGetters[i](c);
            }
            return new PineTypeObject(fields, context, udt);
        });
    }

    return {
        data: {
            openTime: { data: openTimes },
            closeTime: { data: closeTimes },
        },
        params: { [expressionName]: values },
    };
}

/**
 * Requests the results of an expression from a specified symbol on a timeframe lower than or equal to the chart's timeframe.
 * It returns an array containing one element for each lower-timeframe bar within the chart bar.
 * On a 5-minute chart, requesting data using a timeframe argument of "1" typically returns an array with five elements representing
 * the value of the expression on each 1-minute bar, ordered by time with the earliest value first.
 * @param context
 * @returns
 */
export function security_lower_tf(context: any) {
    return async (...rawArgs: any[]) => {
        // Same Pine named-args resolution as request.security — bind by name to the
        // documented signature, with the trailing options bag merged into named slots.
        const argNames: (string | undefined)[] = [];
        const args = unwrapParamTuples(rawArgs, argNames);
        const parsed = parseArgsForPineParams<any>(args, SECURITY_LOWER_TF_SIGNATURES, SECURITY_LOWER_TF_TYPES);

        const symbolSlot = resolveSlotValue(parsed.symbol);
        const timeframeSlot = resolveSlotValue(parsed.timeframe);
        const expressionSlot = resolveSlotValue(parsed.expression);

        const rawSymbol = symbolSlot instanceof Series ? symbolSlot.get(0) : symbolSlot;
        const chartTicker = typeof context.tickerId === 'string' && context.tickerId.includes(':') ? context.tickerId.split(':')[1] : context.tickerId;
        const chartParts = typeof chartTicker === 'string' ? splitTickerModifier(chartTicker) : { symbol: chartTicker, modifier: null };
        const chartModifier = chartParts.modifier === 'standard' ? null : chartParts.modifier;
        // Empty string "" means "use chart's symbol" (Pine Script spec) — i.e. the chart's own
        // ticker. THE CHART TYPE IS THE TICKER: on a non-standard chart it already carries the
        // ";heikinashi" modifier, which rides through to the data source (PineTS' own providers
        // strip it at their boundary).
        // An encoded tickerid (ticker.new / ticker.modify with a session or adjustment) is requested
        // as its symbol.
        const resolvedSymbol = plainTickerId(rawSymbol === '' ? context.tickerId : rawSymbol);
        const _symbol = typeof resolvedSymbol === 'string' && resolvedSymbol.includes(':') ? resolvedSymbol.split(':')[1] : resolvedSymbol;
        const requestedParts = typeof _symbol === 'string' ? splitTickerModifier(_symbol) : { symbol: _symbol, modifier: null };
        const requestedModifier = requestedParts.modifier === 'standard' ? null : requestedParts.modifier;
        const isSameSymbol = !_symbol || _symbol === '' || (requestedParts.symbol === chartParts.symbol && requestedModifier === chartModifier);
        const rawTimeframe = timeframeSlot instanceof Series ? timeframeSlot.get(0) : timeframeSlot;
        // Empty string "" means "use chart's timeframe" (Pine Script spec)
        const _timeframe = rawTimeframe === '' ? context.timeframe : (typeof rawTimeframe === 'string' ? rawTimeframe : String(rawTimeframe ?? ''));
        const _expression = expressionSlot;
        const _expression_name = resolveSlotName('expression', SECURITY_LOWER_TF_SIGNATURES, argNames, parsed.expression);
        const recordedShape = context._requestParamShapes?.[_expression_name];
        const tupleArity = recordedShape === undefined
            ? (Array.isArray(_expression) ? _expression.length : undefined)
            : (recordedShape.kind === 'tuple' ? recordedShape.arity : undefined);
        const expressionTypes = Array.isArray(_expression)
            ? _expression.map(detectArrayType)
            : [detectArrayType(_expression)];
        const emptyExpressionResult = () => {
            if (tupleArity !== undefined) {
                return [Array.from(
                    { length: tupleArity },
                    (_, index) => new PineArrayObject([], expressionTypes[index] ?? PineArrayType.any, context),
                )];
            }
            return new PineArrayObject([], expressionTypes[0] ?? PineArrayType.any, context);
        };
        const _ignore_invalid_symbol = resolveSlotValue(parsed.ignore_invalid_symbol) === true;
        const _ignore_invalid_timeframe = resolveSlotValue(parsed.ignore_invalid_timeframe);
        const _calc_bars_count = (() => {
            const v = resolveSlotValue(parsed.calc_bars_count);
            return typeof v === 'number' && v > 0 ? Math.min(v, MAX_CALC_BARS) : undefined;
        })();

        // CRITICAL: Prevent infinite recursion in secondary contexts
        // Still wrap in PineArrayObject so array.size() etc. work in the secondary script
        if (context.isSecondaryContext) {
            if (Array.isArray(_expression)) {
                const arrays = _expression.map((v: any) =>
                    new PineArrayObject([v], detectArrayType(v), context)
                );
                return [arrays];
            } else {
                return new PineArrayObject([_expression], detectArrayType(_expression), context);
            }
        }

        const ctxTimeframe = parseTimeframe(context.timeframe);
        const reqTimeframe = parseTimeframe(_timeframe);

        if (!ctxTimeframe || !reqTimeframe) {
            throw new Error(`Invalid value of the 'timeframe' argument ('${reqTimeframe ? context.timeframe : _timeframe}') in the 'security_lower_tf' function.`);
        }
        const ctxSeconds = timeframeSeconds(ctxTimeframe);
        const reqSeconds = timeframeSeconds(reqTimeframe);

        if (reqSeconds > ctxSeconds) {
            if (_ignore_invalid_timeframe) return emptyExpressionResult();
            throw new Error(`Timeframe ${_timeframe} is not lower than or equal to chart timeframe ${context.timeframe}`);
        }

        const isSameTimeframe = formatTimeframe(reqTimeframe) === formatTimeframe(ctxTimeframe);
        if (Array.isArray(context.source) && !(isSameSymbol && isSameTimeframe)) {
            throw new Error(
                `request.security_lower_tf needs a market data provider to load ${_symbol || context.tickerId || 'the chart symbol'} "${_timeframe}": ` +
                `an array data source only holds the chart's own symbol and timeframe`,
            );
        }

        if (isSameTimeframe && isSameSymbol) {
            if (Array.isArray(_expression)) {
                // Tuple: each element becomes a 1-element PineArrayObject
                const arrays = _expression.map((v: any) =>
                    new PineArrayObject([v], detectArrayType(v), context)
                );
                return [arrays]; // 2D for tuple destructuring
            } else {
                return new PineArrayObject([_expression], detectArrayType(_expression), context);
            }
        }

        const cacheKey = `${_symbol}_${_timeframe}_${_expression_name}_lower`;
        const effectiveSDate = context.sDate
            || (context.marketData?.length > 0 ? context.marketData[0].openTime : undefined);
        const lastBarCloseTime = context.marketData?.length > 0
            ? context.marketData[context.marketData.length - 1].closeTime
            : 0;
        const secEDate = lastBarCloseTime || context.eDate || Date.now();
        const createSecondary = () => {
            const pineTS = context.createSecondaryPineTS(
                context.source,
                _symbol,
                _timeframe,
                _calc_bars_count,
                effectiveSDate,
                secEDate,
                context.hostOptions,
            );
            pineTS.markAsSecondary();
            return pineTS;
        };
        const handleIgnoredLoadFailure = (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            context.cache[cacheKey] = { failed: true };
            context.warn(
                `request.security_lower_tf(${_symbol}, ${_timeframe}) returns an empty array: ${message}`,
                'request.security_lower_tf',
            );
            return emptyExpressionResult();
        };

        // Fast path: when the captured expression is a bare price/time
        // builtin Series (or a tuple of them — e.g. `[open, high, low,
        // close, volume]`), the secondary doesn't need to run a single
        // line of the user script. Every LTF bar's value of `close` IS
        // the LTF candle's `close`. We fetch the candles once and build
        // the secondary context's `params[expression_name]` directly.
        // This is what dominates request.security_lower_tf perf for the
        // ~90% of indicators that pull raw OHLCV at 1m (footprint,
        // volume profile, structural-leg-profiler, …).
        const originalSource = context._requestParamSources?.[_expression_name];
        const builtinExpr = detectPureBuiltinExpression(originalSource, context);

        if (!context.cache[cacheKey]) {
            // Count this new secondary context against the per-run request budget
            // (fast or slow path, each is a provider fetch on the host's key) so an
            // uncapped fan-out cannot drain the host operator's provider quota.
            trackRequestContext(context, 'request.security_lower_tf');
            const pineTS = createSecondary();
            try {
                await pineTS.ready();
            } catch (error: unknown) {
                if (!_ignore_invalid_symbol) throw error;
                return handleIgnoredLoadFailure(error);
            }

            if (builtinExpr !== null) {
                // ── Fast path ────────────────────────────────────────
                const fastSecContext = buildFastBuiltinSecContext(context, pineTS, builtinExpr, _expression_name);
                context.cache[cacheKey] = {
                    pineTS: null,
                    context: fastSecContext,
                    dataVersion: context.dataVersion,
                    _fastPath: true,
                    _fastPathArgs: { builtinExpr },
                };
            } else {
                // ── Slow path: run the user script in a secondary ──
                // For request.security_lower_tf the secondary's data window
                // is bounded by the chart's own window — every LTF bar that
                // contributes to a chart bar falls inside that chart bar's
                // [openTime, closeTime]. Adding a fixed historical buffer
                // (the way security.ts does for higher-timeframe warmup)
                // blows up bar counts dramatically: a 30-day buffer at 1-
                // minute LTF forces the secondary to iterate ~43,200 extra
                // bars before the main loop can advance past bar 0, which
                // manifests as a multi-minute hang on small charts (e.g.
                // 50 bars on 5m). Use the chart's earliest openTime.
                const secContext = await runSecondary(context, pineTS, _expression_name);
                context.cache[cacheKey] = { pineTS, context: secContext, dataVersion: context.dataVersion };
            }
        }

        const cached = context.cache[cacheKey];
        if (cached.failed) return emptyExpressionResult();

        // Refresh secondary context when main context's data has changed (streaming mode)
        if (context.dataVersion > cached.dataVersion) {
            if (cached._fastPath) {
                // Re-fetch and rebuild the fast-path cache entry — the
                // loading PineTS instance is not retained for updateTail().
                const refreshedPineTS = createSecondary();
                try {
                    await refreshedPineTS.ready();
                } catch (error: unknown) {
                    if (!_ignore_invalid_symbol) throw error;
                    return handleIgnoredLoadFailure(error);
                }
                const refreshed = buildFastBuiltinSecContext(
                    context,
                    refreshedPineTS,
                    cached._fastPathArgs.builtinExpr,
                    _expression_name,
                );
                cached.context = refreshed;
                cached.dataVersion = context.dataVersion;
            } else {
                await cached.pineTS.updateTail(cached.context);
                cached.dataVersion = context.dataVersion;
            }
        }

        const secContext = cached.context;
        
        const myOpenTime = Series.from(context.data.openTime).get(0);
        const myCloseTime = Series.from(context.data.closeTime).get(0);

        const secOpenTimes = secContext.data.openTime.data;
        const secCloseTimes = secContext.data.closeTime.data;
        const secValues = secContext.params[_expression_name];
        
        // If expression was not evaluated in secondary context (e.g. conditional execution), return empty array
        if (!secValues) {
            return emptyExpressionResult();
        }

        const result: any[] = [];

        for (let i = 0; i < secOpenTimes.length; i++) {
            const sOpen = secOpenTimes[i];
            const sClose = secCloseTimes[i];

            // Optimization: skip bars before our window
            if (sClose <= myOpenTime) continue;

            // Stop if we passed our window
            if (sOpen >= myCloseTime) break;

            // Overlap check: The LTF bar must overlap with the HTF bar interval [myOpenTime, myCloseTime)
            // Pine Script security_lower_tf returns all LTF bars that "belong" to the HTF bar.
            // This typically means any LTF bar whose time is >= HTF openTime and < HTF closeTime.

            // If sOpen >= myOpenTime and sOpen < myCloseTime, it belongs to this bar.
            if (sOpen >= myOpenTime && sOpen < myCloseTime) {
                result.push(secValues[i]);
            }
        }

        if (tupleArity !== undefined) {
            // Transpose: per-bar tuples [[o1,c1],[o2,c2],...] → per-element arrays [PAO([o1,o2,...]), PAO([c1,c2,...])]
            const transposed = [];
            for (let e = 0; e < tupleArity; e++) {
                const columnValues = result.map(barTuple => barTuple[e]);
                const type = columnValues.length > 0
                    ? detectArrayType(columnValues[0])
                    : (expressionTypes[e] ?? PineArrayType.any);
                transposed.push(new PineArrayObject(columnValues, type, context));
            }
            return [transposed]; // 2D for tuple destructuring
        } else {
            // Scalar: single array of values wrapped in PineArrayObject
            const type = result.length > 0
                ? detectArrayType(result[0])
                : (expressionTypes[0] ?? PineArrayType.any);
            return new PineArrayObject(result, type, context);
        }
    };
}

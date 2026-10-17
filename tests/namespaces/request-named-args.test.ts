// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression: named arguments to request.security() / request.security_lower_tf()
 * must arrive by value, exactly like the equivalent literal / positional form.
 *
 * Pine binds a named argument (`calc_bars_count = N`, `lookahead = la`,
 * `expression = x`) to its current value; the transpiler used to leave plain
 * user-variable identifiers inside the named-arguments object unwrapped, so a
 * Series object reached the runtime:
 *   - `calc_bars_count = N` was silently dropped (fell back to the 250-bar
 *     warmup window), unlike `calc_bars_count = 50`;
 *   - `lookahead = la` behaved like lookahead_off, unlike the literal enum;
 *   - `expression = x` could not be read back from a different-timeframe
 *     secondary (no request.param name attached).
 *
 * Expected values below are self-derived (a const variable equals its literal;
 * a variable holding the enum equals the literal enum; an expression alias
 * equals the expression passed positionally), never captured from PineTS output.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { IProvider, ISymbolInfo } from '../../src/marketData/IProvider';
import type { Kline } from '../../src/marketData/types';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const DAY_START = Date.UTC(2030, 0, 8);

type MarketRequest = {
    readonly timeframe: string;
    readonly limit?: number;
    readonly sDate?: number;
    readonly returnedCount: number;
};

function makeBar(openTime: number, stepMs: number, close: number): Kline {
    return {
        openTime,
        closeTime: openTime + stepMs - 1,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

class RecordingProvider implements IProvider {
    readonly requests: MarketRequest[] = [];

    constructor(private readonly barsByTimeframe: Readonly<Record<string, readonly Kline[]>>) {}

    async getMarketData(
        _tickerId: string,
        timeframe: string,
        limit?: number,
        sDate?: number,
    ): Promise<Kline[]> {
        const available = this.barsByTimeframe[timeframe] ?? [];
        const filtered = available.filter((bar) => sDate === undefined || bar.openTime >= sDate);
        const selected = limit === undefined ? filtered : filtered.slice(-limit);
        this.requests.push({ timeframe, limit, sDate, returnedCount: selected.length });
        return selected.map((bar) => ({ ...bar }));
    }

    getSymbolInfo(): Promise<ISymbolInfo> {
        return Provider.Mock.getSymbolInfo('BTCUSDT');
    }

    configure(): void {}

    requestFor(timeframe: string): MarketRequest {
        const match = this.requests.find((request) => request.timeframe === timeframe);
        if (!match) throw new Error(`No provider request recorded for ${timeframe}`);
        return match;
    }
}

function dailyProviderBars(): Record<string, readonly Kline[]> {
    // 60 hourly chart bars covering 2.5 days, plus clean daily bars through
    // the last chart day (the 00:00 chart bar must have its own daily bar to
    // distinguish lookahead_on from lookahead_off mapping).
    const chart = Array.from({ length: 60 }, (_, index) =>
        makeBar(DAY_START - HOUR + index * HOUR, HOUR, 100 + index),
    );
    const daily = Array.from({ length: 401 }, (_, index) =>
        makeBar(DAY_START - 400 * DAY + index * DAY, DAY, 10 * (index + 1)),
    );
    return { 60: chart, D: daily, 1: [] };
}

async function runWith(provider: IProvider, code: string, chart: readonly Kline[]) {
    const pine = new PineTS(
        provider,
        'BTCUSDT',
        '60',
        chart.length,
        chart[0].openTime,
        chart[chart.length - 1].closeTime,
    );
    return pine.run(`//@version=6\nindicator("named args")\n${code}`);
}

describe('request.security named arguments are passed by value', () => {
    it('honors calc_bars_count passed as a const int variable', async () => {
        const bars = dailyProviderBars();
        const provider = new RecordingProvider(bars);
        await runWith(
            provider,
            `const int N = 50
value = request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on, calc_bars_count = N)
plot(value)`,
            bars['60'],
        );
        const request = provider.requestFor('D');
        // A const int holding 50 must bind exactly like the literal 50: a
        // provider limit of 50 with no start-date window, not the 250-bar
        // warmup fallback (which leaves sDate set and limit undefined).
        expect(request.limit).toBe(50);
        expect(request.sDate).toBeUndefined();
        expect(request.returnedCount).toBe(50);
    });

    it('honors calc_bars_count passed as a mutable int variable', async () => {
        const bars = dailyProviderBars();
        const provider = new RecordingProvider(bars);
        await runWith(
            provider,
            `int n = 50
value = request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on, calc_bars_count = n)
plot(value)`,
            bars['60'],
        );
        const request = provider.requestFor('D');
        expect(request.limit).toBe(50);
        expect(request.sDate).toBeUndefined();
    });

    it('honors a variable holding barmerge.lookahead_on', async () => {
        const bars = dailyProviderBars();
        const provider = new RecordingProvider(bars);
        const context = await runWith(
            provider,
            `la = barmerge.lookahead_on
viaVar = request.security(syminfo.tickerid, "D", time, lookahead = la)
viaLiteral = request.security(syminfo.tickerid, "D", time, lookahead = barmerge.lookahead_on)
viaOff = request.security(syminfo.tickerid, "D", time, lookahead = barmerge.lookahead_off)
plot(viaVar, "viaVar")
plot(viaLiteral, "viaLiteral")
plot(viaOff, "viaOff")`,
            bars['60'],
        );
        const viaVar = context.plots.viaVar.data.map((point: { value: number }) => point.value);
        const viaLiteral = context.plots.viaLiteral.data.map((point: { value: number }) => point.value);
        const viaOff = context.plots.viaOff.data.map((point: { value: number }) => point.value);
        // Chart bar 0 (Jan 7 23:00) belongs to the Jan 7 daily bar under both
        // modes. With lookahead_on, bar 1 (Jan 8 00:00, the first bar inside
        // the new daily period) already maps to the Jan 8 daily open;
        // lookahead_off stays on Jan 7 until the daily bar closes. A variable
        // holding barmerge.lookahead_on must behave exactly like the literal
        // enum and unlike lookahead_off.
        expect(viaVar).toEqual(viaLiteral);
        expect(viaVar[1]).toBe(DAY_START);
        expect(viaOff[1]).toBe(DAY_START - DAY);
        expect(viaVar[0]).toBe(viaOff[0]);
    });

    it('reads a named expression alias from a higher-timeframe secondary', async () => {
        const bars = dailyProviderBars();
        const provider = new RecordingProvider(bars);
        const context = await runWith(
            provider,
            `x = close
viaNamed = request.security(syminfo.tickerid, "D", expression = x)
viaPositional = request.security(syminfo.tickerid, "D", close)
plot(viaNamed, "viaNamed")
plot(viaPositional, "viaPositional")`,
            bars['60'],
        );
        const viaNamed = context.plots.viaNamed.data.map((point: { value: number }) => point.value);
        const viaPositional = context.plots.viaPositional.data.map(
            (point: { value: number }) => point.value,
        );
        // The alias x = close requested by name must equal close requested
        // positionally, and must actually resolve (not be na on every bar).
        expect(viaNamed.some((value) => !Number.isNaN(value))).toBe(true);
        expect(viaNamed).toEqual(viaPositional);
    });

    it('honors ignore_invalid_symbol passed through a bool variable', async () => {
        const failingProvider: IProvider = {
            async getMarketData(_tickerId: string, timeframe: string) {
                if (timeframe !== '60') throw new Error('no daily data');
                return dailyProviderBars()['60'].map((bar) => ({ ...bar }));
            },
            getSymbolInfo: () => Provider.Mock.getSymbolInfo('BTCUSDT'),
            configure: () => undefined,
        };
        const chart = dailyProviderBars()['60'];
        const context = await runWith(
            failingProvider,
            `ign = true
value = request.security(syminfo.tickerid, "D", close, ignore_invalid_symbol = ign)
plot(value, "ignored")
plot(close, "chart")`,
            chart,
        );
        // ignore_invalid_symbol = true via a variable must suppress the load
        // error and keep the chart series running.
        expect(context.plots.ignored.data).toHaveLength(60);
        expect(
            context.plots.ignored.data.every((point: { value: number }) => Number.isNaN(point.value)),
        ).toBe(true);
        expect(context.plots.chart.data[59].value).toBeCloseTo(159, 5);
    });
});

describe('request.security_lower_tf named arguments are passed by value', () => {
    it('honors calc_bars_count passed as a const int variable', async () => {
        const bars = dailyProviderBars();
        // On a 60m chart request the 1m timeframe: 4 one-minute bars inside the
        // last chart hour is enough to prove the request ran with the alias.
        bars['1'] = [0, 5, 10, 15].map((minute) =>
            makeBar(DAY_START + 58 * HOUR + minute * MINUTE, MINUTE, 200 + minute),
        );
        const provider = new RecordingProvider(bars);
        const context = await runWith(
            provider,
            `const int N = 50
values = request.security_lower_tf(syminfo.tickerid, "1", close, calc_bars_count = N)
plot(array.size(values), "size")`,
            bars['60'],
        );
        const request = provider.requestFor('1');
        // The const variable must reach the secondary as the literal 50 limit.
        // Lower-timeframe secondaries are still bounded to the chart window, so
        // sDate is the first chart open (unlike higher-timeframe calc_bars_count).
        expect(request.limit).toBe(50);
        expect(request.sDate).toBe(bars['60'][0].openTime);
        const sizes = context.plots.size.data.map((point: { value: number }) => point.value);
        expect(sizes.at(-1)).toBe(4);
    });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { IProvider, ISymbolInfo } from '../../src/marketData/IProvider';
import type { Kline } from '../../src/marketData/types';
import fixture from './request/data/htf-warmup-tv.json';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1_000;
const DAY = 86_400_000;
const REQUEST_TIMEFRAMES = ['D', 'W'] as const;

type BarSpec = {
    readonly historyBars: number;
    readonly stepMs: number;
    readonly endOpenTime: number;
    readonly scale: number;
};

type MarketRequest = {
    readonly timeframe: string;
    readonly limit?: number;
    readonly sDate?: number;
    readonly eDate?: number;
    readonly returnedCount: number;
};

type PlotPoint = { readonly value: number };

function makeBars(spec: BarSpec): Kline[] {
    return Array.from({ length: spec.historyBars }, (_, index) => {
        const openTime = spec.endOpenTime - (spec.historyBars - 1 - index) * spec.stepMs;
        const close = 100 + index * 0.07 + ((index % 11) - 5) * 0.13 * spec.scale;
        const open = close + ((index % 3) - 1) * 0.2 * spec.scale;
        return {
            openTime,
            closeTime: openTime + spec.stepMs - 1,
            open,
            high: Math.max(open, close) + 1 + (index % 5) * 0.07 * spec.scale,
            low: Math.min(open, close) - 0.8 - (index % 7) * 0.05 * spec.scale,
            close,
            volume: 1_000 + index,
            quoteAssetVolume: 0,
            numberOfTrades: 0,
            takerBuyBaseAssetVolume: 0,
            takerBuyQuoteAssetVolume: 0,
            ignore: 0,
        };
    });
}

class RecordingProvider implements IProvider {
    readonly requests: MarketRequest[] = [];

    constructor(private readonly barsByTimeframe: Readonly<Record<string, readonly Kline[]>>) {}

    async getMarketData(
        _tickerId: string,
        timeframe: string,
        limit?: number,
        sDate?: number,
        eDate?: number,
    ): Promise<Kline[]> {
        const available = this.barsByTimeframe[timeframe] ?? [];
        const filtered = available.filter(
            (bar) => (sDate === undefined || bar.openTime >= sDate) && (eDate === undefined || bar.openTime <= eDate),
        );
        const selected = limit === undefined ? filtered : filtered.slice(-limit);
        this.requests.push({ timeframe, limit, sDate, eDate, returnedCount: selected.length });
        return selected.map((bar) => ({ ...bar }));
    }

    getSymbolInfo(): Promise<ISymbolInfo> {
        return Provider.Mock.getSymbolInfo('BTCUSDT');
    }

    configure(): void {}

    requestFor(timeframe: string): MarketRequest {
        for (let index = this.requests.length - 1; index >= 0; index--) {
            if (this.requests[index].timeframe === timeframe) return this.requests[index];
        }
        throw new Error(`No provider request recorded for ${timeframe}`);
    }
}

function chartBars(timeframe: string, stepMs: number): Readonly<Record<string, readonly Kline[]>> {
    return {
        [timeframe]: makeBars({ historyBars: 2, stepMs, endOpenTime: fixture.chartStart + stepMs, scale: 0.1 }),
        D: makeBars({ ...fixture.requests.D, endOpenTime: fixture.chartStart }),
        W: makeBars({ ...fixture.requests.W, endOpenTime: fixture.chartStart }),
        '1': makeBars({ historyBars: 400, stepMs: MINUTE, endOpenTime: fixture.chartStart, scale: 0.5 }),
    };
}

async function recordWindow(options: {
    readonly chartTimeframe: string;
    readonly chartStepMs: number;
    readonly requestTimeframe: string;
    readonly calcBarsCount?: number;
}): Promise<MarketRequest> {
    const provider = new RecordingProvider(chartBars(options.chartTimeframe, options.chartStepMs));
    const pine = new PineTS(
        provider,
        'BTCUSDT',
        options.chartTimeframe,
        2,
        fixture.chartStart,
        fixture.chartStart + options.chartStepMs * 2,
    );
    const calcBars = options.calcBarsCount === undefined ? '' : `, calc_bars_count = ${options.calcBarsCount}`;
    await pine.run(`//@version=6
indicator("window")
value = request.security(syminfo.tickerid, "${options.requestTimeframe}", close, lookahead = barmerge.lookahead_on${calcBars})
plot(value)`);
    return provider.requestFor(options.requestTimeframe);
}

describe('request.security higher-timeframe warmup', () => {
    it('requests 250 daily and weekly bars and matches the independent first-visible oracle', async () => {
        const provider = new RecordingProvider(chartBars('60', HOUR));
        const pine = new PineTS(provider, 'BTCUSDT', '60', 2, fixture.chartStart, fixture.chartStart + HOUR * 2);
        const context = await pine.run(`//@version=6
indicator("HTF recursive warmup")
[dAtr, dRma, dEma] = request.security(syminfo.tickerid, "D", [ta.atr(14), ta.rma(close, 14), ta.ema(close, 14)], lookahead = barmerge.lookahead_on)
[wAtr, wRma, wEma] = request.security(syminfo.tickerid, "W", [ta.atr(14), ta.rma(close, 14), ta.ema(close, 14)], lookahead = barmerge.lookahead_on)
plot(dAtr, "D_atr")
plot(dRma, "D_rma")
plot(dEma, "D_ema")
plot(wAtr, "W_atr")
plot(wRma, "W_rma")
plot(wEma, "W_ema")`);

        for (const timeframe of REQUEST_TIMEFRAMES) {
            const request = provider.requestFor(timeframe);
            const expected = fixture.requests[timeframe];
            expect.soft(request.limit, `${timeframe} provider limit`).toBeUndefined();
            expect.soft(request.sDate, `${timeframe} provider start`).toBe(fixture.chartStart - fixture.warmupBars * expected.stepMs);
            expect.soft(request.returnedCount, `${timeframe} returned bars`).toBeGreaterThanOrEqual(fixture.warmupBars);
            for (const indicator of ['atr', 'rma', 'ema'] as const) {
                const point: PlotPoint = context.plots[`${timeframe}_${indicator}`].data[0];
                const firstVisible = point.value;
                expect.soft(firstVisible, `${timeframe} ${indicator} first visible`).toBeCloseTo(
                    expected.expected[indicator],
                    fixture.comparisonDigits,
                );
            }
        }
    });

    it('preserves calc_bars_count while larger explicit counts win', async () => {
        const smaller = await recordWindow({ chartTimeframe: '60', chartStepMs: HOUR, requestTimeframe: 'D', calcBarsCount: 50 });
        expect(smaller.limit).toBe(50);
        expect(smaller.sDate).toBeUndefined();
        expect(smaller.returnedCount).toBe(50);

        const larger = await recordWindow({ chartTimeframe: '60', chartStepMs: HOUR, requestTimeframe: 'D', calcBarsCount: 400 });
        expect(larger.limit).toBe(400);
        expect(larger.sDate).toBeUndefined();
        expect(larger.returnedCount).toBe(400);
    });

    it('keeps a one-minute requested timeframe bounded to 250 bars', async () => {
        const request = await recordWindow({ chartTimeframe: '1S', chartStepMs: SECOND, requestTimeframe: '1' });
        expect(request.limit).toBeUndefined();
        expect(request.sDate).toBe(fixture.chartStart - fixture.warmupBars * MINUTE);
        expect(fixture.chartStart - request.sDate).toBeLessThan(DAY);
        expect(request.returnedCount).toBeGreaterThanOrEqual(fixture.warmupBars);
    });
});

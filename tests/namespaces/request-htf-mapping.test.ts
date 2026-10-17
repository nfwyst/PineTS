// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/Context.class';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { IProvider, ISymbolInfo } from '../../src/marketData/IProvider';
import type { Kline } from '../../src/marketData/types';
import { findSecContextIdx } from '../../src/namespaces/request/utils/findSecContextIdx';

const HOUR = 3_600_000;
const DAY_START = Date.UTC(2030, 0, 8);
const DAILY_OPEN = [14.5, 38.5, 62.5].map((hours) => DAY_START + hours * HOUR);
const DAILY_CLOSE = [21, 45, 69].map((hours) => DAY_START + hours * HOUR);

function bar(openTime: number, closeTime: number, close: number): Kline {
    return {
        openTime,
        closeTime,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const CHART_BARS = Array.from({ length: 17 }, (_, index) => {
    const openTime = DAY_START - HOUR + index * 4 * HOUR;
    return bar(openTime, openTime + 4 * HOUR, 100 + index);
});
const DAILY_BARS = DAILY_OPEN.map((openTime, index) => bar(openTime, DAILY_CLOSE[index], 10 * (index + 1)));

class SessionGapProvider implements IProvider {
    getMarketData(_tickerId: string, timeframe: string): Promise<Kline[]> {
        const source = timeframe === 'D' ? DAILY_BARS : CHART_BARS;
        return Promise.resolve(source.map((entry) => ({ ...entry })));
    }

    getSymbolInfo(): Promise<ISymbolInfo> {
        return Provider.Mock.getSymbolInfo('BTCUSDT');
    }

    configure(): void {}
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title].data.map((point: { readonly value: number }) => point.value);
}

describe('findSecContextIdx latest-open/latest-completed mapping', () => {
    it('returns -1 before first and for empty secondary arrays', () => {
        expect(findSecContextIdx(DAILY_OPEN[0] - 1, DAILY_OPEN[0], DAILY_OPEN, DAILY_CLOSE, true, false)).toBe(-1);
        expect(findSecContextIdx(DAY_START, DAY_START + HOUR, [], [], false, false)).toBe(-1);
    });

    it('maps exact open and exact close boundaries', () => {
        expect(findSecContextIdx(DAILY_OPEN[1], DAILY_OPEN[1] + HOUR, DAILY_OPEN, DAILY_CLOSE, true, false)).toBe(1);
        expect(findSecContextIdx(DAY_START, DAILY_CLOSE[0], DAILY_OPEN, DAILY_CLOSE, false, false)).toBe(0);
    });

    it('carries the latest open and latest completed bar across session gaps', () => {
        expect(findSecContextIdx(DAY_START + 30 * HOUR, DAY_START + 34 * HOUR, DAILY_OPEN, DAILY_CLOSE, true, false)).toBe(0);
        expect(findSecContextIdx(DAY_START + 30 * HOUR, DAY_START + 34 * HOUR, DAILY_OPEN, DAILY_CLOSE, false, false)).toBe(0);
        expect(findSecContextIdx(DAY_START + 50 * HOUR, DAY_START + 54 * HOUR, DAILY_OPEN, DAILY_CLOSE, false, false)).toBe(1);
    });

    it('uses the latest open for a realtime lookahead-off bar', () => {
        expect(findSecContextIdx(DAY_START + 63 * HOUR, DAY_START + 67 * HOUR, DAILY_OPEN, DAILY_CLOSE, false, true)).toBe(2);
    });
});

describe('request.security session-gap mapping', () => {
    it('carries gaps_off and emits gaps_on transitions for historical and realtime bars', async () => {
        const lastChartBar = CHART_BARS[CHART_BARS.length - 1];
        const pine = new PineTS(new SessionGapProvider(), 'X:CHART', '240', undefined, CHART_BARS[0].openTime, lastChartBar.closeTime);
        const context = await pine.run(`//@version=6
indicator("session-gap mapping")
onOff = request.security("X:EQ", "D", close, gaps = barmerge.gaps_off, lookahead = barmerge.lookahead_on)
offOff = request.security("X:EQ", "D", close, gaps = barmerge.gaps_off, lookahead = barmerge.lookahead_off)
onGaps = request.security("X:EQ", "D", close, gaps = barmerge.gaps_on, lookahead = barmerge.lookahead_on)
offGaps = request.security("X:EQ", "D", close, gaps = barmerge.gaps_on, lookahead = barmerge.lookahead_off)
plot(onOff, "on_off")
plot(offOff, "off_off")
plot(onGaps, "on_gaps")
plot(offGaps, "off_gaps")`);

        expect(plotValues(context, 'on_off')).toEqual([
            NaN, NaN, NaN, NaN, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 20, 30,
        ]);
        expect(plotValues(context, 'off_off')).toEqual([
            NaN, NaN, NaN, NaN, NaN, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 30,
        ]);
        expect(plotValues(context, 'on_gaps')).toEqual([
            NaN, NaN, NaN, NaN, 10, NaN, NaN, NaN, NaN, NaN, 20, NaN, NaN, NaN, NaN, NaN, 30,
        ]);
        expect(plotValues(context, 'off_gaps')).toEqual([
            NaN, NaN, NaN, NaN, NaN, 10, NaN, NaN, NaN, NaN, NaN, 20, NaN, NaN, NaN, NaN, 30,
        ]);
    });
});

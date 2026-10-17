// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { PineTS } from '../../../src/PineTS.class';
import { describe, expect, it } from 'vitest';

const DAY_MS = 86_400_000;
const START_TIME = Date.UTC(2024, 0, 1);
const BAR_COUNT = 4;

const candles = Array.from({ length: BAR_COUNT }, (_, index) => {
    const isUpBar = index % 2 === 0;
    return {
        openTime: START_TIME + index * DAY_MS,
        closeTime: START_TIME + (index + 1) * DAY_MS - 1,
        open: isUpBar ? 100 : 102,
        high: 103,
        low: 99,
        close: isUpBar ? 102 : 100,
        volume: 1_000,
    };
});

async function runPlots(source: string) {
    const pineTS = new PineTS(candles);
    const { plots } = await pineTS.run(source);
    return plots;
}

describe('untitled plot-like callsite keys', () => {
    it('keeps barcolor() and bgcolor() data in separate callsite entries', async () => {
        const plots = await runPlots(`//@version=5
indicator("colors", overlay=true)
barcolor(close > open ? color.green : na)
bgcolor(close < open ? color.red : na)
`);

        expect(Object.keys(plots).filter((key) => !key.startsWith('__'))).toEqual(['#0', '#1']);
        expect(plots['#0'].options.style).toBe('barcolor');
        expect(plots['#1'].options.style).toBe('background');
        expect(plots['#0'].data).toHaveLength(BAR_COUNT);
        expect(plots['#1'].data).toHaveLength(BAR_COUNT);
    });

    it('gives every plan-named untitled plot-like call one point per bar', async () => {
        const plots = await runPlots(`//@version=5
indicator("all", overlay=true)
plot(close)
plotchar(close > open, char="u")
plotshape(close > open, style=shape.circle)
bgcolor(close > open ? color.green : na)
barcolor(close < open ? color.red : na)
`);

        expect(Object.keys(plots).filter((key) => !key.startsWith('__'))).toEqual(['#0', '#1', '#2', '#3', '#4']);
        expect(plots['#1'].options.style).toBe('char');
        expect(plots['#2'].options.style).toBe('shape');
        expect(plots['#3'].options.style).toBe('background');
        expect(plots['#4'].options.style).toBe('barcolor');
        for (const key of ['#0', '#1', '#2', '#3', '#4']) {
            expect(plots[key].data).toHaveLength(BAR_COUNT);
        }
    });

    it('keeps untitled plotarrow, plotbar, and plotcandle call sites separate', async () => {
        // Given: two untitled calls for each remaining bare plot-like function.
        const source = `//@version=6
indicator("remaining plot callsites", overlay=true)
plotarrow(close - open)
plotarrow(open - close)
plotbar(open, high, low, close)
plotbar(open + 1, high + 1, low + 1, close + 1)
plotcandle(open, high, low, close)
plotcandle(open + 1, high + 1, low + 1, close + 1)`;

        // When: the public runtime collects their plot data.
        const plots = await runPlots(source);

        // Then: every static call site owns exactly one point per bar.
        const keys = ['#0', '#1', '#2', '#3', '#4', '#5'];
        expect(Object.keys(plots).filter((key) => !key.startsWith('__'))).toEqual(keys);
        for (const key of keys) expect(plots[key].data).toHaveLength(BAR_COUNT);
        expect(keys.map((key) => plots[key].options.style)).toEqual(['shape', 'shape', 'bar', 'bar', 'candle', 'candle']);
    });

    it('keeps explicit titles as keys for every plan-named plot-like call', async () => {
        const plots = await runPlots(`//@version=5
indicator("titles", overlay=true)
plot(close, title="Line")
plotchar(close > open, title="Character", char="u")
plotshape(close > open, title="Shape", style=shape.circle)
bgcolor(close > open ? color.green : na, title="Background")
barcolor(close < open ? color.red : na, title="Bar")
`);

        expect(Object.keys(plots).filter((key) => !key.startsWith('__'))).toEqual(['Line', 'Character', 'Shape', 'Background', 'Bar']);
        for (const key of ['Line', 'Character', 'Shape', 'Background', 'Bar']) {
            expect(plots[key].data).toHaveLength(BAR_COUNT);
        }
    });
});

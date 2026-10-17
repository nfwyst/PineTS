// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '../../../src/marketData/Provider.class';
import type { Context } from '../../../src/Context.class';
import type { Kline } from '../../../src/marketData/types';

const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function candles(closes: readonly number[]): Kline[] {
    return closes.map((close, index) => ({
        openTime: START + index * MINUTE,
        closeTime: START + (index + 1) * MINUTE - 1,
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
    }));
}

function candle(index: number, close: number, volume: number): Kline {
    return { ...candles([close])[0], openTime: START + index * MINUTE, closeTime: START + (index + 1) * MINUTE - 1, volume };
}

class ConditionalTickProvider {
    private bars = [candle(0, 10, 0), candle(1, 60, 1)];
    private update = 0;

    async getMarketData(_tickerId: string, _timeframe: string, _limit?: number, startDate?: number): Promise<Kline[]> {
        if (startDate === undefined) return this.bars.map((bar) => ({ ...bar }));
        if (this.update++ === 0) this.bars[1] = candle(1, 40, 0);
        else this.bars.push(candle(2, 20, 1));
        return this.bars.filter((bar) => bar.openTime >= startDate).map((bar) => ({ ...bar }));
    }

    getSymbolInfo(tickerId: string) {
        return Provider.Mock.getSymbolInfo(tickerId);
    }

    configure(): void {}
}

function latest(context: Context, title: string): number {
    return context.plots[title]?.data.at(-1)?.value ?? NaN;
}

describe('ta.highest/lowest partial windows', () => {
    it('uses available history when the requested length exceeds the loaded bars', async () => {
        // Given
        const source = `//@version=6
indicator("partial extrema window")
plot(ta.highest(close, 80), "highest")
plot(ta.lowest(close, 80), "lowest")`;

        // When
        const context = await new PineTS(candles([10, 5]), 'TEST', '1').run(source);

        // Then
        expect(context.plots.highest.data.map((point) => point.value)).toEqual([10, 10]);
        expect(context.plots.lowest.data.map((point) => point.value)).toEqual([10, 5]);
    });

    it('uses only the conditional call-site history on its first early execution', async () => {
        // Given
        const source = `//@version=6
indicator("conditional partial extrema")
hiSource = bar_index == 0 ? 10.0 : 5.0
loSource = bar_index == 0 ? 5.0 : 10.0
float highestValue = na
float lowestValue = na
if bar_index == 1
    highestValue := ta.highest(hiSource, 80)
    lowestValue := ta.lowest(loSource, 80)
plot(highestValue, "highest")
plot(lowestValue, "lowest")`;

        // When
        const context = await new PineTS(candles([1, 1]), 'TEST', '1').run(source);

        // Then
        expect(context.plots.highest.data.map((point) => point.value)).toEqual([NaN, 5]);
        expect(context.plots.lowest.data.map((point) => point.value)).toEqual([NaN, 10]);
    });

    it('does not backfill chart history on a late first conditional execution', async () => {
        // Given
        const source = `//@version=6
indicator("late conditional extrema")
hiSource = bar_index == 90 ? 100.0 : 1.0
loSource = bar_index == 90 ? -100.0 : 1.0
float highestValue = na
float lowestValue = na
if bar_index == 99
    highestValue := ta.highest(hiSource, 80)
    lowestValue := ta.lowest(loSource, 80)
plot(highestValue, "highest")
plot(lowestValue, "lowest")`;

        // When
        const context = await new PineTS(candles(Array(100).fill(1)), 'TEST', '1').run(source);

        // Then
        expect(context.plots.highest.data.at(-1)?.value).toBe(1);
        expect(context.plots.lowest.data.at(-1)?.value).toBe(1);
    });

    it('retains conditional call-site history when a dynamic length expands', async () => {
        // Given
        const source = `//@version=6
indicator("dynamic conditional extrema")
float highestValue = na
float lowestValue = na
if bar_index % 2 == 0
    int length = bar_index == 4 ? 3 : 1
    highestValue := ta.highest(close, length)
    lowestValue := ta.lowest(-close, length)
plot(highestValue, "highest")
plot(lowestValue, "lowest")`;

        // When
        const context = await new PineTS(candles([100, 9, 1, 9, 2]), 'TEST', '1').run(source);

        // Then: the three actual call-site values are [100, 1, 2].
        expect(context.plots.highest.data.at(-1)?.value).toBe(100);
        expect(context.plots.lowest.data.at(-1)?.value).toBe(-100);
    });

    it('discards a provisional conditional call when the final same-bar execution skips it', async () => {
        // Given
        const pine = new PineTS(new ConditionalTickProvider(), 'BTCUSDC', '1');
        const context = await pine.run(`//@version=6
indicator("conditional rollback")
float highestValue = na
float lowestValue = na
if volume > 0
    highestValue := ta.highest(close, 2)
    lowestValue := ta.lowest(-close, 2)
plot(highestValue, "highest")
plot(lowestValue, "lowest")`);
        const states = [{ highest: latest(context, 'highest'), lowest: latest(context, 'lowest') }];

        // When
        await pine.updateTail(context);
        states.push({ highest: latest(context, 'highest'), lowest: latest(context, 'lowest') });
        await pine.updateTail(context);
        states.push({ highest: latest(context, 'highest'), lowest: latest(context, 'lowest') });

        // Then
        expect(states).toEqual([
            { highest: 60, lowest: -60 },
            { highest: NaN, lowest: NaN },
            { highest: 20, lowest: -20 },
        ]);
    });

    it('bounds retained extrema history by Pine historical buffer limits', async () => {
        // Given / When
        const context = await new PineTS(candles(Array.from({ length: 5_100 }, (_, index) => index)), 'TEST', '1').run(`//@version=6
indicator("bounded extrema history")
plot(ta.highest(close, 5000), "highest")
plot(ta.lowest(close, 5000), "lowest")`);

        // Then
        expect(context.plots.highest.data.at(-1)?.value).toBe(5_099);
        expect(context.plots.lowest.data.at(-1)?.value).toBe(100);
        for (const state of Object.values(context.taState)) {
            const retained = Reflect.get(Object(state), 'committedValues');
            expect(Array.isArray(retained)).toBe(true);
            expect(retained.length).toBeLessThanOrEqual(5_000);
        }
    });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS, Provider } from 'index';
import type { Context } from '../../src/Context.class';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function candle(index: number, close: number): Kline {
    return {
        openTime: START + index * MINUTE,
        closeTime: START + (index + 1) * MINUTE - 1,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1_000,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

type Step = { readonly kind: 'tick'; readonly close: number } | { readonly kind: 'new bar'; readonly close: number };

class ScriptedProvider {
    public readonly bars: Kline[];
    private stepIndex = 0;

    constructor(initialCloses: readonly number[], private readonly steps: readonly Step[]) {
        this.bars = initialCloses.map((close, index) => candle(index, close));
    }

    async getMarketData(_tickerId: string, _timeframe: string, _limit?: number, startDate?: number): Promise<Kline[]> {
        if (startDate === undefined) return this.bars.map((bar) => ({ ...bar }));

        const step = this.steps[this.stepIndex];
        this.stepIndex++;
        if (step?.kind === 'tick') {
            const index = this.bars.length - 1;
            this.bars[index] = candle(index, step.close);
        } else if (step?.kind === 'new bar') {
            this.bars.push(candle(this.bars.length, step.close));
        }
        return this.bars.filter((bar) => bar.openTime >= startDate).map((bar) => ({ ...bar }));
    }

    getSymbolInfo(tickerId: string) {
        return Provider.Mock.getSymbolInfo(tickerId);
    }

    configure(): void {}
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title]?.data.map((point: { readonly value: number }) => point.value) ?? [];
}

describe('updateTail plot transaction', () => {
    it('replaces a same-bar plot point and appends exactly once for a new bar', async () => {
        const provider = new ScriptedProvider([100, 101, 103], [
            { kind: 'tick', close: 103.5 },
            { kind: 'new bar', close: 104 },
            { kind: 'tick', close: 104.5 },
        ]);
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const context = await pine.run(`//@version=6
indicator("plot transaction")
plot(close, "close")`);
        const lengths = [plotValues(context, 'close').length];
        const latestValues = [plotValues(context, 'close').at(-1)];

        for (let index = 0; index < 3; index++) {
            await pine.updateTail(context);
            lengths.push(plotValues(context, 'close').length);
            latestValues.push(plotValues(context, 'close').at(-1));
        }

        expect(lengths).toEqual([3, 3, 4, 4]);
        expect(latestValues).toEqual([103, 103.5, 104, 104.5]);
    });

    it('conditional plot omission removes the stale same-bar point', async () => {
        const provider = new ScriptedProvider([100, 101, 103], [{ kind: 'tick', close: 101 }]);
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const context = await pine.run(`//@version=6
indicator("conditional plot transaction")
if close > 102
    plot(close, "conditional")`);

        expect(plotValues(context, 'conditional')).toEqual([103]);
        await pine.updateTail(context);
        expect(plotValues(context, 'conditional')).toEqual([]);
    });
});

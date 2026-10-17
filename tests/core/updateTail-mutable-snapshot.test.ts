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
    private readonly bars: Kline[];
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

const MUTABLE_GRAPH_SCRIPT = `//@version=6
indicator("mutable graph transaction")
type Holder
    array<int> left
    array<int> right
var array<int> values = array.new_int(0)
var array<int> shared = values
var Holder holder = Holder.new(values, values)
var map<string, int> counts = map.new<string, int>()
var matrix<int> grid = matrix.new<int>(1, 1, 0)
shared.push(bar_index)
counts.put("executions", nz(counts.get("executions"), 0) + 1)
grid.set(0, 0, grid.get(0, 0) + 1)
plot(values.size(), "values size")
plot(shared.size(), "shared size")
plot(holder.left.size(), "holder left size")
plot(holder.right.size(), "holder right size")
plot(counts.get("executions"), "map count")
plot(grid.get(0, 0), "matrix count")`;

type GraphState = {
    readonly values: number;
    readonly shared: number;
    readonly holderLeft: number;
    readonly holderRight: number;
    readonly map: number;
    readonly matrix: number;
};

function latestValue(context: Context, title: string): number {
    return context.plots[title]?.data.at(-1)?.value ?? NaN;
}

function graphState(context: Context): GraphState {
    return {
        values: latestValue(context, 'values size'),
        shared: latestValue(context, 'shared size'),
        holderLeft: latestValue(context, 'holder left size'),
        holderRight: latestValue(context, 'holder right size'),
        map: latestValue(context, 'map count'),
        matrix: latestValue(context, 'matrix count'),
    };
}

function expectedState(count: number): GraphState {
    return {
        values: count,
        shared: count,
        holderLeft: count,
        holderRight: count,
        map: count,
        matrix: count,
    };
}

describe('updateTail mutable graph transaction', () => {
    it('keeps same-bar ticks idempotent and preserves top-level and nested UDT aliases', async () => {
        const provider = new ScriptedProvider([100, 101, 102, 103, 104], [
            { kind: 'tick', close: 104.25 },
            { kind: 'tick', close: 104.5 },
        ]);
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const context = await pine.run(MUTABLE_GRAPH_SCRIPT);
        const states = [graphState(context)];

        await pine.updateTail(context);
        states.push(graphState(context));
        await pine.updateTail(context);
        states.push(graphState(context));

        expect(states).toEqual([expectedState(5), expectedState(5), expectedState(5)]);
    });

    it('commits mutable graph state once for a new bar and not again for its next tick', async () => {
        const provider = new ScriptedProvider([100, 101, 102, 103, 104], [
            { kind: 'new bar', close: 105 },
            { kind: 'tick', close: 105.5 },
        ]);
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const context = await pine.run(MUTABLE_GRAPH_SCRIPT);
        const states = [graphState(context)];

        await pine.updateTail(context);
        states.push(graphState(context));
        await pine.updateTail(context);
        states.push(graphState(context));

        expect(states).toEqual([expectedState(5), expectedState(6), expectedState(6)]);
    });
});

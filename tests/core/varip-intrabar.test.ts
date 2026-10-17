// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { Context } from '../../src/Context.class';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function candle(index: number, close: number): Kline {
    return {
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
    };
}

type MarketUpdate = { readonly kind: 'tick'; readonly close: number } | { readonly kind: 'new bar'; readonly close: number };

class TickProvider {
    private readonly bars: Kline[];
    private readonly updates: readonly MarketUpdate[];
    private updateIndex = 0;

    constructor(
        updates: readonly MarketUpdate[] = [{ kind: 'tick', close: 101.25 }, { kind: 'tick', close: 101.5 }],
        initialCloses: readonly number[] = [100, 101],
    ) {
        this.updates = updates;
        this.bars = initialCloses.map((close, index) => candle(index, close));
    }

    async getMarketData(_tickerId: string, _timeframe: string, _limit?: number, startDate?: number): Promise<Kline[]> {
        if (startDate === undefined) return this.bars.map((bar) => ({ ...bar }));

        const update = this.updates[this.updateIndex];
        this.updateIndex++;
        if (update?.kind === 'new bar') {
            this.bars.push(candle(this.bars.length, update.close));
        } else if (update?.kind === 'tick') {
            const current = this.bars.at(-1);
            if (current === undefined) return [];
            this.bars[this.bars.length - 1] = {
                ...current,
                close: update.close,
                high: Math.max(current.high, update.close),
                low: Math.min(current.low, update.close),
            };
        }
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

describe('varip intrabar persistence', () => {
    it('persists varip while rolling var back across same-bar ticks', async () => {
        // Given
        const pine = new PineTS(new TickProvider(), 'BTCUSDC', '1');
        const source = `//@version=6
indicator("varip ticks")
var int normal = 0
varip int intrabar = 0
normal += 1
intrabar += 1
plot(normal, "var")
plot(intrabar, "varip")
plot(intrabar[1], "varip previous")`;

        // When
        const context = await pine.run(source);
        const states = [{ normal: latest(context, 'var'), intrabar: latest(context, 'varip'), previous: latest(context, 'varip previous') }];
        await pine.updateTail(context);
        states.push({ normal: latest(context, 'var'), intrabar: latest(context, 'varip'), previous: latest(context, 'varip previous') });
        await pine.updateTail(context);
        states.push({ normal: latest(context, 'var'), intrabar: latest(context, 'varip'), previous: latest(context, 'varip previous') });

        // Then
        expect(states).toEqual([
            { normal: 2, intrabar: 2, previous: 1 },
            { normal: 2, intrabar: 3, previous: 1 },
            { normal: 2, intrabar: 4, previous: 1 },
        ]);
    });

    it('rolls back var while retaining varip first created on the forming bar', async () => {
        // Given
        const pine = new PineTS(new TickProvider(), 'BTCUSDC', '1');
        const source = `//@version=6
indicator("late local varip")
float normalValue = na
float current = na
float previous = na
if bar_index == 1
    var int normal = 0
    varip int local = 0
    normal += 1
    local += 1
    normalValue := normal
    current := local
    previous := local[1]
plot(normalValue, "normal")
plot(current, "current")
plot(previous, "previous")`;

        // When
        const context = await pine.run(source);
        const states = [{ normal: latest(context, 'normal'), current: latest(context, 'current'), previous: latest(context, 'previous') }];
        await pine.updateTail(context);
        states.push({ normal: latest(context, 'normal'), current: latest(context, 'current'), previous: latest(context, 'previous') });
        await pine.updateTail(context);
        states.push({ normal: latest(context, 'normal'), current: latest(context, 'current'), previous: latest(context, 'previous') });

        // Then
        expect(states).toEqual([
            { normal: 1, current: 1, previous: NaN },
            { normal: 1, current: 2, previous: NaN },
            { normal: 1, current: 3, previous: NaN },
        ]);
    });

    it('rolls back var while retaining varip when the dataset has one forming bar', async () => {
        // Given
        const provider = new TickProvider(
            [{ kind: 'tick', close: 100.25 }, { kind: 'tick', close: 100.5 }],
            [100],
        );
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const source = `//@version=6
indicator("single-bar varip")
var int normal = 0
varip int intrabar = 0
normal += 1
intrabar += 1
plot(normal, "normal")
plot(intrabar, "intrabar")`;

        // When
        const context = await pine.run(source);
        const states = [{ normal: latest(context, 'normal'), intrabar: latest(context, 'intrabar') }];
        await pine.updateTail(context);
        states.push({ normal: latest(context, 'normal'), intrabar: latest(context, 'intrabar') });
        await pine.updateTail(context);
        states.push({ normal: latest(context, 'normal'), intrabar: latest(context, 'intrabar') });

        // Then
        expect(states).toEqual([
            { normal: 1, intrabar: 1 },
            { normal: 1, intrabar: 2 },
            { normal: 1, intrabar: 3 },
        ]);
    });

    it('commits the last intrabar value once before executing a new bar', async () => {
        // Given
        const provider = new TickProvider([
            { kind: 'tick', close: 101.25 },
            { kind: 'tick', close: 101.5 },
            { kind: 'new bar', close: 102 },
            { kind: 'tick', close: 102.25 },
        ]);
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const source = `//@version=6
indicator("varip new bar")
varip int intrabar = 0
intrabar += 1
plot(intrabar, "current")
plot(intrabar[1], "previous")`;
        const context = await pine.run(source);
        const states = [{ current: latest(context, 'current'), previous: latest(context, 'previous') }];

        // When
        for (let update = 0; update < 4; update++) {
            await pine.updateTail(context);
            states.push({ current: latest(context, 'current'), previous: latest(context, 'previous') });
        }

        // Then
        expect(states).toEqual([
            { current: 2, previous: 1 },
            { current: 3, previous: 1 },
            { current: 4, previous: 1 },
            { current: 5, previous: 4 },
            { current: 6, previous: 4 },
        ]);
    });

    it('reports only the first execution of each bar as new', async () => {
        // Given
        const provider = new TickProvider([
            { kind: 'tick', close: 101.25 },
            { kind: 'tick', close: 101.5 },
            { kind: 'new bar', close: 102 },
            { kind: 'tick', close: 102.25 },
        ]);
        const pine = new PineTS(provider, 'BTCUSDC', '1');
        const context = await pine.run(`//@version=6
indicator("barstate new lifecycle")
plot(barstate.isnew ? 1 : 0, "isnew")`);
        const states = [latest(context, 'isnew')];

        // When
        for (let update = 0; update < 4; update++) {
            await pine.updateTail(context);
            states.push(latest(context, 'isnew'));
        }

        // Then
        expect(states).toEqual([1, 0, 0, 1, 0]);
    });
});

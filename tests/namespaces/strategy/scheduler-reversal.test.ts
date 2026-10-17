// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import type { Kline } from '../../../src/marketData/types';

const HOUR_MS = 60 * 60 * 1000;

function candle(index: number, open: number, high: number, low: number): Kline {
    return {
        openTime: index * HOUR_MS,
        closeTime: (index + 1) * HOUR_MS,
        open,
        high,
        low,
        close: open,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

interface ScenarioOptions {
    readonly entryType: 'limit' | 'market';
    readonly delayed?: boolean;
    readonly closeAll?: boolean;
}

async function runScenario(options: ScenarioOptions) {
    const fillBar = options.delayed ? candle(2, 90, 104, 85) : candle(2, 90, 110, 85);
    const bars = [candle(0, 100, 101, 99), candle(1, 100, 101, 99), fillBar, candle(3, 100, 110, 95)];
    const entryArgs = options.entryType === 'limit' ? ', limit = 105' : '';
    const closeCall = options.closeAll ? 'strategy.close_all(comment = "ALL")' : 'strategy.close("L", comment = "REV")';
    const context = await new PineTS(bars).run(`//@version=6
strategy("scheduler reversal", initial_capital = 100000, default_qty_type = strategy.fixed)
if bar_index == 0
    strategy.entry("L", strategy.long, qty = 1)
if bar_index == 1
    ${closeCall}
    strategy.entry("S", strategy.short, qty = 1${entryArgs}, comment = "S")
`);
    const closed = context.strategy.closedtrades[0];
    const opened = context.strategy.opentrades[0];
    return {
        closedPrice: closed.exit_price,
        closedComment: closed.exit_comment,
        closedProfit: closed.profit,
        openPrice: opened.entry_price,
        openSize: opened.size,
        finalPosition: context.strategy.position_size,
        pendingOrders: context.strategy.pending_orders.length,
    };
}

describe('strategy close-before-entry scheduling and reversal sizing', () => {
    it.each([100, 50])('sizes on-close reversal after closing %i percent of the old position', async (percent) => {
        const bars = [candle(0, 100, 101, 99), candle(1, 100, 101, 99)];

        const context = await new PineTS(bars).run(`//@version=6
strategy("on-close reversal", process_orders_on_close = true, initial_capital = 100000)
if bar_index == 0
    strategy.entry("L", strategy.long, qty = 1)
if bar_index == 1
    strategy.close("L", qty_percent = ${percent})
    strategy.entry("S", strategy.short, qty = 1)`);

        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.opentrades.map((trade) => trade.size)).toEqual([-1]);
    });

    it('current scheduler RED: market close fills before a priced reversal entry', async () => {
        expect(await runScenario({ entryType: 'limit' })).toEqual({
            closedPrice: 90,
            closedComment: 'REV',
            closedProfit: -10,
            openPrice: 105,
            openSize: -1,
            finalPosition: -1,
            pendingOrders: 0,
        });
    });

    it('current scheduler RED: market close keeps its comment before a market entry', async () => {
        expect(await runScenario({ entryType: 'market' })).toMatchObject({
            closedPrice: 90,
            closedComment: 'REV',
            openPrice: 90,
            openSize: -1,
            finalPosition: -1,
        });
    });

    it('close_all fills before a market entry and owns the exit comment', async () => {
        expect(await runScenario({ entryType: 'market', closeAll: true })).toMatchObject({
            closedPrice: 90,
            closedComment: 'ALL',
            openPrice: 90,
            openSize: -1,
            finalPosition: -1,
        });
    });

    it('naive close-first frozen-qty RED: a delayed priced entry opens only its base quantity from flat', async () => {
        expect(await runScenario({ entryType: 'limit', delayed: true })).toEqual({
            closedPrice: 90,
            closedComment: 'REV',
            closedProfit: -10,
            openPrice: 105,
            openSize: -1,
            finalPosition: -1,
            pendingOrders: 0,
        });
    });
});

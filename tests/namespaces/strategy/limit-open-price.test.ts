// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import type { Kline } from '../../../src/marketData/types';

const HOUR_MS = 60 * 60 * 1000;

function candle(index: number, open: number, high: number, low: number, close = open): Kline {
    return {
        openTime: index * HOUR_MS,
        closeTime: (index + 1) * HOUR_MS,
        open,
        high,
        low,
        close,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

function round(value: number): number {
    return Math.round(value * 1e10) / 1e10;
}

async function runClosedGap(direction: 'long' | 'short') {
    const isLong = direction === 'long';
    const bars = isLong
        ? [candle(0, 110, 111, 109), candle(1, 95, 99, 90), candle(2, 110, 111, 109)]
        : [candle(0, 90, 91, 89), candle(1, 105, 110, 101), candle(2, 90, 91, 89)];
    const context = await new PineTS(bars).run(`//@version=6
strategy("gap", initial_capital = 100000, default_qty_type = strategy.fixed, commission_type = strategy.commission.percent, commission_value = 1)
if bar_index == 0
    strategy.entry("E", strategy.${direction}, qty = 2, limit = 100)
if bar_index == 1 and strategy.position_size != 0
    strategy.close("E")
`);
    const trade = context.strategy.closedtrades[0];
    return {
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        commission: round(trade.commission ?? 0),
        profit: round(trade.profit ?? 0),
        netProfit: round(context.strategy.netprofit),
    };
}

describe('strategy limit entry fill price', () => {
    it.each([
        ['long', { entryPrice: 95, exitPrice: 110, commission: 4.1, profit: 25.9, netProfit: 25.9 }],
        ['short', { entryPrice: 105, exitPrice: 90, commission: 3.9, profit: 26.1, netProfit: 26.1 }],
    ] as const)('%s favorable gap uses the better open with exact commission and pnl', async (direction, expected) => {
        expect(await runClosedGap(direction)).toEqual(expected);
    });

    it.each([
        ['long', [candle(0, 110, 111, 109), candle(1, 105, 106, 99)]],
        ['short', [candle(0, 90, 91, 89), candle(1, 95, 101, 94)]],
    ] as const)('%s intrabar touch fills at the limit with no limit slippage', async (direction, bars) => {
        const context = await new PineTS([...bars]).run(`//@version=6
strategy("touch", initial_capital = 100000, default_qty_type = strategy.fixed, slippage = 50)
if bar_index == 0
    strategy.entry("E", strategy.${direction}, qty = 2, limit = 100)
`);

        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(100);
        expect(context.strategy.position_avg_price).toBe(100);
    });

    it('backtest assumption changes eligibility only and keeps the favorable open price', async () => {
        const bars = [
            candle(0, 105, 106, 104),
            candle(1, 99.99, 101, 99.99),
            candle(2, 99.99, 101, 99.97),
        ];
        const context = await new PineTS(bars).run(`//@version=6
strategy("assumption", initial_capital = 100000, default_qty_type = strategy.fixed, backtest_fill_limits_assumption = 2)
if bar_index == 0
    strategy.entry("E", strategy.long, qty = 2, limit = 100)
`);

        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0].entry_bar_index).toBe(2);
        expect(context.strategy.opentrades[0].entry_price).toBe(99.99);
    });
});

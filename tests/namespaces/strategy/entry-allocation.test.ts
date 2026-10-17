// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import type { Kline } from '../../../src/marketData/types';
import type { StrategyState, Trade } from '../../../src/namespaces/strategy/types';

type AllocationRule = 'FIFO' | 'ANY';

interface LotSnapshot {
    readonly entryId: string;
    readonly size: number;
    readonly entryPrice: number;
    readonly commission: number;
    readonly exitPrice?: number;
    readonly profit?: number;
}

interface AllocationSnapshot {
    readonly closed: readonly LotSnapshot[];
    readonly open: readonly LotSnapshot[];
    readonly positionSize: number;
    readonly positionAvgPrice: number;
    readonly positionEntryName: string;
    readonly netProfit: number;
    readonly grossProfit: number;
    readonly grossLoss: number;
}

const HOUR_MS = 60 * 60 * 1000;
const PRICES = [90, 100, 110, 115, 120] as const;
const HIGHS = [95, 105, 119, 125, 121] as const;

const BARS: Kline[] = PRICES.map((open, index) => ({
    openTime: index * HOUR_MS,
    closeTime: (index + 1) * HOUR_MS - 1,
    open,
    high: HIGHS[index],
    low: open - 5,
    close: open,
    volume: 1,
    quoteAssetVolume: 0,
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    ignore: 0,
}));

const EXPECTED: Readonly<Record<AllocationRule, AllocationSnapshot>> = {
    FIFO: {
        closed: [
            { entryId: 'A', size: 0.2, entryPrice: 100, exitPrice: 120, commission: 0.44, profit: 3.56 },
            { entryId: 'B', size: 0.2, entryPrice: 110, exitPrice: 120, commission: 0.46, profit: 1.54 },
        ],
        open: [{ entryId: 'B', size: 0.2, entryPrice: 110, commission: 0.22 }],
        positionSize: 0.2,
        positionAvgPrice: 110,
        positionEntryName: 'B',
        netProfit: 4.88,
        grossProfit: 5.1,
        grossLoss: 0.22,
    },
    ANY: {
        closed: [{ entryId: 'B', size: 0.4, entryPrice: 110, exitPrice: 120, commission: 0.92, profit: 3.08 }],
        open: [{ entryId: 'A', size: 0.2, entryPrice: 100, commission: 0.2 }],
        positionSize: 0.2,
        positionAvgPrice: 100,
        positionEntryName: 'A',
        netProfit: 2.88,
        grossProfit: 3.08,
        grossLoss: 0.2,
    },
};

function round(value: number): number {
    return Math.round(value * 1e10) / 1e10;
}

function snapshotLot(trade: Trade): LotSnapshot {
    return {
        entryId: trade.entry_id,
        size: round(Math.abs(trade.size)),
        entryPrice: trade.entry_price,
        commission: round(trade.commission ?? 0),
        ...(trade.exit_price === undefined ? {} : { exitPrice: trade.exit_price }),
        ...(trade.profit === undefined ? {} : { profit: round(trade.profit) }),
    };
}

function snapshot(state: StrategyState): AllocationSnapshot {
    return {
        closed: state.closedtrades.map(snapshotLot),
        open: state.opentrades.map(snapshotLot),
        positionSize: round(state.position_size),
        positionAvgPrice: state.position_avg_price,
        positionEntryName: state.position_entry_name,
        netProfit: round(state.netprofit),
        grossProfit: round(state.grossprofit),
        grossLoss: round(state.grossloss),
    };
}

async function runAllocation(rule: AllocationRule): Promise<StrategyState> {
    const ruleOption = rule === 'ANY' ? ', close_entries_rule = "ANY"' : '';
    const context = await new PineTS(BARS).run(`//@version=6
strategy("allocation", pyramiding = 2, initial_capital = 100000, default_qty_type = strategy.fixed, commission_type = strategy.commission.percent, commission_value = 1${ruleOption})
if bar_index == 0
    strategy.entry("A", strategy.long, qty = 0.2)
if bar_index == 1
    strategy.entry("B", strategy.long, qty = 0.4)
    strategy.exit("XB", "B", qty = 0.4, limit = 120)
`);
    return context.strategy;
}

describe('strategy close_entries_rule allocation', () => {
    it('default FIFO closes A 0.2 then B 0.2 and leaves B 0.2', async () => {
        expect(snapshot(await runAllocation('FIFO'))).toEqual(EXPECTED.FIFO);
    });

    it('ANY closes B 0.4 and leaves A 0.2', async () => {
        expect(snapshot(await runAllocation('ANY'))).toEqual(EXPECTED.ANY);
    });

    it.each(['FIFO', 'ANY'] as const)('%s partial allocation conserves quantity, commission, and pnl', async (rule) => {
        const state = await runAllocation(rule);
        const closedQty = state.closedtrades.reduce((total, trade) => total + Math.abs(trade.size), 0);
        const openQty = state.opentrades.reduce((total, trade) => total + Math.abs(trade.size), 0);
        const closedCommission = state.closedtrades.reduce((total, trade) => total + (trade.commission ?? 0), 0);
        const openCommission = state.opentrades.reduce((total, trade) => total + (trade.commission ?? 0), 0);
        const closedProfit = state.closedtrades.reduce((total, trade) => total + (trade.profit ?? 0), 0);

        expect(round(closedQty + openQty)).toBe(0.6);
        expect(round(closedCommission + openCommission)).toBe(1.12);
        expect(round(closedProfit - openCommission)).toBe(EXPECTED[rule].netProfit);
        expect(round(state.position_size)).toBe(round(openQty));
    });
});

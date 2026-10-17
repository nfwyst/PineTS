import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const DAY = 86_400_000;
const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function bar(day: number, minute: number, open: number, close: number) {
    const openTime = START + day * DAY + minute * MINUTE;
    return {
        open,
        high: Math.max(open, close) + 1,
        low: Math.min(open, close) - 1,
        close,
        volume: 1,
        openTime,
        closeTime: openTime + MINUTE,
    };
}

async function run(source: string, marketData: ReturnType<typeof bar>[]) {
    return new PineTS(marketData, 'TEST', '1').run(source);
}

function values(context: Awaited<ReturnType<typeof run>>, title: string): number[] {
    return context.plots[title].data.map((point) => point.value);
}

describe('strategy.risk day-scoped rules', () => {
    it('closes the position at the fill limit and resets the limit next day', async () => {
        const marketData = [
            bar(0, 0, 100, 100),
            bar(0, 1, 100, 100),
            bar(0, 2, 100, 100),
            bar(1, 0, 100, 100),
            bar(1, 1, 100, 100),
            bar(1, 2, 100, 100),
        ];
        const context = await run(`//@version=6
strategy("filled-order-risk", pyramiding = 10)
strategy.risk.max_intraday_filled_orders(1)
strategy.entry("L", strategy.long, qty = 1)
plot(strategy.position_size, "position")
plot(strategy.closedtrades + 0, "closed")`, marketData);

        expect(values(context, 'position')).toEqual([0, 0, 0, 0, 0, 0]);
        expect(values(context, 'closed').at(-1)).toBe(2);
    });

    it('halts on intraday equity loss and allows entries in the next day', async () => {
        const marketData = [
            bar(0, 0, 100, 100),
            bar(0, 1, 100, 90),
            bar(0, 2, 90, 90),
            bar(1, 0, 100, 100),
            bar(1, 1, 100, 100),
        ];
        const context = await run(`//@version=6
strategy("intraday-loss-risk", initial_capital = 1000, pyramiding = 10)
strategy.risk.max_intraday_loss(5, strategy.cash)
strategy.entry("L", strategy.long, qty = 1)
plot(strategy.position_size, "position")`, marketData);

        expect(values(context, 'position')[1]).toBe(0);
        expect(values(context, 'position').at(-1)).toBe(1);
    });

    it('counts losing days rather than losing trades', async () => {
        const marketData = [
            bar(0, 0, 100, 100),
            bar(0, 1, 100, 90),
            bar(0, 2, 100, 100),
            bar(0, 3, 100, 90),
            bar(1, 0, 100, 100),
            bar(1, 1, 100, 100),
        ];
        const context = await run(`//@version=6
strategy("consecutive-loss-days", initial_capital = 1000)
strategy.risk.max_cons_loss_days(2)
if bar_index == 0 or bar_index == 2 or bar_index == 4
    strategy.entry("L", strategy.long, qty = 1)
if bar_index == 1 or bar_index == 3
    strategy.close("L", immediately = true)
plot(strategy.position_size, "position")`, marketData);

        expect(context.strategy?.risk_halted).toBe(false);
        expect(values(context, 'position').at(-1)).toBe(1);
    });
});

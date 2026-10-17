import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

const START = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;

function bars(count: number) {
    return Array.from({ length: count }, (_, index) => ({
        open: index + 1,
        high: index + 2,
        low: index,
        close: (index + 1) * 10,
        volume: 1,
        openTime: START + index * MINUTE,
        closeTime: START + (index + 1) * MINUTE,
    }));
}

const SOURCE = `//@version=6
indicator("run-contract")
plot(close, "c")`;

describe('PineTS.run periods contract', () => {
    it('clamps a period count larger than the available history', async () => {
        const context = await new PineTS(bars(3), 'X', '1').run(SOURCE, 5);

        expect(context.plots.c.data.map((point) => point.value)).toEqual([10, 20, 30]);
    });

    it.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid periods %s with a RangeError',
        async (periods) => {
            await expect(new PineTS(bars(3), 'X', '1').run(SOURCE, periods)).rejects.toThrow(RangeError);
        },
    );
});

describe('PineTS.run paginated plot contract', () => {
    it('returns stable page-local plot data', async () => {
        const pages = [];
        const yieldedLengths: number[] = [];
        const iterator = new PineTS(bars(5), 'X', '1').run(SOURCE, undefined, 2);

        for await (const page of iterator) {
            pages.push(page);
            yieldedLengths.push(page.plots.c.data.length);
        }

        expect(yieldedLengths).toEqual([2, 2, 1]);
        expect(pages.map((page) => page.plots.c.data.length)).toEqual([2, 2, 1]);
        expect(pages[0].plots.c).not.toBe(pages[1].plots.c);
    });
});

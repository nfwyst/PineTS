import { describe, expect, it } from 'vitest';
import { Indicator } from '../../src/Indicator';
import { PineTS } from '../../src/PineTS.class';

const bars = [2, 3, 4].map((close, index) => ({
    openTime: Date.UTC(2024, 0, index + 1),
    closeTime: Date.UTC(2024, 0, index + 2) - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
}));

function engine(): PineTS {
    return new PineTS(bars, 'TEST', 'D', undefined, undefined, undefined, {
        resolveLibrary: async () => `//@version=6
library("Values")
export float identity(float value) => value`,
    });
}

function source(body: string): string {
    return `//@version=6
indicator("Library analysis")
import test/Values/1 as values
${body}`;
}

describe('linked library script analysis', () => {
    it('applies distinct input overrides when two inputs share a title', async () => {
        const indicator = new Indicator(source(`first = input.int(2, "Shared")
second = input.int(3, "Shared")
plot(values.identity(first), "first")
plot(values.identity(second), "second")`));
        indicator.input.first = 7;
        indicator.input.second = 11;

        const context = await engine().run(indicator);

        expect(context.plots.first.data.map((point) => point.value)).toEqual([7, 7, 7]);
        expect(context.plots.second.data.map((point) => point.value)).toEqual([11, 11, 11]);
    });

    it('rejects a series input default even when a library is imported', async () => {
        const script = source('value = input.float(close)\nplot(value)');

        await expect(engine().run(script)).rejects.toThrow(/const float/);
    });

    it('uses input IDs for inline inputs with the same title', async () => {
        const indicator = new Indicator(source(`plot(input.int(2, "Shared"), "first")
plot(input.int(3, "Shared"), "second")`), { in_0: 7, in_1: 11 });

        const context = await engine().run(indicator);

        expect(context.plots.first.data.map((point) => point.value)).toEqual([7, 7, 7]);
        expect(context.plots.second.data.map((point) => point.value)).toEqual([11, 11, 11]);
    });

    it('rejects a series length for ta.atr even when a library is imported', async () => {
        const script = source('series int length = 2\nplot(ta.atr(length))');

        await expect(engine().run(script)).rejects.toThrow(/simple int/);
    });

    it('keeps library inputs separate from root IDs and uses the library Pine version', async () => {
        const pine = new PineTS(bars, 'TEST', 'D', undefined, undefined, undefined, {
            resolveLibrary: async () => `//@version=5
library("Values")
hidden = input.int(7 / 2)
export float identity(float value) => value
export const int DEFAULT = 5`,
        });
        const indicator = new Indicator(source(`plot(input.int(values.DEFAULT), "default")
plot(input.int(2, "Shared"), "override")`), { in_1: 11 });

        const context = await pine.run(indicator);

        expect(context.plots.default.data.map((point) => point.value)).toEqual([5, 5, 5]);
        expect(context.plots.override.data.map((point) => point.value)).toEqual([11, 11, 11]);
    });
});

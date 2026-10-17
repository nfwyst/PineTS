import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import fixtureData from './data/change-fractional-tv.json';

type ExpectedValue = number | null;

interface PlotPoint {
    readonly value: number;
}

interface PlotSeries {
    readonly data: readonly PlotPoint[];
}

interface ChangeFixture {
    readonly closes: readonly number[];
    readonly change13: readonly ExpectedValue[];
    readonly seriesChange: readonly ExpectedValue[];
}

const fixture: ChangeFixture = fixtureData;
const HOUR_MS = 60 * 60 * 1000;
const START_MS = Date.UTC(2024, 0, 1);
const candles = fixture.closes.map((close, index) => ({
    openTime: START_MS + index * HOUR_MS,
    closeTime: START_MS + (index + 1) * HOUR_MS - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
}));

function plotValues(plots: Record<string, PlotSeries>, title: string): readonly number[] {
    return plots[title].data.map((point) => point.value);
}

function expectSeries(actual: readonly number[], expected: readonly ExpectedValue[]): void {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((value, index) => {
        if (value === null) {
            expect(Number.isNaN(actual[index]), `bar ${index}`).toBe(true);
        } else {
            expect(actual[index], `bar ${index}`).toBe(value);
        }
    });
}

async function runPlots(body: string): Promise<Record<string, PlotSeries>> {
    const { plots } = await new PineTS(candles).run(`//@version=6
indicator("change length normalization")
${body}`);
    return plots;
}

describe('ta.change length normalization', () => {
    it('floors fractional 40/3 to the TradingView 13-bar oracle and isolates call sites', async () => {
        const plots = await runPlots(`
plot(ta.change(close, 40 / 3), "fractional")
plot(ta.change(close, 13), "integer")
`);

        const fractional = plotValues(plots, 'fractional');
        const integer = plotValues(plots, 'integer');
        expect(fractional.slice(13).every(Number.isNaN), 'fractional lookback must not use a JS fractional property').toBe(false);
        expectSeries(fractional, fixture.change13);
        expectSeries(integer, fixture.change13);
        expect(fractional).toEqual(integer);
    });

    it('rejects zero length with the TradingView greater-than-zero error', async () => {
        const run = runPlots('plot(ta.change(close, 0), "zero")');
        await expect(run).rejects.toThrowError(/Invalid value of the 'length' argument \(0\).*must be > 0/);
    });

    it('rejects negative length with the TradingView greater-than-zero error', async () => {
        const run = runPlots('plot(ta.change(close, -1), "negative")');
        await expect(run).rejects.toThrowError(/Invalid value of the 'length' argument \(-1\).*must be > 0/);
    });

    it('rejects na length with the TradingView non-na error', async () => {
        const run = runPlots(`int length = na
plot(ta.change(close, length), "na")`);
        await expect(run).rejects.toThrowError(/Invalid value of the 'length' argument.*must not be na/);
    });

    it('normalizes a series-fractional length at each use', async () => {
        const plots = await runPlots(`
float length = bar_index % 2 == 0 ? 8 / 3 : 11 / 3
plot(ta.change(close, length), "series")
`);

        expectSeries(plotValues(plots, 'series'), fixture.seriesChange);
    });
});

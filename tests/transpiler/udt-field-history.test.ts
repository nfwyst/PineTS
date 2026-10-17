// SPDX-License-Identifier: AGPL-3.0-only

import { PineTS } from '../../src/PineTS.class';
import { describe, expect, it } from 'vitest';

type PlotMap = Record<string, { readonly data?: readonly { readonly value: number }[] }>;

const candles = [10, 20, 30, 40, 50, 60].map((low, index) => ({
    openTime: index + 1,
    closeTime: index + 2,
    open: low + 1,
    high: low + 2,
    low,
    close: low + 1,
    volume: 1,
}));

function plotValues(plots: PlotMap, title: string): readonly number[] {
    return (plots[title]?.data ?? []).map((row) => row.value);
}

function expectHistoryToMatch(plots: PlotMap, actualTitle: string, expectedTitle: string): void {
    const actual = plotValues(plots, actualTitle);
    const expected = plotValues(plots, expectedTitle).slice(-actual.length);
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
}

async function run(source: string) {
    return new PineTS(candles).run(source);
}

describe('UDT field history', () => {
    it('reads prior field values from a mutable var instance', async () => {
        const { plots } = await run(`//@version=6
indicator("var field history")
type Bar
    float value
var Bar b = Bar.new(0.0)
b.value := low
plot(b.value, "now")
plot(b.value[1], "previous")
plot(b.value[3], "previous3")
plot(low[1], "control1")
plot(low[3], "control3")
`);

        expectHistoryToMatch(plots, 'previous', 'control1');
        expectHistoryToMatch(plots, 'previous3', 'control3');
        expect(plotValues(plots, 'previous')).not.toEqual(plotValues(plots, 'now').slice(-plotValues(plots, 'previous').length));
    });

    it('reads prior field values from a mutable varip instance in Pine v5', async () => {
        // Given / When
        const { plots } = await run(`//@version=5
indicator("varip field history")
type Bar
    float value
varip Bar b = Bar.new(0.0)
b.value := low
plot(b.value[1], "actual")
plot(low[1], "control")
`);

        // Then
        expectHistoryToMatch(plots, 'actual', 'control');
    });

    it('scopes a variable field-history index', async () => {
        const { plots } = await run(`//@version=6
indicator("variable index")
type Bar
    float value
var Bar b = Bar.new(0.0)
b.value := low
n = input.int(2, minval=1)
plot(b.value[n], "actual")
plot(low[2], "control")
`);

        expectHistoryToMatch(plots, 'actual', 'control');
    });

    it('scopes a reassigned field-history index', async () => {
        const { plots } = await run(`//@version=6
indicator("reassigned index")
type Bar
    float value
var Bar b = Bar.new(0.0)
b.value := low
n = input.int(3, minval=1)
n := n > 2 ? 2 : n
plot(b.value[n], "actual")
plot(low[2], "control")
`);

        expectHistoryToMatch(plots, 'actual', 'control');
    });

    it('keeps per-bar UDT instance history aligned with builtin history', async () => {
        const { plots } = await run(`//@version=6
indicator("per-bar field history")
type Bar
    float value
Bar b = Bar.new(low)
plot(b.value[1], "actual1")
plot(b.value[2], "actual2")
plot(low[1], "control1")
plot(low[2], "control2")
`);

        expectHistoryToMatch(plots, 'actual1', 'control1');
        expectHistoryToMatch(plots, 'actual2', 'control2');
    });

    it('keeps a persistent UDT field history aligned through a typed UDF parameter', async () => {
        const { plots } = await run(`//@version=6
indicator("var UDT parameter field history")
type Bar
    float value
previous(Bar item) => item.value[1]
var Bar item = Bar.new(0.0)
item.value := low
plot(previous(item), "actual")
plot(low[1], "control")
`);

        expect(plotValues(plots, 'actual')).toEqual(plotValues(plots, 'control'));
    });
});

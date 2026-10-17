// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { Indicator, PineTS, Provider } from 'index';
import type { Context } from '../../src/Context.class';

const CHART_START = Date.parse('2019-01-01T00:00:00.000Z');
const CHART_END = Date.parse('2019-03-01T00:00:00.000Z');

const SOURCE = `//@version=5
indicator("secondary script")
len = input.int(3, "Len")
plot(request.security(syminfo.tickerid, "W", ta.sma(close, len)), "weekly")`;

function makePineTS(): PineTS {
    return new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, CHART_START, CHART_END);
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title].data.map((point: { readonly value: number }) => point.value);
}

describe('request secondary script execution', () => {
    it('missing slice fallback runs the parent prepared function instead of run(null)', async () => {
        const expected = plotValues(await makePineTS().run(SOURCE), 'weekly');
        expect(expected.some(Number.isFinite)).toBe(true);

        const prepared = new Indicator(SOURCE).prepare();
        const wrapper = ($: Context) => prepared.fn($);
        const actual = await makePineTS().runPretranspiled(wrapper, prepared.inputs);

        expect(actual.transpiledFn).toBe(wrapper);
        expect(plotValues(actual, 'weekly')).toEqual(expected);
    });

    it('slice path preserves parent inputs', async () => {
        const expectedSource = SOURCE.replace('input.int(3,', 'input.int(5,');
        const expected = plotValues(await makePineTS().run(expectedSource), 'weekly');
        const defaultValues = plotValues(await makePineTS().run(SOURCE), 'weekly');

        const actual = await makePineTS().run(new Indicator(SOURCE, { Len: 5 }));

        expect(plotValues(actual, 'weekly')).toEqual(expected);
        expect(plotValues(actual, 'weekly')).not.toEqual(defaultValues);
    });

    it('missing slice fallback preserves parent inputs', async () => {
        const expectedSource = SOURCE.replace('input.int(3,', 'input.int(5,');
        const expected = plotValues(await makePineTS().run(expectedSource), 'weekly');
        const prepared = new Indicator(SOURCE, { Len: 5 }).prepare();
        const wrapper = ($: Context) => prepared.fn($);

        const actual = await makePineTS().runPretranspiled(wrapper, prepared.inputs);

        expect(plotValues(actual, 'weekly')).toEqual(expected);
    });
});

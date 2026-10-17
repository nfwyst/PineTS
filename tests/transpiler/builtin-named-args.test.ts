// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/Context.class';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

type PlotPoint = { readonly value: number };

function makePineTS(): PineTS {
    return new PineTS(Provider.Mock, 'BTCUSDC', '1h', 30, Date.UTC(2024, 0, 1));
}

async function runPlots(body: string): Promise<Context> {
    return makePineTS().run(`//@version=6
indicator("built-in named args")
${body}`);
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title].data.map((point: PlotPoint) => point.value);
}

function compileExpression(expression: string) {
    return pineToJS(`//@version=6
indicator("invalid built-in named args")
value = ${expression}
plot(value)`);
}

describe('built-in named arguments', () => {
    it('binds named-only, reordered, and mixed ta.sma arguments', async () => {
        const context = await runPlots(`
plot(ta.sma(close, 5), "positional")
plot(ta.sma(length = 5, source = close), "named")
plot(ta.sma(close, length = 5), "mixed")`);

        const positional = plotValues(context, 'positional');
        expect(positional.some(Number.isFinite)).toBe(true);
        expect(plotValues(context, 'named')).toEqual(positional);
        expect(plotValues(context, 'mixed')).toEqual(positional);
    });

    it('selects both ta.pivothigh overloads by their bound arguments', async () => {
        const context = await runPlots(`
plot(ta.pivothigh(high, 2, 2), "source_positional")
plot(ta.pivothigh(rightbars = 2, source = high, leftbars = 2), "source_named")
plot(ta.pivothigh(high, rightbars = 2, leftbars = 2), "source_mixed")
plot(ta.pivothigh(2, 2), "default_positional")
plot(ta.pivothigh(rightbars = 2, leftbars = 2), "default_named")`);

        const sourcePositional = plotValues(context, 'source_positional');
        const defaultPositional = plotValues(context, 'default_positional');
        expect(sourcePositional.some(Number.isFinite)).toBe(true);
        expect(defaultPositional.some(Number.isFinite)).toBe(true);
        expect(plotValues(context, 'source_named')).toEqual(sourcePositional);
        expect(plotValues(context, 'source_mixed')).toEqual(sourcePositional);
        expect(plotValues(context, 'default_named')).toEqual(defaultPositional);
    });

    it('binds named-only, reordered, and mixed math.max arguments', async () => {
        const context = await runPlots(`
plot(math.max(high, 5), "positional")
plot(math.max(x = 5, source = high), "named")
plot(math.max(high, x = 5), "mixed")`);

        const positional = plotValues(context, 'positional');
        expect(positional.every(Number.isFinite)).toBe(true);
        expect(plotValues(context, 'named')).toEqual(positional);
        expect(plotValues(context, 'mixed')).toEqual(positional);
    });

    it('rejects an unknown built-in named argument before runtime', () => {
        expect(compileExpression('ta.sma(source = close, period = 5)')).toMatchObject({
            success: false,
            error: 'Unknown named argument "period" in call to "ta.sma()". Expected one of: source, length.',
        });
    });

    it('rejects a duplicate positional and named built-in argument before runtime', () => {
        expect(compileExpression('ta.sma(close, source = open, length = 5)')).toMatchObject({
            success: false,
            error: 'Argument "source" is supplied more than once in call to "ta.sma()".',
        });
    });

    it('rejects an ambiguous built-in overload before runtime', () => {
        expect(compileExpression('ta.pivothigh(rightbars = 2)')).toMatchObject({
            success: false,
            error: 'Ambiguous overload for "ta.pivothigh()" with arguments: rightbars.',
        });
    });
});

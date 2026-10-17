// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/Context.class';
import { PineTS } from '../../src/PineTS.class';
import { transpile } from '../../src/transpiler';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const DECLARATION_ERROR = 'Only one study can be in a script';
const PUBLIC_DECLARATION_ERROR = `Failed to transpile Pine Script version 6: ${DECLARATION_ERROR}`;
const MARKET_DATA = [
    {
        openTime: Date.UTC(2024, 0, 1),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_000,
        closeTime: Date.UTC(2024, 0, 2) - 1,
    },
];

const INVALID_DECLARATIONS = [
    {
        name: 'missing top-level declaration',
        source: `//@version=6
runtime.error("runtime sentinel: missing declaration executed")`,
    },
    {
        name: 'multiple indicator declarations',
        source: `//@version=6
indicator("one")
indicator("two")
runtime.error("runtime sentinel: multiple declarations executed")`,
    },
    {
        name: 'mixed indicator and strategy declarations',
        source: `//@version=6
indicator("one")
strategy("two")
runtime.error("runtime sentinel: mixed declarations executed")`,
    },
    {
        name: 'missing declaration when the only lookalike is nested',
        source: `//@version=6
helper() =>
    indicator("nested")
runtime.error("runtime sentinel: nested declaration executed")`,
    },
] as const;

describe('Pine declaration validation', () => {
    it.each(INVALID_DECLARATIONS)('rejects $name before runtime', async ({ source }) => {
        await expect(new PineTS(MARKET_DATA).run(source)).rejects.toThrowError(PUBLIC_DECLARATION_ERROR);

        const result = pineToJS(source);
        expect(result).toMatchObject({ success: false, version: 6, error: DECLARATION_ERROR });
        expect(result).not.toHaveProperty('code');
    });

    it('runs exactly one indicator declaration', async () => {
        const context = await new PineTS(MARKET_DATA).run(`//@version=6
indicator("one")
plot(close, "out")`);

        expect(context.indicator.title).toBe('one');
        expect(context.plots['out'].data[0].value).toBe(101);
    });

    it('runs exactly one strategy declaration', async () => {
        const context = await new PineTS(MARKET_DATA).run(`//@version=6
strategy("one")
plot(close, "out")`);

        expect(context.strategy.config.title).toBe('one');
        expect(context.plots['out'].data[0].value).toBe(101);
    });

    it('transpiles exactly one library declaration', () => {
        const source = `//@version=6
library("one")`;

        expect(pineToJS(source)).toMatchObject({ success: true, version: 6 });
        expect(typeof transpile(source)).toBe('function');
    });

    it('accepts exactly one declaration in a top-level statement sequence', () => {
        expect(() => transpile(`//@version=6
indicator("one"), plot(close)`)).not.toThrow();
    });

    it('comments, nested lookalikes, and user identifiers do not alter the count', async () => {
        const context = await new PineTS(MARKET_DATA).run(`//@version=6
// strategy("comment") and library("comment") are not declarations.
indicatorLabel = 41
indicatorHelper() =>
    strategy("nested")
indicator("one")
plot(indicatorLabel + 1, "out")`);

        expect(context.indicator.title).toBe('one');
        expect(context.plots['out'].data[0].value).toBe(42);
    });

    it('does not apply the Pine declaration rule to PineTS function syntax', async () => {
        const context = await new PineTS(MARKET_DATA).run(($: Context) => {
            const { close } = $.data;
            return { close };
        });

        expect(context.result.close).toEqual([101]);
    });
});

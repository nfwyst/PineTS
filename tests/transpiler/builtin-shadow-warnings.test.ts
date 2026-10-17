// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CW10011 — user bindings that shadow bare built-in variables.
 * TradingView compiles these but prints:
 *   `Shadowing built-in variable "second"`.
 */

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const pine = (body: string) => `//@version=6\nindicator("t")\n${body}\nplot(close)\n`;

const warningsOf = (src: string): string[] => {
    const r = pineToJS(src);
    expect(r.success, r.success ? '' : r.error).toBe(true);
    return (r as any).warnings.map((w: any) => w.message);
};

describe('CW10011 shadowing built-in variables', () => {
    it('warns when a top-level variable shadows a built-in (second)', () => {
        expect(warningsOf(pine('second = close'))).toContain('Shadowing built-in variable "second"');
    });

    it('warns for each OHLCV / time-component shadow', () => {
        for (const name of ['open', 'high', 'low', 'close', 'volume', 'hour', 'minute', 'year', 'month', 'bar_index']) {
            expect(warningsOf(pine(`${name} = 1.0`))).toContain(`Shadowing built-in variable "${name}"`);
        }
    });

    it('warns on a shadowing function parameter', () => {
        const src = pine('f(float close) => close + 1\nx = f(2.0)');
        expect(warningsOf(src)).toContain('Shadowing built-in variable "close"');
    });

    it('warns on a shadowing for-loop variable', () => {
        const src = pine('s = 0\nfor high = 0 to 3\n    s += high');
        expect(warningsOf(src)).toContain('Shadowing built-in variable "high"');
    });

    it('warns on a for-in loop variable shadowing a built-in', () => {
        const src = pine('arr = array.from(1.0, 2.0)\ns = 0.0\nfor low in arr\n    s += low');
        expect(warningsOf(src)).toContain('Shadowing built-in variable "low"');
    });

    it('does NOT warn for ordinary user names', () => {
        expect(warningsOf(pine('secondBar = close\nx = 1'))).toEqual([]);
    });

    it('does NOT warn for namespace names (color, line, table)', () => {
        // Those are namespace identifiers, not built-in variables; Pine
        // resolves color.new etc. via a separate disambiguation rule.
        expect(warningsOf(pine('color = close > open'))).toEqual([]);
    });

    it('does NOT warn when reusing an outer user variable name in a nested scope', () => {
        const src = pine('x = 1\nif bar_index > 0\n    x := 2');
        expect(warningsOf(src)).toEqual([]);
    });

    it('does not block compilation: code is still produced', () => {
        const r = pineToJS(pine('second = close'));
        expect(r.success).toBe(true);
        expect(typeof r.code).toBe('string');
    });
});

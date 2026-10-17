// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CW10013 — declaring a variable in a nested scope with `=` when the same name
 * is already bound in a visible parent scope. TradingView compiles but warns
 * and suggests `:=`.
 */

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const pine = (body: string) => `//@version=6\nindicator("t")\n${body}\nplot(close)\n`;

const warningNames = (src: string): { code: string; name: string; line: number }[] => {
    const r = pineToJS(src);
    expect(r.success, r.success ? '' : r.error).toBe(true);
    return (r as any).warnings
        .filter((w: any) => w.code === 'CW10013')
        .map((w: any) => ({ code: w.code, name: w.name, line: w.line }));
};

describe('CW10013 parent-scope variable shadowing', () => {
    it('warns when re-declaring a function-local inside a nested if with =', () => {
        const src = pine(
            'f() =>\n    float top = 1.0\n    if close > open\n        top = 2.0\n    top\nx = f()\nplot(x)',
        );
        expect(warningNames(src)).toContainEqual({ code: 'CW10013', name: 'top', line: 6 });
    });

    it('does NOT warn when mutating the parent variable with :=', () => {
        const src = pine(
            'f() =>\n    float top = 1.0\n    if close > open\n        top := 2.0\n    top\nx = f()\nplot(x)',
        );
        expect(warningNames(src)).toEqual([]);
    });

    it('does NOT warn for the first declaration in a nested block', () => {
        const src = pine('f() =>\n    if close > open\n        float top = 2.0\n    top\nx = f()\nplot(x)');
        expect(warningNames(src)).toEqual([]);
    });

    it('warns for a for-loop body re-declaring an outer local', () => {
        const src = pine(
            'f() =>\n    float s = 0.0\n    for i = 0 to 3\n        s = 1.0\n    s\nx = f()\nplot(x)',
        );
        expect(warningNames(src)).toContainEqual({ code: 'CW10013', name: 's', line: 6 });
    });

    it('does NOT warn for a function parameter named like a global (fresh binding chain)', () => {
        const src = pine('top = close\ng(float top) => top + 1.0\nplot(g(2.0))');
        expect(warningNames(src)).toEqual([]);
    });

    it('warns when a global variable is re-declared with = inside a top-level if', () => {
        const src = pine('x = 0\nif close > open\n    x = 1\nplot(x)');
        expect(warningNames(src)).toContainEqual({ code: 'CW10013', name: 'x', line: 5 });
    });

    it('keels CW10011 and CW10013 distinct when a nested block shadows builtin-name parent', () => {
        const src = pine('second = 1\nf() =>\n    float second = 2.0\n    second\nplot(f())');
        const r = pineToJS(src);
        expect(r.success).toBe(true);
        const codes = (r as any).warnings.map((w: any) => w.code);
        // The function-local `second` is in a fresh chain vs global, so it only
        // carries CW10011 (shadowing builtin), not CW10013.
        expect(codes).toContain('CW10011');
        expect(codes).not.toContain('CW10013');
    });
});

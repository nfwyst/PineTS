// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CW10011 end-to-end: pineToJS compile warnings must survive transpilation and
 * be attached to the runnable function so the Context/CLI can surface them
 * (previously the warning was only visible on the pineToJS() return value, so
 * `pinets run` never printed it).
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler';

const pine = (body: string) => `//@version=6\nindicator("t")\n${body}\nplot(close)\n`;

describe('CW10011 propagation to transpiled function', () => {
    it('attaches shadow warnings to the transpiled function', () => {
        const fn = transpile(pine('second = close')) as any;
        expect(Array.isArray(fn._compileWarnings)).toBe(true);
        const messages = fn._compileWarnings.map((w: any) => w.message);
        expect(messages).toContain('Shadowing built-in variable "second"');
        const second = fn._compileWarnings.find((w: any) => w.name === 'second');
        expect(second.code).toBe('CW10011');
        expect(second.line).toBeGreaterThan(0);
    });

    it('attaches no compile warnings for a clean script', () => {
        const fn = transpile(pine('x = close + 1')) as any;
        expect(fn._compileWarnings ?? []).toEqual([]);
    });
});

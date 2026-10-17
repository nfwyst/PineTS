// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * User-defined type (UDT) field default validation.
 *
 * TradingView CE10133: the default value of a `type` field must be a
 * compile-time constant — a literal, `na`, a signed literal, or a qualified
 * built-in constant (`color.red`, an enum value). Function calls (including
 * `array.new<float>()`), user variables and calculations are rejected.
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler/index';

const pine = (...lines: string[]) => ['//@version=6', 'indicator("t")', ...lines].join('\n') + '\n';

describe('UDT field default values (CE10133)', () => {
    const accepted = [
        'float a = 1',
        'float a = -1.5',
        'bool a = true',
        'string a = "x"',
        'float a = na',
        'color a = color.red',
        'int a = 0',
        // Bare series-qualified builtins are legal UDT field defaults:
        // the field defaults to that builtin on every bar (Pine v5/v6).
        'float a = close',
        'float a = low',
        'float a = hl2',
    ];

    for (const field of accepted) {
        it(`accepts constant field default: ${field}`, () => {
            expect(() => transpile(pine('type T', '    ' + field, 'plot(close)'))).not.toThrow();
        });
    }

    // A bare *user-declared* variable is rejected too (only builtins are
    // allowed), but distinguishing that needs the qualifier/input analysis
    // pass; the parser-level rule rejects the shapes TradingView flags with
    // CE10133 unconditionally: calls, calculations, ternaries.
    const rejected: Array<[string, string]> = [
        ['array<float> a = array.new<float>()', 'function call'],
        ['float a = math.max(1, 2)', 'namespace function call'],
        ['float a = 1 + 1', 'calculation'],
        ['float a = input.int(5)', 'input call'],
        ['float a = color.new(color.red, 0)', 'constructor call'],
        ['float a = close > open ? 1 : 0', 'ternary calculation'],
    ];

    for (const [field, label] of rejected) {
        it(`rejects non-constant field default: ${label}`, () => {
            // Field starts on source line 3 at column 5 ("    <type> name = ..."),
            // the value begins right after "= "; use the message without position
            // so the test stays robust to exact column arithmetic.
            expect(() => transpile(pine('type T', '    ' + field, 'plot(close)'))).toThrow(
                /The default value cannot be a function, variable or calculation\./,
            );
        });
    }

    it('reports the error position at the default value (CE10133)', () => {
        // 4:25 = the start of array.new on the indented field line
        // (//@version=6, indicator, type, field).
        expect(() =>
            transpile(
                pine('type Box', '    array<float> vals = array.new<float>()', 'plot(close)'),
            ),
        ).toThrow(/at 4:25/);
    });

    it('still runs a type whose fields have literal defaults', async () => {
        const { PineTS } = await import('../../src/PineTS.class');
        const { Provider } = await import('../../src/marketData/Provider.class');
        const code = pine(
            'type T',
            '    float x = 1.0',
            '    color c = color.red',
            'var T t = T.new()',
            'plot(t.x)',
        );
        const r = await new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2024-06-01').getTime(), new Date('2024-06-05').getTime()).run(code);
        expect(r).toBeDefined();
    });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { transpile } from '../../src/transpiler/index';

const pine = (body: string): string => `//@version=6
indicator("qualifier compatibility")
${body}`;

const timeframeSwitchChain = (parameterType: string): string => pine(`f_tf(${parameterType} label) =>
    switch label
        "Hour" => "60"
        => "240"
selected = f_tf(input.string("Hour"))
length = timeframe.in_seconds(selected) > 60 ? 14 : 5
plot(ta.atr(length))`);

describe('Pine qualifier compatibility', () => {
    it('rejects a series argument for an explicitly simple user-function parameter', () => {
        // Given
        const source = pine(`f_engine(simple int atrLength) =>
    ta.atr(atrLength)
series int technicalAtrLength = 14
plot(f_engine(technicalAtrLength))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "f_engine" with argument "atrLength"="technicalAtrLength". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('rejects a series length passed directly to ta.atr', () => {
        // Given
        const source = pine(`series int length = 14
plot(ta.atr(length))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "ta.atr" with argument "length"="length". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('infers a simple user-function parameter from its ta.atr usage', () => {
        // Given
        const source = pine(`f_engine(int atrLength) =>
    ta.atr(atrLength)
series int technicalAtrLength = 14
plot(f_engine(technicalAtrLength))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "f_engine" with argument "atrLength"="technicalAtrLength". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('accepts a const caller when a simple requirement flows through a binary expression', () => {
        // Given
        const source = pine(`f(int n) =>
    ta.atr(n + 1)
plot(f(13))`);

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });

    it('accepts an input caller when a simple requirement flows through a binary expression', () => {
        // Given
        const source = pine(`f(int n) =>
    ta.atr(n + 1)
inputLength = input.int(13)
plot(f(inputLength))`);

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });

    it('rejects a series caller after inferring a binary-expression parameter as simple', () => {
        // Given
        const source = pine(`f(int n) =>
    ta.atr(n + 1)
series int seriesLength = 13
plot(f(seriesLength))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "f" with argument "n"="seriesLength". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('keeps an unrelated series capture series inside a binary expression', () => {
        // Given
        const source = pine(`f(int n) =>
    ta.atr(n + bar_index)
plot(f(13))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "ta.atr" with argument "length"="call "operator +" (series int)". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('accepts a const caller when a simple requirement flows through a local alias', () => {
        // Given
        const source = pine(`f(int n) =>
    x = n + 1
    ta.atr(x)
plot(f(13))`);

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });

    it('rejects a series caller when a simple requirement flows through a local alias', () => {
        // Given
        const source = pine(`f(int n) =>
    x = n + 1
    ta.atr(x)
series int seriesLength = bar_index
plot(f(seriesLength))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "f" with argument "n"="seriesLength". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('accepts a unary expression derived from an unproven typed parameter', () => {
        // Given
        const source = pine(`f(int n) =>
    ta.atr(+n)
plot(f(14))`);

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });

    it('accepts a ternary expression derived from an unproven typed parameter', () => {
        // Given
        const source = pine(`f(int n) =>
    ta.atr(n > 5 ? n : 5)
plot(f(14))`);

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });

    it('still rejects an explicitly series parameter in an unsupported expression form', () => {
        // Given
        const source = pine(`f(series int n) =>
    ta.atr(+n)
plot(f(14))`);

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "ta.atr" with argument "length"="call "operator +" (series int)". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('preserves weaker-to-simple and series-to-series calls', () => {
        // Given
        const source = pine(`f_simple(simple int length) =>
    length
f_series(series int value) =>
    value
const int constLength = 14
simple int simpleLength = 14
inputLength = input.int(14)
series int seriesValue = bar_index
plot(ta.atr(constLength))
plot(ta.atr(simpleLength))
plot(ta.atr(inputLength))
plot(ta.atr(f_simple(inputLength)))
plot(f_series(seriesValue))`);

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });

    it('rejects the original switch-timeframe chain when a typed UDF parameter defaults to series', () => {
        // Given
        const source = timeframeSwitchChain('string');

        // When / Then
        expect(() => transpile(source)).toThrow(
            'Cannot call "ta.atr" with argument "length"="length". ' +
                'An argument of "series int" type was used but a "simple int" is expected.',
        );
    });

    it('accepts the switch-timeframe chain after its UDF parameter is simple', () => {
        // Given
        const source = timeframeSwitchChain('simple string');

        // When
        const compile = (): void => {
            transpile(source);
        };

        // Then
        expect(compile).not.toThrow();
    });
});

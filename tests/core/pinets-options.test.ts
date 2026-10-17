// SPDX-License-Identifier: AGPL-3.0-only

import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { Indicator } from '../../src/Indicator';
import { PineTS } from '../../src/PineTS.class';
import type { IProvider } from '../../src/marketData/IProvider';
import type { LibraryImportRequest } from '../../src/types/PineTypes';

const BARS = [
    {
        openTime: Date.UTC(2024, 0, 1),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 10,
        closeTime: Date.UTC(2024, 0, 2) - 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    },
];

const SOURCE = `//@version=6
indicator("Host options")
plot(close)`;

const invalidCases: readonly { readonly label: string; readonly options: unknown; readonly message: string }[] = [
    { label: 'options object', options: null, message: '[PineTS] options must be an object.' },
    { label: 'theme object', options: { chartTheme: null }, message: '[PineTS] options.chartTheme must be an object.' },
    {
        label: 'missing background',
        options: { chartTheme: { foreground: '#ffffff' } },
        message: '[PineTS] options.chartTheme.background must be a non-empty string.',
    },
    {
        label: 'blank foreground',
        options: { chartTheme: { background: '#000000', foreground: '  ' } },
        message: '[PineTS] options.chartTheme.foreground must be a non-empty string.',
    },
    { label: 'resolver', options: { resolveLibrary: 'nope' }, message: '[PineTS] options.resolveLibrary must be a function.' },
];

function providerThatMustNotLoad(): { readonly provider: IProvider; readonly getMarketData: ReturnType<typeof vi.fn> } {
    const getMarketData = vi.fn(async () => BARS);
    const provider: IProvider = {
        getMarketData,
        async getSymbolInfo(): Promise<never> {
            throw new TypeError('getSymbolInfo must not run');
        },
        configure(): void {},
    };
    return { provider, getMarketData };
}

describe('PineTS host options', () => {
    it('exports host options, library, and alert types from the package root', () => {
        const entryPath = resolve(process.cwd(), 'src/index.ts');
        const program = ts.createProgram([entryPath], {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            target: ts.ScriptTarget.ESNext,
        });
        const checker = program.getTypeChecker();
        const sourceFile = program.getSourceFile(entryPath);
        if (sourceFile === undefined) throw new TypeError(`Missing source file: ${entryPath}`);
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (moduleSymbol === undefined) throw new TypeError('Missing package-root module symbol');
        const exported = new Set(checker.getExportsOfModule(moduleSymbol).map(({ name }) => name));

        const expected = [
            'AlertEvent',
            'ChartTheme',
            'LibraryImportRequest',
            'LibraryResolver',
            'PineTSOptions',
            'ResolvedPineTSOptions',
        ];
        expect(expected.filter((name) => !exported.has(name))).toEqual([]);
    });

    it('keeps legacy constructor calls backward compatible', async () => {
        const pine = new PineTS(BARS);

        await pine.ready();

        expect(pine.options.chartTheme).toEqual({ background: '#1e293b', foreground: '#d1d4dc' });
        expect(pine.options.resolveLibrary).toBeUndefined();
    });

    it('keeps host options isolated and immutable per instance', async () => {
        const firstResolver = vi.fn(async ({ name }: LibraryImportRequest): Promise<string | undefined> => name);
        const secondResolver = vi.fn(async ({ version }: LibraryImportRequest): Promise<string | undefined> => version);
        const firstTheme = { background: '#101010', foreground: '#f0f0f0' };
        const secondTheme = { background: '#202020', foreground: '#e0e0e0' };
        const firstInput = { chartTheme: firstTheme, resolveLibrary: firstResolver };
        const secondInput = { chartTheme: secondTheme, resolveLibrary: secondResolver };

        const first = new PineTS(BARS, undefined, undefined, undefined, undefined, undefined, firstInput);
        const second = new PineTS(BARS, undefined, undefined, undefined, undefined, undefined, secondInput);

        expect(first.options).not.toBe(second.options);
        expect(first.options.chartTheme).not.toBe(second.options.chartTheme);
        expect(first.options.chartTheme).toEqual({ background: '#101010', foreground: '#f0f0f0' });
        expect(second.options.chartTheme).toEqual({ background: '#202020', foreground: '#e0e0e0' });
        expect(first.options.resolveLibrary).toBe(firstResolver);
        expect(second.options.resolveLibrary).toBe(secondResolver);
        expect(Object.keys(first.options).sort()).toEqual(['chartTheme', 'resolveLibrary']);
        expect(Object.isFrozen(first.options)).toBe(true);
        expect(Object.isFrozen(first.options.chartTheme)).toBe(true);

        firstTheme.background = '#ffffff';
        firstInput.resolveLibrary = secondResolver;

        expect(first.options.chartTheme.background).toBe('#101010');
        expect(first.options.resolveLibrary).toBe(firstResolver);
    });

    it('threads options through Indicator preparation and Context without resolving libraries', async () => {
        const resolveLibrary = vi.fn(async ({ user }: LibraryImportRequest): Promise<string | undefined> => user);
        const pine = new PineTS(BARS, undefined, undefined, undefined, undefined, undefined, {
            chartTheme: { background: '#303030', foreground: '#fafafa' },
            resolveLibrary,
        });
        const indicator = new Indicator(SOURCE);
        const prepare = vi.spyOn(indicator, 'prepare');

        const context = await pine.run(indicator);

        expect(prepare).toHaveBeenCalledWith({ debug: false, ln: false, resolveLibrary });
        expect(context.hostOptions).toBe(pine.options);
        expect(context.hostOptions.chartTheme).toEqual({ background: '#303030', foreground: '#fafafa' });
        expect(context.hostOptions.resolveLibrary).toBe(resolveLibrary);
        expect(resolveLibrary).not.toHaveBeenCalled();
    });

    it.each(invalidCases)('rejects invalid $label before provider work begins', ({ options, message }) => {
        const { provider, getMarketData } = providerThatMustNotLoad();

        expect(() => Reflect.construct(PineTS, [provider, 'TEST', 'D', undefined, undefined, undefined, options])).toThrow(
            new TypeError(message),
        );
        expect(getMarketData).not.toHaveBeenCalled();
    });
});

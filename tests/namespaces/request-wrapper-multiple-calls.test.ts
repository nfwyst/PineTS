// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS, Provider } from 'index';
import { Context } from '../../src/Context.class';

const START = Date.parse('2024-01-01T00:00:00.000Z');
const END = Date.parse('2024-01-15T00:00:00.000Z');
const CALL_CASES = [
    { name: 'same timeframe', firstTimeframe: '240', secondTimeframe: '240', secondSource: 'open' },
    { name: 'different timeframes', firstTimeframe: '240', secondTimeframe: 'D', secondSource: 'close' },
] as const;

function makePineTS(timeframe: string): PineTS {
    return new PineTS(Provider.Mock, 'BTCUSDC', timeframe, null, START, END);
}

async function runScript(timeframe: string, body: string): Promise<Context> {
    return makePineTS(timeframe).run(`//@version=6
indicator("request wrapper calls")
${body}`);
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title].data.map((point: { readonly value: number }) => point.value);
}

function expectPlotsToMatch(actual: Context, expected: Context, titles: readonly string[]): void {
    for (const title of titles) {
        expect(plotValues(actual, title)).toEqual(plotValues(expected, title));
    }
}

function expectIsolatedSecondaryState(context: Context, isLowerTimeframe: boolean, expectedSliceCount = 1): void {
    const suffix = isLowerTimeframe ? '_lower' : '';
    const cacheEntries = Object.entries(context.cache).filter(([key]) => key.startsWith('BTCUSDC_') && key.endsWith(suffix));
    const slicesValue = Reflect.get(context, '_ltfTruncatedBodies');
    const slices = typeof slicesValue === 'object' && slicesValue !== null ? slicesValue : {};
    const sliceFunctions = Object.values(slices);
    const expressionNames: string[] = [];

    expect(cacheEntries).toHaveLength(2);
    expect(sliceFunctions).toHaveLength(expectedSliceCount);
    for (const [key, entry] of cacheEntries) {
        if (typeof entry !== 'object' || entry === null) throw new TypeError(`Invalid secondary cache entry: ${key}`);
        const secondary = Reflect.get(entry, 'context');
        const secondaryPineTS = Reflect.get(entry, 'pineTS');
        if (!(secondary instanceof Context) || !(secondaryPineTS instanceof PineTS)) throw new TypeError(`Invalid secondary state: ${key}`);
        const expressionName = Object.keys(secondary.params).find((name) => key.endsWith(`${name}${suffix}`));
        if (expressionName === undefined) throw new TypeError(`Missing path-isolated expression: ${key}`);
        expressionNames.push(expressionName);
        expect(sliceFunctions).toContain(secondaryPineTS.transpiledCode);
    }
    expect(new Set(expressionNames).size).toBe(2);
}

describe('request wrappers called more than once', () => {
    it.each(CALL_CASES)('keeps HTF scalar results isolated for $name', async ({ firstTimeframe, secondTimeframe, secondSource }) => {
        const actual = await runScript('60', `
f(string tf, float source) => request.security(syminfo.tickerid, tf, ta.sma(source, 2))
plot(f("${firstTimeframe}", close), "first")
plot(f("${secondTimeframe}", ${secondSource}), "second")`);
        const expected = await runScript('60', `
plot(request.security(syminfo.tickerid, "${firstTimeframe}", ta.sma(close, 2)), "first")
plot(request.security(syminfo.tickerid, "${secondTimeframe}", ta.sma(${secondSource}, 2)), "second")`);

        expectPlotsToMatch(actual, expected, ['first', 'second']);
        expectIsolatedSecondaryState(actual, false);
    });

    it.each(CALL_CASES)('keeps HTF tuple results isolated for $name', async ({ firstTimeframe, secondTimeframe, secondSource }) => {
        const actual = await runScript('60', `
f(string tf, float source) => request.security(syminfo.tickerid, tf, [ta.sma(source, 2), ta.ema(source, 3)])
[firstSma, firstEma] = f("${firstTimeframe}", close)
[secondSma, secondEma] = f("${secondTimeframe}", ${secondSource})
plot(firstSma, "firstSma")
plot(firstEma, "firstEma")
plot(secondSma, "secondSma")
plot(secondEma, "secondEma")`);
        const expected = await runScript('60', `
[firstSma, firstEma] = request.security(syminfo.tickerid, "${firstTimeframe}", [ta.sma(close, 2), ta.ema(close, 3)])
[secondSma, secondEma] = request.security(syminfo.tickerid, "${secondTimeframe}", [ta.sma(${secondSource}, 2), ta.ema(${secondSource}, 3)])
plot(firstSma, "firstSma")
plot(firstEma, "firstEma")
plot(secondSma, "secondSma")
plot(secondEma, "secondEma")`);

        expectPlotsToMatch(actual, expected, ['firstSma', 'firstEma', 'secondSma', 'secondEma']);
        expectIsolatedSecondaryState(actual, false);
    });

    it.each(CALL_CASES)('keeps LTF scalar results isolated for $name', async ({ firstTimeframe, secondTimeframe, secondSource }) => {
        const firstLower = firstTimeframe === '240' ? '60' : firstTimeframe;
        const secondLower = secondTimeframe === 'D' ? '240' : '60';
        const actual = await runScript('D', `
f(string tf, float source) => request.security_lower_tf(syminfo.tickerid, tf, ta.sma(source, 2))
first = f("${firstLower}", close)
second = f("${secondLower}", ${secondSource})
plot(first.size(), "firstSize")
plot(first.first(), "firstValue")
plot(second.size(), "secondSize")
plot(second.first(), "secondValue")`);
        const expected = await runScript('D', `
first = request.security_lower_tf(syminfo.tickerid, "${firstLower}", ta.sma(close, 2))
second = request.security_lower_tf(syminfo.tickerid, "${secondLower}", ta.sma(${secondSource}, 2))
plot(first.size(), "firstSize")
plot(first.first(), "firstValue")
plot(second.size(), "secondSize")
plot(second.first(), "secondValue")`);

        expectPlotsToMatch(actual, expected, ['firstSize', 'firstValue', 'secondSize', 'secondValue']);
        expectIsolatedSecondaryState(actual, true);
    });

    it.each(CALL_CASES)('keeps LTF tuple results isolated for $name', async ({ firstTimeframe, secondTimeframe, secondSource }) => {
        const firstLower = firstTimeframe === '240' ? '60' : firstTimeframe;
        const secondLower = secondTimeframe === 'D' ? '240' : '60';
        const actual = await runScript('D', `
f(string tf, float source) => request.security_lower_tf(syminfo.tickerid, tf, [ta.sma(source, 2), ta.ema(source, 3)])
[firstSma, firstEma] = f("${firstLower}", close)
[secondSma, secondEma] = f("${secondLower}", ${secondSource})
plot(firstSma.first(), "firstSma")
plot(firstEma.first(), "firstEma")
plot(secondSma.first(), "secondSma")
plot(secondEma.first(), "secondEma")`);
        const expected = await runScript('D', `
[firstSma, firstEma] = request.security_lower_tf(syminfo.tickerid, "${firstLower}", [ta.sma(close, 2), ta.ema(close, 3)])
[secondSma, secondEma] = request.security_lower_tf(syminfo.tickerid, "${secondLower}", [ta.sma(${secondSource}, 2), ta.ema(${secondSource}, 3)])
plot(firstSma.first(), "firstSma")
plot(firstEma.first(), "firstEma")
plot(secondSma.first(), "secondSma")
plot(secondEma.first(), "secondEma")`);

        expectPlotsToMatch(actual, expected, ['firstSma', 'firstEma', 'secondSma', 'secondEma']);
        expectIsolatedSecondaryState(actual, true);
    });

    it('keeps both HTF request results in a tuple-returning wrapper', async () => {
        const actual = await runScript('60', `
f(string tf) =>
    requestedClose = request.security(syminfo.tickerid, tf, close)
    requestedOpen = request.security(syminfo.tickerid, tf, open)
    [requestedClose, requestedOpen]
[wrappedClose, wrappedOpen] = f("240")
plot(wrappedClose, "close")
plot(wrappedOpen, "open")`);
        const expected = await runScript('60', `
plot(request.security(syminfo.tickerid, "240", close), "close")
plot(request.security(syminfo.tickerid, "240", open), "open")`);

        expectPlotsToMatch(actual, expected, ['close', 'open']);
        expectIsolatedSecondaryState(actual, false, 2);
    });

    it('conditional request invocation returns na instead of reading another callsite params', async () => {
        const context = await runScript('60', `
float requested = na
if timeframe.period == "60"
    requested := request.security(syminfo.tickerid, "240", close)
plot(requested, "conditional")`);
        const values = plotValues(context, 'conditional');

        expect(values).toHaveLength(context.marketData.length);
        expect(values.every(Number.isNaN)).toBe(true);
    });
});

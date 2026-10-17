// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import type { Context } from '../../src/Context.class';
import { Indicator } from '../../src/Indicator';
import { PineTS } from '../../src/PineTS.class';
import type { LibraryImportRequest, LibraryResolver } from '../../src/types/PineTypes';

const BARS = [2, 3, 4].map((close, index) => ({
    openTime: Date.UTC(2024, 0, index + 1),
    closeTime: Date.UTC(2024, 0, index + 2) - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
}));

const GEOMETRY_V1 = `//@version=6
library("Geometry")
export type Point
    float value
export enum Direction
    up = "Up"
    down = "Down"
export const float SCALE = 2.0
export float scale(float value) => value * SCALE
export Point makePoint(float value) => Point.new(value)
float hidden(float value) => value`;

const GEOMETRY_V2 = `//@version=6
library("Geometry")
export const float SCALE = 3.0
export float scale(float value) => value * SCALE`;

const FACADE = `//@version=6
library("Facade")
import alice/Geometry/1 as geometry
export float nested(float value) => geometry.scale(value) + geometry.SCALE`;

const MAIN = `//@version=6
indicator("Libraries")
import bob/Facade/1 as facade
import alice/Geometry/1 as oldGeo
import alice/Geometry/2 as newGeo
oldValue = oldGeo.scale(value = close)
newValue = newGeo.scale(close)
nestedValue = facade.nested(close)
oldGeo.Point point = na
point := oldGeo.makePoint(close)
directionValue = oldGeo.Direction.up == "Up" ? 1 : 0
plot(oldValue, "old")
plot(newValue, "new")
plot(nestedValue, "nested")
plot(point.value, "point")
plot(oldGeo.SCALE, "constant")
plot(directionValue, "enum")`;

const keyOf = ({ user, name, version }: LibraryImportRequest): string => `${user}/${name}/${version}`;

function makeResolver(sources: ReadonlyMap<string, string>): ReturnType<typeof vi.fn<LibraryResolver>> {
    return vi.fn<LibraryResolver>(async (request) => sources.get(keyOf(request)));
}

function makePine(resolveLibrary?: LibraryResolver): PineTS {
    return new PineTS(BARS, undefined, undefined, undefined, undefined, undefined, { resolveLibrary });
}

function plotValues(context: Context, title: string): unknown[] {
    return context.plots[title].data.map((point) => point.value);
}

describe('Pine library resolver', () => {
    it('runs nested versioned libraries with isolated exported functions, types, enums, and consts', async () => {
        const resolver = makeResolver(new Map([
            ['bob/Facade/1', FACADE],
            ['alice/Geometry/1', GEOMETRY_V1],
            ['alice/Geometry/2', GEOMETRY_V2],
        ]));

        const context = await makePine(resolver).run(MAIN);

        expect(plotValues(context, 'old')).toEqual([4, 6, 8]);
        expect(plotValues(context, 'new')).toEqual([6, 9, 12]);
        expect(plotValues(context, 'nested')).toEqual([6, 8, 10]);
        expect(plotValues(context, 'point')).toEqual([2, 3, 4]);
        expect(plotValues(context, 'constant')).toEqual([2, 2, 2]);
        expect(plotValues(context, 'enum')).toEqual([1, 1, 1]);
        expect(resolver.mock.calls.map(([request]) => request)).toEqual([
            { user: 'bob', name: 'Facade', version: '1', from: '<main>' },
            { user: 'alice', name: 'Geometry', version: '1', from: 'bob/Facade/1' },
            { user: 'alice', name: 'Geometry', version: '2', from: '<main>' },
        ]);
    });

    it('deduplicates concurrent exact-version resolution on one PineTS instance', async () => {
        let release: () => void = () => undefined;
        let markStarted: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        const resolver = vi.fn<LibraryResolver>(async () => {
            markStarted();
            await gate;
            return GEOMETRY_V1;
        });
        const source = `//@version=6
indicator("Concurrent")
import alice/Geometry/1 as geo
plot(geo.scale(close), "value")`;
        const pine = makePine(resolver);
        const indicator = new Indicator(source);

        const first = pine.run(indicator);
        const second = pine.run(indicator);
        await started;

        expect(resolver).toHaveBeenCalledTimes(1);
        release();
        const [firstContext, secondContext] = await Promise.all([first, second]);
        expect(plotValues(firstContext, 'value')).toEqual([4, 6, 8]);
        expect(plotValues(secondContext, 'value')).toEqual([4, 6, 8]);
        await pine.run(source);
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('keeps resolver caches isolated between PineTS instances', async () => {
        const source = `//@version=6
indicator("Isolated")
import alice/Value/1 as lib
plot(lib.VALUE, "value")`;
        const firstResolver = makeResolver(new Map([['alice/Value/1', `//@version=6
library("Value")
export const float VALUE = 11.0`]]));
        const secondResolver = makeResolver(new Map([['alice/Value/1', `//@version=6
library("Value")
export const float VALUE = 22.0`]]));
        const indicator = new Indicator(source);

        const [first, second] = await Promise.all([makePine(firstResolver).run(indicator), makePine(secondResolver).run(indicator)]);

        expect(plotValues(first, 'value')).toEqual([11, 11, 11]);
        expect(plotValues(second, 'value')).toEqual([22, 22, 22]);
        expect(firstResolver).toHaveBeenCalledTimes(1);
        expect(secondResolver).toHaveBeenCalledTimes(1);
    });

    it('reports a cycle with the complete chain and closing import span', async () => {
        const resolver = makeResolver(new Map([
            ['alice/A/1', `//@version=6
library("A")
import alice/B/1 as b
export float value(float source) => b.value(source)`],
            ['alice/B/1', `//@version=6
library("B")
import alice/A/1 as a
export float value(float source) => a.value(source)`],
        ]));
        const source = `//@version=6
indicator("Cycle")
import alice/A/1 as a
plot(a.value(close), "value")`;

        await expect(makePine(resolver).run(source)).rejects.toThrow(
            'Library import cycle at alice/B/1:3:1-3:22: <main> -> alice/A/1 -> alice/B/1 -> alice/A/1',
        );
    });

    it('reports missing source with the complete chain and import span', async () => {
        const source = `//@version=6
indicator("Missing")
import alice/Missing/1 as missing
plot(close)`;
        const resolver = makeResolver(new Map());
        const pine = makePine(resolver);
        const expected =
            'Library alice/Missing/1 imported as "missing" at <main>:3:1-3:34 could not be resolved (import chain: <main> -> alice/Missing/1)';

        await expect(pine.run(source)).rejects.toThrow(expected);
        await expect(pine.run(source)).rejects.toThrow(expected);
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('keeps a resolved library source on its own Pine language version', async () => {
        const resolver = makeResolver(new Map([['alice/Strict/1', `//@version=5
library("Strict")
export bool check() => false and runtime.error("v5 library evaluated the right operand")`]]));
        const source = `//@version=6
indicator("Versioned library")
import alice/Strict/1 as strict
plot(strict.check() ? 1 : 0)`;

        await expect(makePine(resolver).run(source)).rejects.toThrow('v5 library evaluated the right operand');
    });

    it('applies compile-time and runtime version semantics independently per library', async () => {
        const resolver = makeResolver(new Map([
            ['alice/Versioned/5', `//@version=5
library("Versioned")
bool[] globalValues = array.new_bool(1)
export type Flag
    bool value
export float ratio() => 5 / 2
export float defaultBool() =>
    Flag flag = Flag.new()
    na(flag.value) ? 2 : 3
export float defaultArrayBool() =>
    bool[] values = array.new_bool(1)
    na(values.get(0)) ? 4 : 5
export float globalArrayBool() => na(globalValues.get(0)) ? 6 : 7
export string chartPeriod() => timeframe.period`],
            ['alice/Versioned/6', `//@version=6
library("Versioned")
bool[] globalValues = array.new_bool(1)
export type Flag
    bool value
export float ratio() => 5 / 2
export float defaultBool() =>
    Flag flag = Flag.new()
    flag.value ? 1 : 3
export float defaultArrayBool() =>
    bool[] values = array.new_bool(1)
    na(values.get(0)) ? 4 : 5
export float globalArrayBool() => na(globalValues.get(0)) ? 6 : 7
export string chartPeriod() => timeframe.period`],
        ]));
        const source = `//@version=6
indicator("Library versions")
import alice/Versioned/5 as v5
import alice/Versioned/6 as v6
plot(v5.ratio(), "v5 ratio")
plot(v6.ratio(), "v6 ratio")
plot(v5.defaultBool(), "v5 bool")
plot(v6.defaultBool(), "v6 bool")
plot(v5.defaultArrayBool(), "v5 array bool")
plot(v6.defaultArrayBool(), "v6 array bool")
plot(v5.globalArrayBool(), "v5 global array bool")
plot(v6.globalArrayBool(), "v6 global array bool")
plot(v5.chartPeriod() == "D" ? 1 : 0, "v5 period")
plot(v6.chartPeriod() == "1D" ? 1 : 0, "v6 period")`;

        const context = await new PineTS(BARS, 'TEST', 'D', undefined, undefined, undefined, { resolveLibrary: resolver }).run(source);

        expect(plotValues(context, 'v5 ratio')).toEqual([2, 2, 2]);
        expect(plotValues(context, 'v6 ratio')).toEqual([2.5, 2.5, 2.5]);
        expect(plotValues(context, 'v5 bool')).toEqual([2, 2, 2]);
        expect(plotValues(context, 'v6 bool')).toEqual([3, 3, 3]);
        expect(plotValues(context, 'v5 array bool')).toEqual([4, 4, 4]);
        expect(plotValues(context, 'v6 array bool')).toEqual([5, 5, 5]);
        expect(plotValues(context, 'v5 global array bool')).toEqual([6, 6, 6]);
        expect(plotValues(context, 'v6 global array bool')).toEqual([7, 7, 7]);
        expect(plotValues(context, 'v5 period')).toEqual([1, 1, 1]);
        expect(plotValues(context, 'v6 period')).toEqual([1, 1, 1]);
    });

    it('preserves an imported const int for Pine v5 constant division', async () => {
        const resolver = makeResolver(new Map([['alice/Constants/1', `//@version=6
library("Constants")
export const int FIVE = 5`]]));
        const source = `//@version=5
indicator("Imported const int division")
import alice/Constants/1 as constants
plot(constants.FIVE / 2, "ratio")`;

        const context = await makePine(resolver).run(source);

        expect(plotValues(context, 'ratio')).toEqual([2, 2, 2]);
    });

    it('preserves an imported const int as an int array element', async () => {
        const resolver = makeResolver(new Map([['alice/Constants/1', `//@version=6
library("Constants")
export const int FIVE = 5`]]));
        const source = `//@version=6
indicator("Imported const int array")
import alice/Constants/1 as constants
values = array.from(constants.FIVE, 2)
values.push(1.5)
plot(values.size())`;

        await expect(makePine(resolver).run(source)).rejects.toThrow(/int/);
    });

    it('reports missing export with the complete chain and import span', async () => {
        const resolver = makeResolver(new Map([['alice/Geometry/1', GEOMETRY_V1]]));
        const source = `//@version=6
indicator("Missing export")
import alice/Geometry/1 as geo
plot(geo.hidden(close), "value")`;

        await expect(makePine(resolver).run(source)).rejects.toThrow(
            'Library alice/Geometry/1 has no export "hidden" for alias "geo" at <main>:3:1-3:31 (import chain: <main> -> alice/Geometry/1)',
        );
    });

    it('fails before execution when no resolver is configured', async () => {
        const source = `//@version=6
indicator("No resolver")
import alice/Geometry/1 as geo
plot(close)`;

        await expect(makePine().run(source)).rejects.toThrow(
            'Library resolver is not configured for alice/Geometry/1 imported as "geo" at <main>:3:1-3:31 (import chain: <main> -> alice/Geometry/1)',
        );
    });

    it('emits a stream error before data when a library source is missing', async () => {
        const source = `//@version=6
indicator("Stream error")
import alice/Missing/1 as missing
plot(close)`;
        const pine = makePine(makeResolver(new Map()));
        let dataEvents = 0;

        const error = await new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('stream error timeout')), 1_000);
            const stream = pine.stream(source, { live: false });
            stream.on('data', () => { dataEvents++; });
            stream.on('error', (value) => {
                clearTimeout(timeout);
                stream.stop();
                resolve(value);
            });
        });

        expect(dataEvents).toBe(0);
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw new TypeError('Expected stream error');
        expect(error.message).toBe(
            'Library alice/Missing/1 imported as "missing" at <main>:3:1-3:34 could not be resolved (import chain: <main> -> alice/Missing/1)',
        );
    });
});

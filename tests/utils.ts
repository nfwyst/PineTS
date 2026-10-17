import { PineTS } from 'PineTS.class';
import { Context } from 'Context.class';
import { MockProvider } from '@pinets/marketData/Mock/MockProvider.class';
import type { Kline } from '@pinets/marketData/types';

const fixtureProvider = new MockProvider();

export function getKlines(symbol: string, interval: string, limit?: number, startTime?: number, endTime?: number): Promise<Kline[]> {
    return fixtureProvider.getMarketData(symbol, interval, limit, startTime, endTime);
}

export function arrayPrecision(arr: number[], precision: number = 10) {
    return arr.map((e) => (typeof e === 'number' ? parseFloat(e.toFixed(precision)) : e));
}

function normalizeFiniteNumber(value: number, precision: number): number {
    if (!Number.isFinite(value) || value === 0) return value;
    const normalized = Math.abs(value) < 10 ** -precision
        ? Number(value.toPrecision(precision))
        : Number(value.toFixed(precision));
    return Object.is(normalized, -0) ? 0 : normalized;
}

export function normalizePlotString(value: string, precision: number = 7): string {
    return value.trim().replace(/-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/gi, (token) => {
        const number = Number(token);
        return Number.isFinite(number) ? String(normalizeFiniteNumber(number, precision)) : token;
    });
}

export function normalizeNumericGraph(value: unknown, precision: number = 7): unknown {
    if (typeof value === 'number') return normalizeFiniteNumber(value, precision);
    if (Array.isArray(value)) return value.map((item) => normalizeNumericGraph(item, precision));
    if (value !== null && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNumericGraph(item, precision)]));
    }
    return value;
}

export async function runNSFunctionWithArgs(klines: any[], ns: string, fn: string, ...args) {
    const pineTS = new PineTS(klines);

    let sourceCode = `(context) =>{ 
        const { close, open, high, low, hlc3, volume, hl2, ohlc4 } = context.data;
        const { plotchar, plot, na, ta, math, input } = context.pine;
        

        const values = ${ns}.${fn}(${args.join(',')});

        return {
            values,
        };

     }`;

    const { result } = await pineTS.run(sourceCode);
    return result;
}

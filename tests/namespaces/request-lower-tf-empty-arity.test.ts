// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/Context.class';
import { PineTS } from '../../src/PineTS.class';
import type { IProvider, ISymbolInfo } from '../../src/marketData/IProvider';
import { Provider } from '../../src/marketData/Provider.class';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const START = Date.UTC(2024, 0, 1);

function makeBar(openTime: number, duration: number, close: number): Kline {
    return {
        openTime,
        closeTime: openTime + duration - 1,
        open: close - 1,
        high: close + 1,
        low: close - 2,
        close,
        volume: close * 10,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const CHART_BARS = [makeBar(START, HOUR, 100), makeBar(START + HOUR, HOUR, 101)] as const;
const LOWER_BARS = [makeBar(START + HOUR + 5 * MINUTE, 5 * MINUTE, 201)] as const;

class SparseLowerTimeframeProvider implements IProvider {
    async getMarketData(
        tickerId: string,
        timeframe: string,
        _limit?: number,
        sDate?: number,
        eDate?: number,
    ): Promise<Kline[]> {
        if (tickerId === 'REJECTED') throw new Error('unknown lower-timeframe symbol');
        if (tickerId === 'MISSING') return [];
        const bars = timeframe === '60' ? CHART_BARS : timeframe === '5' ? LOWER_BARS : [];
        return bars
            .filter((bar) => (sDate === undefined || bar.openTime >= sDate) && (eDate === undefined || bar.openTime <= eDate))
            .map((bar) => ({ ...bar }));
    }

    getSymbolInfo(): Promise<ISymbolInfo> {
        return Provider.Mock.getSymbolInfo('BTCUSDC');
    }

    configure(): void {}
}

function makePineTS(): PineTS {
    return new PineTS(new SparseLowerTimeframeProvider(), 'TEST:CHART', '60', undefined, START, START + 2 * HOUR);
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title].data.map((point: { readonly value: number }) => point.value);
}

describe('request.security_lower_tf empty result shape', () => {
    it('preserves bool and string array types when the accepted result is empty', async () => {
        // Given: scalar and tuple expressions whose valid higher-timeframe request is ignored.
        const context = await makePineTS().run(`//@version=6
indicator("typed empty intrabars")
flags = request.security_lower_tf(syminfo.tickerid, "D", close > open, ignore_invalid_timeframe = true)
[tupleFlags, names] = request.security_lower_tf(syminfo.tickerid, "D", [close > open, syminfo.ticker], ignore_invalid_timeframe = true)

// When: values of the declared element types are appended to the empty arrays.
flags.push(true)
tupleFlags.push(false)
names.push("ok")

// Then: each array accepts its own type rather than behaving as array<float>.
plot(flags.size(), "flags")
plot(tupleFlags.size(), "tupleFlags")
plot(names.size(), "names")`);

        expect(plotValues(context, 'flags')).toEqual([1, 1]);
        expect(plotValues(context, 'tupleFlags')).toEqual([1, 1]);
        expect(plotValues(context, 'names')).toEqual([1, 1]);
    });

    it('returns typed empty arrays when an ignored symbol load rejects', async () => {
        // Given: a provider that rejects instead of representing an invalid symbol as empty data.
        const context = await makePineTS().run(`//@version=6
indicator("rejected invalid symbol")
scalar = request.security_lower_tf("REJECTED", "5", close, ignore_invalid_symbol = true)
[flags, names] = request.security_lower_tf("REJECTED", "5", [close > open, syminfo.ticker], ignore_invalid_symbol = true)

// When: the script continues after both ignored load failures.
flags.push(true)
names.push("ok")

// Then: the scalar stays empty and tuple element types remain usable.
plot(scalar.size(), "scalar")
plot(flags.size(), "flags")
plot(names.size(), "names")`);

        expect(plotValues(context, 'scalar')).toEqual([0, 0]);
        expect(plotValues(context, 'flags')).toEqual([1, 1]);
        expect(plotValues(context, 'names')).toEqual([1, 1]);
    });

    it('returns one empty array for a scalar and preserves tuple arity when a valid higher timeframe is ignored', async () => {
        const context = await makePineTS().run(`//@version=6
indicator("ignored higher timeframe")
scalar = request.security_lower_tf(syminfo.tickerid, "D", close, ignore_invalid_timeframe = true)
[opens, closes, volumes] = request.security_lower_tf(syminfo.tickerid, "D", [open, close, volume], ignore_invalid_timeframe = true)
plot(scalar.size(), "scalar")
plot(opens.size(), "opens")
plot(closes.size(), "closes")
plot(volumes.size(), "volumes")`);

        expect(plotValues(context, 'scalar')).toEqual([0, 0]);
        expect(plotValues(context, 'opens')).toEqual([0, 0]);
        expect(plotValues(context, 'closes')).toEqual([0, 0]);
        expect(plotValues(context, 'volumes')).toEqual([0, 0]);
    });

    it('returns empty scalar and tuple arrays on a legal chart bar with no intrabars', async () => {
        const context = await makePineTS().run(`//@version=6
indicator("legal empty intrabars")
scalar = request.security_lower_tf(syminfo.tickerid, "5", close)
[highs, lows] = request.security_lower_tf(syminfo.tickerid, "5", [high, low])
[flags, names] = request.security_lower_tf(syminfo.tickerid, "5", [close > open, syminfo.ticker])
flags.push(true)
names.push("ok")
plot(scalar.size(), "scalar")
plot(highs.size(), "highs")
plot(lows.size(), "lows")
plot(flags.size(), "flags")
plot(names.size(), "names")`);

        expect(plotValues(context, 'scalar')).toEqual([0, 1]);
        expect(plotValues(context, 'highs')).toEqual([0, 1]);
        expect(plotValues(context, 'lows')).toEqual([0, 1]);
        expect(plotValues(context, 'flags')).toEqual([1, 2]);
        expect(plotValues(context, 'names')).toEqual([1, 2]);
    });

    it('preserves scalar and tuple empty arrays when an ignored invalid symbol has no data', async () => {
        const context = await makePineTS().run(`//@version=6
indicator("invalid symbol empty data")
scalar = request.security_lower_tf("MISSING", "5", close, ignore_invalid_symbol = true)
[opens, closes] = request.security_lower_tf("MISSING", "5", [open, close], ignore_invalid_symbol = true)
plot(scalar.size(), "scalar")
plot(opens.size(), "opens")
plot(closes.size(), "closes")`);

        expect(plotValues(context, 'scalar')).toEqual([0, 0]);
        expect(plotValues(context, 'opens')).toEqual([0, 0]);
        expect(plotValues(context, 'closes')).toEqual([0, 0]);
    });

    it('still rejects a symbol load failure when it is not ignored', async () => {
        const run = makePineTS().run(`//@version=6
indicator("rejected symbol")
values = request.security_lower_tf("REJECTED", "5", close)
plot(values.size())`);

        await expect(run).rejects.toThrowError('unknown lower-timeframe symbol');
    });

    it('does not hide a valid secondary expression error behind ignore_invalid_symbol', async () => {
        const run = makePineTS().run(`//@version=6
indicator("secondary expression error")
value = timeframe.period == "5" ? runtime.error("secondary boom") : close
values = request.security_lower_tf(syminfo.tickerid, "5", value, ignore_invalid_symbol = true)
plot(values.size())`);

        await expect(run).rejects.toThrowError('secondary boom');
    });

    it('throws the exact malformed timeframe error even when invalid higher timeframes are ignored', async () => {
        const run = makePineTS().run(`//@version=6
indicator("malformed timeframe")
values = request.security_lower_tf(syminfo.tickerid, "bogus", close, ignore_invalid_timeframe = true)
plot(values.size())`);

        await expect(run).rejects.toThrowError(
            "Invalid value of the 'timeframe' argument ('bogus') in the 'security_lower_tf' function.",
        );
    });

    it('throws the exact error for a non-ignored valid higher timeframe', async () => {
        const run = makePineTS().run(`//@version=6
indicator("non-ignored higher timeframe")
values = request.security_lower_tf(syminfo.tickerid, "D", close)
plot(values.size())`);

        await expect(run).rejects.toThrowError('Timeframe D is not lower than or equal to chart timeframe 60');
    });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import type { Context } from '../../src/Context.class';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const CANDLES = Array.from({ length: 3 }, (_, index) => ({
    openTime: START + index * DAY,
    closeTime: START + (index + 1) * DAY - 1,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000,
}));

const SECURITY_OTHER_SYMBOL_ERROR =
    'request.security needs a market data provider to load MSFT "D": an array data source only holds the chart\'s own symbol and timeframe';
const LOWER_TF_OTHER_SYMBOL_ERROR =
    'request.security_lower_tf needs a market data provider to load MSFT "D": an array data source only holds the chart\'s own symbol and timeframe';
const SECURITY_OTHER_TIMEFRAME_ERROR =
    'request.security needs a market data provider to load AAPL "W": an array data source only holds the chart\'s own symbol and timeframe';
const LOWER_TF_OTHER_TIMEFRAME_ERROR =
    'request.security_lower_tf needs a market data provider to load AAPL "60": an array data source only holds the chart\'s own symbol and timeframe';

function makePineTS(tickerId: string | undefined = 'NASDAQ:AAPL'): PineTS {
    return new PineTS(CANDLES, tickerId, 'D');
}

function plotValues(context: Context, title: string): number[] {
    return context.plots[title].data.map((point: { readonly value: number }) => point.value);
}

describe('request namespaces with an array source', () => {
    it('same symbol and timeframe reuse the chart series', async () => {
        const context = await makePineTS().run(`//@version=6
indicator("same array source")
same = request.security(syminfo.tickerid, "D", close)
sameLower = request.security_lower_tf(syminfo.tickerid, "D", close)
plot(same, "security")
plot(sameLower.first(), "lower")`);

        expect(plotValues(context, 'security')).toEqual(CANDLES.map(({ close }) => close));
        expect(plotValues(context, 'lower')).toEqual(CANDLES.map(({ close }) => close));
    });

    it('empty string symbol and timeframe retain chart defaults', async () => {
        const context = await makePineTS(undefined).run(`//@version=6
indicator("empty defaults")
same = request.security("", "", close)
sameFromSyminfo = request.security(syminfo.tickerid, "", close)
sameLower = request.security_lower_tf("", "", close)
plot(same, "security")
plot(sameFromSyminfo, "syminfo")
plot(sameLower.first(), "lower")`);

        const expected = CANDLES.map(({ close }) => close);
        expect(plotValues(context, 'security')).toEqual(expected);
        expect(plotValues(context, 'syminfo')).toEqual(expected);
        expect(plotValues(context, 'lower')).toEqual(expected);
    });

    it('cross symbol requests fail with exact provider-required errors', async () => {
        await expect(makePineTS().run(`//@version=6
indicator("cross symbol")
plot(request.security("NASDAQ:MSFT", "D", close))`)).rejects.toThrowError(SECURITY_OTHER_SYMBOL_ERROR);

        await expect(makePineTS().run(`//@version=6
indicator("cross symbol lower")
values = request.security_lower_tf("NASDAQ:MSFT", "D", close)
plot(values.size())`)).rejects.toThrowError(LOWER_TF_OTHER_SYMBOL_ERROR);
    });

    it('cross timeframe requests fail with exact provider-required errors', async () => {
        await expect(makePineTS().run(`//@version=6
indicator("cross timeframe")
plot(request.security(syminfo.tickerid, "W", close))`)).rejects.toThrowError(SECURITY_OTHER_TIMEFRAME_ERROR);

        await expect(makePineTS().run(`//@version=6
indicator("cross timeframe lower")
values = request.security_lower_tf(syminfo.tickerid, "60", close)
plot(values.size())`)).rejects.toThrowError(LOWER_TF_OTHER_TIMEFRAME_ERROR);
    });
});

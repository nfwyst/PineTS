// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS, Provider } from 'index';
import type { Kline } from '../../src/marketData/types';

const HOUR = 3_600_000;
const START = Date.UTC(2024, 0, 1);

function candle(openTime: number, duration: number, open: number, close: number): Kline {
    return {
        openTime,
        closeTime: openTime + duration - 1,
        open,
        high: Math.max(open, close) + 1,
        low: Math.min(open, close) - 1,
        close,
        volume: 1_000,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

class SameBarProvider {
    private readonly chart = [
        candle(START, 4 * HOUR, 100, 101),
        candle(START + 4 * HOUR, 4 * HOUR, 101, 102),
    ];
    private readonly lower = Array.from({ length: 8 }, (_, index) => candle(START + index * HOUR, HOUR, 100 + index, 101 + index));

    async getMarketData(_tickerId: string, timeframe: string, _limit?: number, sDate?: number): Promise<Kline[]> {
        const source = timeframe === '60' ? this.lower : this.chart;
        const last = source[source.length - 1];
        return (sDate !== undefined && sDate >= last.openTime ? [last] : source).map((bar) => ({ ...bar }));
    }

    getSymbolInfo(tickerId: string) {
        return Provider.Mock.getSymbolInfo(tickerId);
    }

    configure(): void {}
}

describe('updateTail pretranspiled rollback', () => {
    it('keeps a computed LTF result at 4 intrabars across repeated same-bar ticks', async () => {
        const pine = new PineTS(new SameBarProvider(), 'BTCUSDC', '240');
        const context = await pine.run(`//@version=6
indicator("computed LTF streaming")
values = request.security_lower_tf(syminfo.tickerid, "60", close - open)
plot(values.size(), "size")`);
        const sizes = [context.plots['size'].data.at(-1).value];

        await pine.updateTail(context);
        sizes.push(context.plots['size'].data.at(-1).value);
        await pine.updateTail(context);
        sizes.push(context.plots['size'].data.at(-1).value);

        expect(sizes).toEqual([4, 4, 4]);
    });
});

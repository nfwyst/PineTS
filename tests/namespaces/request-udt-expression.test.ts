// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function candles(closes: readonly number[], duration = MINUTE): Kline[] {
    return closes.map((close, index) => ({
        openTime: START + index * duration,
        closeTime: START + (index + 1) * duration - 1,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    }));
}

const REFERENCE_CASES = [
    {
        expression: 'map',
        setup: `var map<string, float> data = map.new<string, float>()
data.put("value", close)`,
        read: 'requested.get("value")',
        mutate: 'requested.put("value", -1)',
    },
    {
        expression: 'array',
        setup: `var array<float> data = array.new<float>(1, 0)
data.set(0, close)`,
        read: 'requested.get(0)',
        mutate: 'requested.set(0, -1)',
    },
    {
        expression: 'matrix',
        setup: `var matrix<float> data = matrix.new<float>(1, 1, 0)
data.set(0, 0, close)`,
        read: 'requested.get(0, 0)',
        mutate: 'requested.set(0, 0, -1)',
    },
    {
        expression: 'chart point',
        setup: `var chart.point data = chart.point.new(time, bar_index, close)
data.price := close`,
        read: 'requested.price',
        mutate: 'requested.price := -1',
    },
] as const;

describe('request.security object expressions', () => {
    it('returns a user-defined object passed as the positional expression', async () => {
        // Given
        const source = `//@version=6
indicator("UDT request")
type Snap
    float value
Snap snap = Snap.new(close)
Snap requested = request.security(syminfo.tickerid, timeframe.period, snap)
plot(requested.value, "value")`;

        // When
        const context = await new PineTS(candles([1, 2, 3]), 'TEST', '1').run(source);

        // Then
        expect(context.plots.value.data.map((point) => point.value)).toEqual([1, 2, 3]);
    });

    it.each(REFERENCE_CASES)('returns a $expression passed as the positional expression', async ({ setup, read }) => {
        // Given
        const source = `//@version=6
indicator("Collection request")
${setup}
requested = request.security(syminfo.tickerid, timeframe.period, data)
plot(${read}, "value")`;

        // When
        const context = await new PineTS(candles([1, 2, 3]), 'TEST', '1').run(source);

        // Then
        expect(context.plots.value.data.map((point) => point.value)).toEqual([1, 2, 3]);
    });

    it.each(REFERENCE_CASES)('copies a $expression returned from a higher timeframe', async ({ setup, read, mutate }) => {
        // Given
        const chartBars = candles([1, 2, 3, 4]);
        const requestedBars = candles([20, 40], 2 * MINUTE);
        const provider = {
            getMarketData: async (_tickerId: string, timeframe: string) =>
                (timeframe === '2' ? requestedBars : chartBars).map((bar) => ({ ...bar })),
            getSymbolInfo: (tickerId: string) => Provider.Mock.getSymbolInfo(tickerId),
            configure: (): void => {},
        };
        const source = `//@version=6
indicator("Collection HTF request")
${setup}
requested = request.security(syminfo.tickerid, "2", data, lookahead = barmerge.lookahead_on)
value = ${read}
${mutate}
plot(value, "value")`;

        // When
        const context = await new PineTS(provider, 'BTCUSDC', '1').run(source);

        // Then
        expect(context.plots.value.data.map((point) => point.value)).toEqual([20, 20, 40, 40]);
    });
});

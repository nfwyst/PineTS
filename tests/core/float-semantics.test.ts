// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function candles(closes: readonly number[]): Kline[] {
    return closes.map((close, index) => ({
        openTime: START + index * MINUTE,
        closeTime: START + (index + 1) * MINUTE - 1,
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

describe('Pine float semantics', () => {
    it('preserves sub-1e-10 values returned by numeric functions', async () => {
        // Given
        const source = `//@version=6
indicator("small floats")
plot(ta.highest(close * 1e-12, 1), "tiny")`;

        // When
        const context = await new PineTS(candles([1, 1]), 'TEST', '1').run(source);

        // Then
        expect(context.plots.tiny.data.map((point) => point.value)).toEqual([1e-12, 1e-12]);
    });

    it('rounds float operands to nine fractional digits before comparisons', async () => {
        // Given
        const source = `//@version=6
indicator("float comparisons")
plot(1 == 1.0000000004 ? 1 : 0, "equal")
plot(1 < 1.0000000004 ? 1 : 0, "less")`;

        // When
        const context = await new PineTS(candles([1]), 'TEST', '1').run(source);

        // Then
        expect(context.plots.equal.data.at(-1)?.value).toBe(1);
        expect(context.plots.less.data.at(-1)?.value).toBe(0);
    });
});

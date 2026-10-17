// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * A custom provider whose getMarketData() throws or rejects must make run()
 * settle: the main series' error rejects run(); a request.security secondary's
 * error rejects run() too (TradingView stops a script whose requested symbol
 * can't be loaded), unless the call passes `ignore_invalid_symbol = true`, in
 * which case the requested series is na and the context records a warning.
 */

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { IProvider } from '../../src/marketData/IProvider';
import type { Kline } from '../../src/marketData/types';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function dailyBars(n: number): Kline[] {
    return Array.from({ length: n }, (_, i) => {
        const c = 100 + i;
        return {
            openTime: START + i * DAY,
            closeTime: START + (i + 1) * DAY - 1,
            open: c - 1,
            high: c + 1,
            low: c - 2,
            close: c,
            volume: 1000,
            quoteAssetVolume: 0,
            numberOfTrades: 0,
            takerBuyBaseAssetVolume: 0,
            takerBuyQuoteAssetVolume: 0,
            ignore: 0,
        };
    });
}

function providerWith(getMarketData: IProvider['getMarketData']): IProvider {
    return {
        getMarketData,
        getSymbolInfo: (tickerId) => Provider.Mock.getSymbolInfo(tickerId),
        configure: () => undefined,
    };
}

/** Fails the test instead of hanging it when `p` never settles. */
function settleWithin<T>(p: Promise<T>, ms = 3000): Promise<T> {
    return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('run() did not settle')), ms))]);
}

describe('provider errors', () => {
    it('run() rejects with the error a provider rejects with for the main series', async () => {
        const provider = providerWith(
            async () => {
                throw new Error('feed down');
            },
        );
        const pineTS = new PineTS(provider, 'BTCUSDT', 'D');
        await expect(settleWithin(pineTS.run('//@version=5\nindicator("x")\nplot(close)'))).rejects.toThrow('feed down');
    });

    it('run() rejects when getMarketData throws synchronously', async () => {
        const provider = providerWith(
            () => {
                throw new Error('sync boom');
            },
        );
        const pineTS = new PineTS(provider, 'BTCUSDT', 'D');
        await expect(settleWithin(pineTS.run('//@version=5\nindicator("x")\nplot(close)'))).rejects.toThrow('sync boom');
    });

    it('a request.security secondary whose data fails rejects run() with that error', async () => {
        const provider = providerWith(
            async (_tickerId, timeframe) => {
                if (timeframe !== 'D') throw new Error('no weekly data');
                return dailyBars(40);
            },
        );
        const pineTS = new PineTS(provider, 'BTCUSDT', 'D');
        const code = `//@version=5
indicator("x")
plot(request.security(syminfo.tickerid, "W", close), "w")`;
        await expect(settleWithin(pineTS.run(code))).rejects.toThrow('no weekly data');
    });

    it('with ignore_invalid_symbol = true a failed secondary is na plus a warning', async () => {
        let weeklyCalls = 0;
        const provider = providerWith(
            async (_tickerId, timeframe) => {
                if (timeframe !== 'D') {
                    weeklyCalls++;
                    throw new Error('no weekly data');
                }
                return dailyBars(40);
            },
        );
        const pineTS = new PineTS(provider, 'BTCUSDT', 'D');
        const code = `//@version=5
indicator("x")
plot(request.security(syminfo.tickerid, "W", close, ignore_invalid_symbol = true), "w")
plot(close, "c")`;
        const ctx = await settleWithin(pineTS.run(code));
        expect(ctx.plots['w'].data).toHaveLength(40);
        expect(ctx.plots['w'].data.every((point: { value: number }) => Number.isNaN(point.value))).toBe(true);
        expect(ctx.plots['c'].data[39].value).toBe(139);
        // One failed load, not one per bar, and one warning naming the request.
        expect(weeklyCalls).toBe(1);
        const warnings = ctx.warnings.filter((w) => w.method === 'request.security');
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('no weekly data');
    });

    it('does not hide a valid secondary expression error behind ignore_invalid_symbol', async () => {
        const provider = providerWith(async () => dailyBars(40));
        const pineTS = new PineTS(provider, 'BTCUSDT', '60');
        const code = `//@version=6
indicator("secondary expression error")
value = timeframe.isdaily ? runtime.error("secondary boom") : close
plot(request.security(syminfo.tickerid, "D", value, ignore_invalid_symbol = true))`;

        await expect(settleWithin(pineTS.run(code))).rejects.toThrow('secondary boom');
    });

    it('updateTail() rejects when the provider tail request fails', async () => {
        const tailError = new Error('tail feed down');
        let requestCount = 0;
        const provider = providerWith(async () => {
            if (requestCount++ === 0) return dailyBars(2);
            throw tailError;
        });
        const pineTS = new PineTS(provider, 'BTCUSDT', 'D');
        const context = await pineTS.run('//@version=5\nindicator("x")\nplot(close)');

        const update = pineTS.updateTail(context);

        await expect(update).rejects.toBe(tailError);
    });

    it('live stream emits the provider tail error', async () => {
        const tailError = new Error('stream feed down');
        let requestCount = 0;
        const provider = providerWith(async () => {
            if (requestCount++ === 0) return dailyBars(2);
            throw tailError;
        });

        const emittedError = await new Promise<unknown>((resolve, reject) => {
            const stream = new PineTS(provider, 'BTCUSDT', 'D').stream(
                '//@version=5\nindicator("x")\nplot(close)',
                { pageSize: 2, live: true, interval: 0 },
            );
            const timeout = setTimeout(() => {
                stream.stop();
                reject(new Error('stream did not emit the provider error'));
            }, 1_000);
            stream.on('error', (error) => {
                clearTimeout(timeout);
                stream.stop();
                resolve(error);
            });
        });

        expect(emittedError).toBe(tailError);
    });

    it('a PineTS instance whose data never loads does not raise an unhandled rejection', async () => {
        const provider = providerWith(
            async () => {
                throw new Error('never awaited');
            },
        );
        const unhandled: unknown[] = [];
        const onUnhandled = (e: unknown) => unhandled.push(e);
        process.on('unhandledRejection', onUnhandled);
        try {
            new PineTS(provider, 'BTCUSDT', 'D');
            await new Promise((r) => setTimeout(r, 50));
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
        expect(unhandled).toHaveLength(0);
    });
});

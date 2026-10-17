// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/Context.class';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import type { IProvider, ISymbolInfo } from '../../src/marketData/IProvider';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;
const START = Date.UTC(2024, 0, 1);

function bars(count: number): Kline[] {
    return Array.from({ length: count }, (_, index) => ({
        openTime: START + index * MINUTE,
        closeTime: START + (index + 1) * MINUTE - 1,
        open: 100 + index,
        high: 102 + index,
        low: 99 + index,
        close: 101 + index,
        volume: 1_000,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    }));
}

class DelayedProvider implements IProvider {
    private readonly pendingData: Promise<Kline[]>;
    private releaseData: (data: Kline[]) => void = () => undefined;

    constructor() {
        this.pendingData = new Promise((resolve) => {
            this.releaseData = resolve;
        });
    }

    getMarketData(): Promise<Kline[]> {
        return this.pendingData;
    }

    getSymbolInfo(tickerId: string): Promise<ISymbolInfo> {
        return Provider.Mock.getSymbolInfo(tickerId);
    }

    configure(): void {}

    release(data: Kline[]): void {
        this.releaseData(data);
    }
}

describe('delayed provider readiness', () => {
    it('runs after the delayed provider supplies its initial data', async () => {
        const provider = new DelayedProvider();
        const pineTS = new PineTS(provider, 'BTCUSDT', '1');
        const run = pineTS.run('//@version=5\nindicator("x")\nplot(close, "c")');

        provider.release(bars(3));
        const context = await run;

        expect(context.result).toHaveLength(3);
        expect(context.idx).toBe(2);
        expect(context.plots['c'].data.map((point: { value: number }) => point.value)).toEqual([101, 102, 103]);
    });

    it('streams exactly one loaded page when pageSize is omitted before readiness', async () => {
        const provider = new DelayedProvider();
        const pineTS = new PineTS(provider, 'BTCUSDT', '1');
        const pages: Context[] = [];

        const completed = new Promise<void>((resolve, reject) => {
            const stream = pineTS.stream('//@version=5\nindicator("x")\nplot(close, "c")', { live: false });
            stream.on('error', (error: unknown) => {
                stream.stop();
                reject(error);
            });
            stream.on('data', (context: Context) => {
                pages.push(context);
                if (pages.length === 3) {
                    stream.stop();
                    reject(new Error('stream repeated three empty pages without making progress'));
                    return;
                }
                if (Array.isArray(context.result) && context.result.length === 3) {
                    queueMicrotask(() => {
                        stream.stop();
                        resolve();
                    });
                }
            });
        });

        provider.release(bars(3));
        await completed;

        expect(pages).toHaveLength(1);
        expect(pages[0].result).toHaveLength(3);
        expect(pages[0].idx).toBe(2);
    }, 2_000);

    it('completes an empty stream without data or error events', async () => {
        const pineTS = new PineTS([]);
        const dataEvents: Context[] = [];
        const errors: unknown[] = [];
        const stream = pineTS.stream('//@version=5\nindicator("x")\nplot(close, "c")', { live: false });
        stream.on('data', (context: Context) => dataEvents.push(context));
        stream.on('error', (error: unknown) => errors.push(error));

        await new Promise<void>((resolve) => setImmediate(resolve));
        stream.stop();

        expect(dataEvents).toHaveLength(0);
        expect(errors).toHaveLength(0);
    }, 2_000);

    it.each([0, -1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('emits one stable error for invalid pageSize %s', async (pageSize) => {
        const provider = new DelayedProvider();
        const pineTS = new PineTS(provider, 'BTCUSDT', '1');
        const errors: unknown[] = [];

        const completed = new Promise<void>((resolve, reject) => {
            const stream = pineTS.stream('//@version=5\nindicator("x")\nplot(close, "c")', { pageSize, live: false });
            stream.on('data', () => {
                stream.stop();
                reject(new Error(`invalid pageSize ${pageSize} emitted data instead of an error`));
            });
            stream.on('error', (error: unknown) => {
                errors.push(error);
                queueMicrotask(() => {
                    stream.stop();
                    resolve();
                });
            });
        });

        provider.release(bars(3));
        await completed;

        expect(errors).toHaveLength(1);
        const error = errors[0];
        expect(error).toBeInstanceOf(RangeError);
        if (!(error instanceof Error)) throw new Error('stream error was not an Error instance');
        expect(error.message).toBe('stream(): pageSize must be a positive integer');
    }, 2_000);
});

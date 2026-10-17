import { Provider } from '@pinets/index';
import PineTS from 'PineTS.class';
import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/Context.class';
import type { IProvider } from '../../src/marketData/IProvider';
import type { Kline } from '../../src/marketData/types';

const MINUTE = 60_000;

function candle(index: number, close: number): Kline {
    return {
        openTime: index * MINUTE,
        closeTime: (index + 1) * MINUTE - 1,
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
    };
}

describe('Stream API', () => {
    it('preserves explicit positive pageSize pagination', async () => {
        const data: Kline[] = Array.from({ length: 5 }, (_, index) => ({
            openTime: index * 60_000,
            closeTime: (index + 1) * 60_000 - 1,
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
        const pageSizes: number[] = [];

        await new Promise<void>((resolve, reject) => {
            const stream = new PineTS(data).stream('//@version=5\nindicator("x")\nplot(close, "c")', {
                pageSize: 2,
                live: false,
            });
            stream.on('error', reject);
            stream.on('data', (context: Context) => {
                pageSizes.push(context.result.length);
                if (pageSizes.reduce((total, size) => total + size, 0) === data.length) {
                    queueMicrotask(() => {
                        stream.stop();
                        resolve();
                    });
                }
            });
        });

        expect(pageSizes).toEqual([2, 2, 1]);
    }, 2_000);

    it.each([
        { label: 'replacing the last bar', updateIndex: 2, updateClose: 3.5, expected: [3], expectedIsNew: [0] },
        { label: 'appending a live bar', updateIndex: 3, updateClose: 4, expected: [4], expectedIsNew: [1] },
    ])('rolls back a sole final page before $label', async ({ updateIndex, updateClose, expected, expectedIsNew }) => {
        let updateCount = 0;
        const provider: IProvider = {
            async getMarketData(_tickerId, _timeframe, _limit, startDate) {
                if (startDate === undefined) return [candle(0, 1), candle(1, 2), candle(2, 3)];
                return updateCount++ === 0 ? [candle(updateIndex, updateClose)] : [];
            },
            getSymbolInfo: (tickerId) => Provider.Mock.getSymbolInfo(tickerId),
            configure: () => undefined,
        };
        const pages: number[][] = [];
        const isNewPages: number[][] = [];

        await new Promise<void>((resolve, reject) => {
            const stream = new PineTS(provider, 'BTCUSDC', '1').stream(`//@version=6
indicator("paged live rollback")
var int executions = 0
executions += 1
plot(executions, "executions")
plot(barstate.isnew ? 1 : 0, "isnew")`, { pageSize: 2, live: true, interval: 0 });
            const timeout = setTimeout(() => {
                stream.stop();
                reject(new Error('paged live rollback timeout'));
            }, 2_000);
            stream.on('error', (error) => {
                clearTimeout(timeout);
                stream.stop();
                reject(error);
            });
            stream.on('data', (context) => {
                pages.push(context.plots.executions.data.map((point: { readonly value: number }) => point.value));
                isNewPages.push(context.plots.isnew.data.map((point: { readonly value: number }) => point.value));
                if (pages.length === 3) {
                    clearTimeout(timeout);
                    stream.stop();
                    resolve();
                }
            });
        });

        expect(pages).toEqual([[1, 2], [3], expected]);
        expect(isNewPages).toEqual([[1, 1], [1], expectedIsNew]);
    }, 3_000);

    it('should stream data via event interface', async () => {
        let updateCount = 0;
        const provider: IProvider = {
            async getMarketData(_tickerId, _timeframe, _limit, startDate) {
                if (startDate === undefined) return [candle(0, 1), candle(1, 2)];
                if (updateCount++ === 0) return [candle(1, 3)];
                return [candle(2, 4)];
            },
            getSymbolInfo: (tickerId) => Provider.Mock.getSymbolInfo(tickerId),
            configure: () => undefined,
        };
        const pages: number[][] = [];

        await new Promise<void>((resolve, reject) => {
            const stream = new PineTS(provider, 'BTCUSDC', '1').stream(
                '//@version=6\nindicator("event stream")\nplot(close, "c")',
                { pageSize: 2, live: true, interval: 0 },
            );
            const timeout = setTimeout(() => {
                stream.stop();
                reject(new Error('event stream timeout'));
            }, 2_000);
            stream.on('error', (error) => {
                clearTimeout(timeout);
                stream.stop();
                reject(error);
            });
            stream.on('data', (context) => {
                pages.push(context.plots.c.data.map((point: { readonly value: number }) => point.value));
                if (pages.length === 3) {
                    clearTimeout(timeout);
                    stream.stop();
                    resolve();
                }
            });
        });

        expect(pages).toEqual([[1, 2], [3], [4]]);
    }, 3_000);

    it('should respect live=false option', async () => {
        return new Promise<void>((resolve, reject) => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', 100);

            const indicator = (context: any) => {
                const { close } = context.data;
                return { close };
            };

            const evt = pineTS.stream(indicator, { pageSize: 50, live: false });

            let eventCount = 0;
            let lastEventTime = Date.now();

            evt.on('data', (ctx: any) => {
                eventCount++;
                lastEventTime = Date.now();
            });

            // Check that stream stops emitting
            setTimeout(() => {
                const timeSinceLastEvent = Date.now() - lastEventTime;
                try {
                    expect(eventCount).toBeGreaterThan(0); // Should have processed history
                    // If it was live, it would likely have emitted more or kept connection open
                    // But effectively we are checking if it *stopped*.
                    // Since we can't inspect internal state, we rely on "silence".
                    // And checking that eventCount matches expected pages roughly?
                    // 100 bars / 50 pageSize = 2 pages + maybe 1 for current bar?
                    expect(eventCount).toBeLessThan(10); // Should be small number of pages
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }, 2000);
        });
    });

    it('should produce consistent results between streaming and non-streaming execution', async () => {
        const periods = 1500;
        // Use consistent provider and symbol
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', '60', periods);
        
        // Wait for data to be ready (ensure we have data for run() later)
        // Note: stream() usually handles init, but run() might need it if called separately.
        // However, pineTS instance handles it.
        
        const sourceCode = (context: any) => {
            const { close } = context.data;
            const { ta } = context.pine;
            const sma = ta.sma(close, 9);
            return { sma };
        };

        const pageSize = 600;
        const accumulatedSma: number[] = [];
        const pageSizes: number[] = [];

        return new Promise<void>((resolve, reject) => {
            const evt = pineTS.stream(sourceCode, { pageSize, live: false, interval: 0 });

            evt.on('data', (pageContext: any) => {
                const currentPageSize = pageContext.result.sma.length;
                pageSizes.push(currentPageSize);
                accumulatedSma.push(...pageContext.result.sma);
            });

            evt.on('error', (error: any) => {
                reject(error);
            });

            setTimeout(async () => {
                try {
                    // Run non-paginated version for comparison
                    // We reuse the same pineTS instance which already has data loaded ideally,
                    // or it will refetch/use cached.
                    // Important: ensure run() uses same periods
                    const completeContext = (await pineTS.run(sourceCode, periods)) as any;
                    const completeSma = completeContext.result.sma;

                    // Verify page structure
                    const expectedPages = Math.ceil(periods / pageSize);
                    // Depending on how pagination implementation handles remainders/updates
                    // The example expects strict equality in accumulated length
                    
                    expect(pageSizes.length).toBeGreaterThanOrEqual(expectedPages);
                    expect(accumulatedSma.length).toBe(completeSma.length);
                    
                    // Verify values match
                    
                    // Checking first, middle, last to save time on massive array comparison in test logs
                    if (accumulatedSma.length > 0) {
                        expect(accumulatedSma[0]).toBe(completeSma[0]);
                        expect(accumulatedSma[accumulatedSma.length - 1]).toBe(completeSma[completeSma.length - 1]);
                        
                        const mid = Math.floor(accumulatedSma.length / 2);
                        expect(accumulatedSma[mid]).toBe(completeSma[mid]);
                    }

                    // Deep equality check
                    expect(accumulatedSma).toEqual(completeSma);

                    resolve();
                } catch (error) {
                    reject(error);
                }
            }, 3000);
        });
    });
});

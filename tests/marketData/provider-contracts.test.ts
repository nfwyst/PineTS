// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlpacaProvider } from '@pinets/marketData/Alpaca/AlpacaProvider.class';
import { BinanceProvider } from '@pinets/marketData/Binance/BinanceProvider.class';
import { FMPProvider } from '@pinets/marketData/FMP/FMPProvider.class';

const REQUEST_TIMEOUT_MS = 10_000;

const providerCases = [
    ['FMP', () => new FMPProvider({ apiKey: 'test-key', baseUrl: 'https://fmp.test' })],
    ['Alpaca', () => new AlpacaProvider({
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        dataUrl: 'https://alpaca-data.test',
        tradingUrl: 'https://alpaca-trading.test',
    })],
    ['Binance', () => new BinanceProvider()],
] as const;

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('market-data provider failure contracts', () => {
    it.each(providerCases)('%s rejects when its transport fails', async (_providerName, createProvider) => {
        const transportError = new TypeError('network unavailable');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(transportError)));

        const request = createProvider().getMarketData('AAPL', 'D', 1);

        await expect(request).rejects.toBe(transportError);
    });

    it('FMP rejects a restricted intraday endpoint response', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('Restricted Endpoint', { status: 403 })));
        const provider = new FMPProvider({ apiKey: 'test-key', baseUrl: 'https://fmp.test' });

        const request = provider.getMarketData('AAPL', '1', 1);

        await expect(request).rejects.toThrow(/requires a paid plan/);
    });

    it('aborts a pending FMP market-data request at the shared timeout', async () => {
        vi.useFakeTimers();
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((
            _input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ) => new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
        })));

        const provider = new FMPProvider({ apiKey: 'test-key', baseUrl: 'https://fmp.test' });
        const request = provider.getMarketData('AAPL', 'D', 1);
        const capturedSignal = requestSignal;

        expect(capturedSignal).toBeDefined();
        if (capturedSignal === undefined) return;

        const rejection = expect(request).rejects.toMatchObject({ name: 'MarketDataRequestTimeoutError' });
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

        expect(capturedSignal.aborted).toBe(true);
        await rejection;
    });

    it('aborts an FMP response whose headers arrive but body stalls', async () => {
        vi.useFakeTimers();
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((
            _input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ) => {
            requestSignal = init?.signal ?? undefined;
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    requestSignal?.addEventListener(
                        'abort',
                        () => controller.error(requestSignal?.reason),
                        { once: true },
                    );
                },
            });
            return Promise.resolve(new Response(body));
        }));
        const provider = new FMPProvider({ apiKey: 'test-key', baseUrl: 'https://fmp.test' });

        const request = provider.getMarketData('AAPL', 'D', 1);
        const outcome = request.then(
            () => ({ kind: 'resolved' as const }),
            (error: unknown) => ({ kind: 'rejected' as const, error }),
        );
        const capturedSignal = requestSignal;
        expect(capturedSignal).toBeDefined();
        if (capturedSignal === undefined) return;

        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

        expect(capturedSignal.aborted).toBe(true);
        await expect(outcome).resolves.toMatchObject({
            kind: 'rejected',
            error: { name: 'MarketDataRequestTimeoutError' },
        });
    });

    it('FMP propagates a profile transport failure instead of guessing the exchange timezone', async () => {
        const profileError = new TypeError('profile unavailable');
        vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith('/stable/historical-chart/1min')) {
                return Response.json([{
                    date: '2025-07-01 08:00:00',
                    open: 1,
                    high: 1,
                    low: 1,
                    close: 1,
                    volume: 1,
                }]);
            }
            if (url.pathname.endsWith('/stable/profile')) throw profileError;
            return new Response(null, { status: 404 });
        }));
        const provider = new FMPProvider({ apiKey: 'test-key', baseUrl: 'https://fmp.test' });

        const request = provider.getMarketData('VOD', '1', 1);

        await expect(request).rejects.toBe(profileError);
    });
});

describe('FMP intraday timestamps', () => {
    it('converts a NASDAQ winter session timestamp from New York time to UTC', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith('/stable/historical-chart/1min')) {
                return Response.json([{
                    date: '2025-01-10 09:30:00',
                    open: 100,
                    high: 101,
                    low: 99,
                    close: 100.5,
                    volume: 1_000,
                }]);
            }
            if (url.pathname.endsWith('/stable/profile')) {
                return Response.json([{ exchange: 'NASDAQ' }]);
            }
            return new Response(null, { status: 404 });
        }));
        const provider = new FMPProvider({ apiKey: 'test-key', baseUrl: 'https://fmp.test' });

        const [bar] = await provider.getMarketData('AAPL', '1', 1);

        expect(bar.openTime).toBe(Date.UTC(2025, 0, 10, 14, 30));
    });
});

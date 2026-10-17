// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceProvider } from '@pinets/marketData/Binance/BinanceProvider.class';

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28);

let requests: URL[] = [];

function createKlines(url: URL): (number | string)[][] {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);
    const endTime = Math.min(Number(url.searchParams.get('endTime') ?? NOW), NOW);
    const lastOpen = Math.floor(endTime / HOUR_MS) * HOUR_MS;
    const startTime = url.searchParams.get('startTime');
    const firstOpen = startTime === null ? lastOpen - (limit - 1) * HOUR_MS : Math.ceil(Number(startTime) / HOUR_MS) * HOUR_MS;
    const rows: (number | string)[][] = [];

    for (let openTime = firstOpen; openTime <= lastOpen && rows.length < limit; openTime += HOUR_MS) {
        rows.push([openTime, '1', '2', '0', '1', '1', openTime + HOUR_MS - 1, '1', 1, '1', '1', '0']);
    }

    return rows;
}

function toUrl(input: Parameters<typeof fetch>[0]): URL {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return new URL(input.href);
    return new URL(input.url);
}

function klineRequests(): URL[] {
    return requests.filter((url) => url.pathname.endsWith('/klines'));
}

function expectUsdMPerpetualUrl(url: URL): void {
    expect(url.origin).toBe('https://fapi.binance.com');
    expect(url.pathname).toBe('/fapi/v1/klines');
    expect(url.searchParams.get('symbol')).toBe('ETHUSDT');
    expect(url.search).not.toContain('.P');
}

describe('BinanceProvider perpetual pagination routing', () => {
    beforeEach(() => {
        requests = [];
        vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
            const url = toUrl(input);
            requests.push(url);

            if (url.pathname.endsWith('/ping')) return Response.json({});
            if (url.pathname.endsWith('/klines')) return Response.json(createKlines(url));
            if (url.pathname.endsWith('/exchangeInfo')) {
                return Response.json({ symbols: [{ symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', filters: [] }] });
            }
            return new Response(null, { status: 404 });
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes a one-candle USDⓈ-M perpetual request to https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT', async () => {
        const data = await new BinanceProvider().getMarketData('ETHUSDT.P', '60', 1);

        expect(data).toHaveLength(1);
        expect(klineRequests()).toHaveLength(1);
        expectUsdMPerpetualUrl(klineRequests()[0]);
    });

    it.each([501, 1001, 2500])('routes every chunk of a %i-candle USDⓈ-M perpetual range to fapi /fapi/v1/klines?symbol=ETHUSDT', async (count) => {
        const startTime = Date.UTC(2026, 5, 1);
        const endTime = startTime + count * HOUR_MS - 1;
        const data = await new BinanceProvider().getMarketData('ETHUSDT.P', '60', undefined, startTime, endTime);

        expect(data).toHaveLength(count);
        expect(klineRequests()).toHaveLength(Math.ceil(count / 1000));
        klineRequests().forEach(expectUsdMPerpetualUrl);
    });

    it('keeps the public perpetual ticker in symbol info while using the shared futures route', async () => {
        const symbolInfo = await new BinanceProvider().getSymbolInfo('ETHUSDT.P');
        const exchangeInfoRequest = requests.find((url) => url.pathname.endsWith('/exchangeInfo'));

        expect(exchangeInfoRequest?.origin).toBe('https://fapi.binance.com');
        expect(exchangeInfoRequest?.pathname).toBe('/fapi/v1/exchangeInfo');
        expect(symbolInfo?.ticker).toBe('ETHUSDT.P');
        expect(symbolInfo?.tickerid).toBe('BINANCE:ETHUSDT.P');
    });

    it('keeps spot symbols on the spot /api/v3/klines route', async () => {
        await new BinanceProvider().getMarketData('BTCUSDT', '60', 1);

        const [request] = klineRequests();
        expect(request.origin).toBe('https://api.binance.com');
        expect(request.pathname).toBe('/api/v3/klines');
        expect(request.searchParams.get('symbol')).toBe('BTCUSDT');
    });

    it('keeps unsupported non-USDT .P symbols on the existing spot /api/v3/klines route', async () => {
        await new BinanceProvider().getMarketData('BTCUSD.P', '60', 1);

        const [request] = klineRequests();
        expect(request.origin).toBe('https://api.binance.com');
        expect(request.pathname).toBe('/api/v3/klines');
        expect(request.searchParams.get('symbol')).toBe('BTCUSD.P');
    });
});

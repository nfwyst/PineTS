// SPDX-License-Identifier: AGPL-3.0-only

export const MARKET_DATA_REQUEST_TIMEOUT_MS = 10_000;

export class MarketDataRequestTimeoutError extends Error {
    readonly name = 'MarketDataRequestTimeoutError';

    constructor(readonly timeoutMs: number, options?: ErrorOptions) {
        super(`Market data request timed out after ${timeoutMs}ms`, options);
    }
}

export async function fetchWithTimeout(
    input: Parameters<typeof fetch>[0],
    init: Omit<RequestInit, 'signal'> = {},
    timeoutMs = MARKET_DATA_REQUEST_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout>;
    const timeoutResult = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new MarketDataRequestTimeoutError(timeoutMs));
        }, timeoutMs);
    });
    const request = (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal });
        if (response.body !== null) await response.clone().arrayBuffer();
        return response;
    })();

    try {
        return await Promise.race([request, timeoutResult]);
    } catch (error) {
        if (timedOut && !(error instanceof MarketDataRequestTimeoutError)) {
            throw new MarketDataRequestTimeoutError(timeoutMs, { cause: error });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKlines, normalizeNumericGraph, normalizePlotString } from '../utils';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('test numeric normalization', () => {
    it('normalizes numeric leaves in arrays and plain objects', () => {
        // Given
        const value = { scalar: 1.23456789, nested: [9.87654321] };

        // When
        const normalized = normalizeNumericGraph(value, 4);

        // Then
        expect(normalized).toEqual({ scalar: 1.2346, nested: [9.8765] });
    });

    it('preserves non-plain objects instead of erasing their type and contents', () => {
        // Given
        const map = new Map([['value', 1.23456789]]);
        const set = new Set([1.23456789]);
        const date = new Date(0);

        // When
        const normalized = [map, set, date].map((value) => normalizeNumericGraph(value, 4));

        // Then
        expect(normalized).toEqual([map, set, date]);
        expect(normalized[0]).toBe(map);
        expect(normalized[1]).toBe(set);
        expect(normalized[2]).toBe(date);
    });

    it('keeps nonzero values below the fixed-decimal resolution distinct from zero', () => {
        // Given
        const tiny = 1e-12;

        // When
        const normalizedGraph = normalizeNumericGraph(tiny);
        const normalizedPlot = normalizePlotString(`value=${tiny}`);

        // Then
        expect(normalizedGraph).toBe(tiny);
        expect(normalizedPlot).not.toBe(normalizePlotString('value=0'));
    });
});

describe('test market-data fixture', () => {
    it('loads the shared 500-bar dataset without network access', async () => {
        const networkFetch = vi.fn(() => {
            throw new Error('unexpected network access');
        });
        vi.stubGlobal('fetch', networkFetch);

        const bars = await getKlines('BTCUSDT', '1h', 500, 0, 1_736_071_199_999);

        expect(networkFetch).not.toHaveBeenCalled();
        expect(bars).toHaveLength(500);
    });
});

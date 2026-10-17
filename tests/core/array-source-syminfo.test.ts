// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const CANDLES = Array.from({ length: 3 }, (_, index) => ({
    openTime: START + index * DAY,
    closeTime: START + (index + 1) * DAY - 1,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000,
}));

describe('array-source syminfo defaults', () => {
    it('derives deterministic identity and market defaults from the ticker', async () => {
        const context = await new PineTS(CANDLES, 'NASDAQ:AAPL', 'D').run(`//@version=6
indicator("array syminfo")`);

        expect(context.pine.syminfo).toMatchObject({
            ticker: 'AAPL',
            tickerid: 'NASDAQ:AAPL',
            prefix: 'NASDAQ',
            root: 'AAPL',
            description: 'AAPL',
            timezone: 'UTC',
            session: '24x7',
            minmove: 1,
            mintick: 0.01,
            pointvalue: 1,
            pricescale: 100,
        });
        expect(Number.isNaN(context.pine.syminfo.employees)).toBe(true);
        expect(Number.isNaN(context.pine.syminfo.expiration_date)).toBe(true);
    });

    it('uses empty symbol identity when no ticker is supplied', async () => {
        const context = await new PineTS(CANDLES).run(`//@version=6
indicator("array syminfo")`);

        expect(context.pine.syminfo).toMatchObject({
            ticker: '',
            tickerid: '',
            prefix: '',
            root: '',
            description: '',
            timezone: 'UTC',
            session: '24x7',
        });
    });
});

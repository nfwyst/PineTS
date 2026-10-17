// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { PineTS } from '../../../src/PineTS.class';
import { describe, expect, it } from 'vitest';

const DAY_MS = 86_400_000;
const START_TIME = Date.UTC(2024, 0, 1);
const BAR_COUNT = 4;

const candles = Array.from({ length: BAR_COUNT }, (_, index) => ({
    openTime: START_TIME + index * DAY_MS,
    closeTime: START_TIME + (index + 1) * DAY_MS - 1,
    open: 95,
    high: 110,
    low: 90,
    close: 95 + index,
    volume: 1,
}));

async function runGradientFill(fillCall: string) {
    const pineTS = new PineTS(candles);
    const { plots } = await pineTS.run(`//@version=6
indicator("gradient arguments")
upper = plot(high, "Upper")
lower = plot(low, "Lower")
${fillCall}
`);
    return plots['Gradient'];
}

describe('gradient fill arguments', () => {
    it('preserves mixed positional and named fields like positional and named forms', async () => {
        // Given: equivalent gradient calls expressed in the three supported argument forms.
        const positionalCall = 'fill(upper, lower, 100, 90, color.green, color.red, "Gradient", true, 7, false, display.none)';
        const mixedCall =
            'fill(upper, lower, 100, 90, color.green, color.red, title="Gradient", editable=true, show_last=7, fillgaps=false, display=display.none)';
        const namedCall =
            'fill(upper, lower, top_value=100, bottom_value=90, top_color=color.green, bottom_color=color.red, title="Gradient", editable=true, show_last=7, fillgaps=false, display=display.none)';

        // When: each call executes through the public Pine source runtime.
        const [positional, mixed, named] = await Promise.all([
            runGradientFill(positionalCall),
            runGradientFill(mixedCall),
            runGradientFill(namedCall),
        ]);

        // Then: named fields and per-bar gradient values are indistinguishable.
        expect(mixed).toMatchObject({
            title: 'Gradient',
            options: {
                editable: true,
                show_last: 7,
                fillgaps: false,
                display: 'none',
                gradient: true,
            },
        });
        expect(mixed.data).toHaveLength(BAR_COUNT);
        expect(mixed.data[0].options).toEqual({
            top_value: 100,
            bottom_value: 90,
            top_color: '#4CAF50',
            bottom_color: '#F23645',
        });
        expect(mixed).toEqual(positional);
        expect(named).toEqual(positional);
    });
});

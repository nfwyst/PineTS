// SPDX-License-Identifier: AGPL-3.0-only

const COMPARISON_SCALE = 10 ** 9;

/** Pine rounds float operands to nine fractional digits before comparing them. */
export function roundForComparison(value: number): number {
    if (!(Math.abs(value) * COMPARISON_SCALE < 2 ** 53)) return value;
    return Math.round(value * COMPARISON_SCALE) / COMPARISON_SCALE;
}

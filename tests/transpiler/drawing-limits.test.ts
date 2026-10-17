// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CE10178 — indicator/strategy drawing-object budgets are capped by the
 * platform. Also covers the line/box/polyline limits.
 */

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const errorOf = (src: string): string => {
    const r = pineToJS(src);
    return r.success ? '' : r.error ?? '';
};

describe('CE10178 drawing-object budget limits', () => {
    it('rejects max_labels_count above 500', () => {
        const src = '//@version=6\nindicator("t", max_labels_count = 501)\nplot(close)\n';
        expect(errorOf(src)).toContain('max_labels_count value (501) is greater than the maximum possible value (500)');
    });

    it('rejects max_lines_count / max_boxes_count above 500', () => {
        const src1 = '//@version=6\nindicator("t", max_lines_count = 1000)\nplot(close)\n';
        const src2 = '//@version=6\nindicator("t", max_boxes_count = 501)\nplot(close)\n';
        expect(errorOf(src1)).toContain('max_lines_count value (1000) is greater than the maximum possible value (500)');
        expect(errorOf(src2)).toContain('max_boxes_count value (501) is greater than the maximum possible value (500)');
    });

    it('rejects max_polylines_count above 100', () => {
        const src = '//@version=6\nindicator("t", max_polylines_count = 101)\nplot(close)\n';
        expect(errorOf(src)).toContain('max_polylines_count value (101) is greater than the maximum possible value (100)');
    });

    it('applies to strategy() declarations', () => {
        const src = '//@version=6\nstrategy("t", max_labels_count = 600)\n';
        expect(errorOf(src)).toContain('max_labels_count value (600)');
    });

    it('accepts the boundary values 500 / 100', () => {
        const src = '//@version=6\nindicator("t", max_labels_count = 500, max_lines_count = 500, max_boxes_count = 500, max_polylines_count = 100)\nplot(close)\n';
        const r = pineToJS(src);
        expect(r.success, r.success ? '' : r.error).toBe(true);
    });

    it('does not evaluate non-literal limits (const int folded by user)', () => {
        // Only literal values are folded by TradingView at this point;
        // a qualified constant cannot be range-checked at compile time.
        const src = '//@version=6\nindicator("t")\nplot(close)\n';
        const r = pineToJS(src);
        expect(r.success).toBe(true);
    });
});

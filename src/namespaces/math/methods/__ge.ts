// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';
import { roundForComparison } from '../comparison';

/**
 * Pine Script na-aware "greater than or equal" (`>=`).
 *
 * - If either operand is `na`, the result is `na` (matching TradingView).
 * - Float operands are rounded to nine fractional digits before comparison.
 */
export function __ge(context: any) {
    return (a: any, b: any) => {
        const valA = Series.from(a).get(0);
        const valB = Series.from(b).get(0);

        if (typeof valA === 'number' && typeof valB === 'number') {
            if (isNaN(valA) || isNaN(valB)) return NaN;
            return roundForComparison(valA) >= roundForComparison(valB);
        }

        return valA >= valB;
    };
}

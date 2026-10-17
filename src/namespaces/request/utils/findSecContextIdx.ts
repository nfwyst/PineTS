// SPDX-License-Identifier: AGPL-3.0-only

function lastLessThanOrEqual(values: readonly number[], target: number): number {
    let low = 0;
    let high = values.length - 1;
    let result = -1;

    while (low <= high) {
        const middle = low + Math.floor((high - low) / 2);
        if (values[middle] <= target) {
            result = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return result;
}

export function findSecContextIdx(
    myOpenTime: number,
    myCloseTime: number,
    openTime: readonly number[],
    closeTime: readonly number[],
    lookahead: boolean = false,
    isRealtime: boolean = false
): number {
    if (lookahead || isRealtime) return lastLessThanOrEqual(openTime, myOpenTime);
    return lastLessThanOrEqual(closeTime, myCloseTime);
}

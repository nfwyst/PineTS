// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from '../../../Context.class';

const MAX_HISTORY_VALUES = 5_000;

type ExtremaState = {
    lastIdx: number;
    readonly committedValues: number[];
    historyStart: number;
    historyCount: number;
    currentValue: number;
    currentExecutionTick: number;
    hasCurrentValue: boolean;
};

function appendCommitted(state: ExtremaState, value: number): void {
    if (state.historyCount < MAX_HISTORY_VALUES) {
        const index = (state.historyStart + state.historyCount) % MAX_HISTORY_VALUES;
        state.committedValues[index] = value;
        state.historyCount++;
        return;
    }

    state.committedValues[state.historyStart] = value;
    state.historyStart = (state.historyStart + 1) % MAX_HISTORY_VALUES;
}

/** Last `length` values from executions that survive realtime rollback, newest first. */
export function extremaWindow(context: Context, stateKey: string, currentValue: number, length: number): number[] {
    let state: ExtremaState | undefined = context.taState[stateKey];
    if (state === undefined) {
        state = {
            lastIdx: -1,
            committedValues: [],
            historyStart: 0,
            historyCount: 0,
            currentValue: NaN,
            currentExecutionTick: -1,
            hasCurrentValue: false,
        };
        context.taState[stateKey] = state;
    }

    if (context.idx > state.lastIdx) {
        const finalExecutionTick = context._barExecutionTicks[state.lastIdx];
        if (state.hasCurrentValue && state.currentExecutionTick === finalExecutionTick) {
            appendCommitted(state, state.currentValue);
        }
        state.lastIdx = context.idx;
    }

    state.currentValue = currentValue;
    state.currentExecutionTick = context._execTick;
    state.hasCurrentValue = true;

    const windowLength = Math.trunc(length);
    if (!(windowLength > 0)) return [];

    const window = [currentValue];
    const committedCount = Math.min(state.historyCount, windowLength - 1);
    for (let offset = 1; offset <= committedCount; offset++) {
        const index = (state.historyStart + state.historyCount - offset) % MAX_HISTORY_VALUES;
        window.push(state.committedValues[index]);
    }
    return window;
}

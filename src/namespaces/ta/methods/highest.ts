// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';
import { extremaWindow } from '../utils/extremaWindow';

export function highest(context: any) {
    return (source: any, _length: any, _callId?: string) => {
        // if the _length is of type string, this is probably the _callId
        // ==> this is a weak approach to determine syntaxes : ta.highest(length) vs ta.highest(source, length)
        if (typeof _length === 'string' && _callId === undefined) {
            _callId = _length
            _length = source
            source = context.data.high;
        }

        const length = Series.from(_length).get(0);

        const stateKey = _callId || `highest_${length}`;
        const currentValue = Series.from(source).get(0);
        const window = extremaWindow(context, stateKey, currentValue, length);

        // TradingView resets the window at na: only the bars since the most recent na
        // take part (the window is newest → oldest, so that is the prefix before the
        // first na), and an na on the current bar yields na
        // (tests/namespaces/ta/na-window-semantics.test.ts).
        const firstNa = window.findIndex((v) => v === undefined || isNaN(v));
        const validValues = firstNa === -1 ? window : window.slice(0, firstNa);
        if (validValues.length === 0) {
            return NaN;
        }

        const max = Math.max(...validValues);
        return context.precision(max);
    };
}

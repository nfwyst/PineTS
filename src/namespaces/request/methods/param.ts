// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';
import { clonePineGraph } from '../../../core/clonePineGraph';

export function param(context: any) {
    return (source: any, index: any, name?: string) => {
        if (!context.params[name]) context.params[name] = [];

        let val;
        let tupleArity: number | undefined;
        if (source instanceof Series) {
            // Source is a Series - extract the value at index
            val = source.get(index || 0);
        } else if (Array.isArray(source)) {
            // Check if this is a tuple expression vs a time-series array
            //
            // For request.security/security_lower_tf, tuples are always passed as arrays of expressions.
            // A tuple can contain Series objects, scalars, or a mix (e.g., [open, close, wVolSrc()]).
            //
            // Detection: If any element is a Series, it's a tuple (time-series arrays don't contain
            // Series at the top level). If all elements are scalars (no nested arrays), it's also
            // a tuple of literal values. Only arrays with nested arrays are time-series data.

            const hasAnySeries = source.some((elem) => elem instanceof Series);
            const hasOnlyScalars = source.every((elem) => !(elem instanceof Series) && !Array.isArray(elem));
            const isTuple = (hasAnySeries || hasOnlyScalars) && source.length >= 1;

            if (isTuple) {
                // Series and dual-use helpers such as time/time_close both resolve here.
                val = source.map((elem: unknown) => {
                    if (elem instanceof Series) return elem.get(0);
                    if (elem !== null && typeof elem === 'object' && '__value' in elem) {
                        return Series.from(elem).get(0);
                    }
                    return elem;
                });
                tupleArity = source.length;
            } else {
                // Time-series array - extract value at index
                val = Series.from(source).get(index || 0);
                if (Array.isArray(val)) tupleArity = val.length;
            }
        } else {
            val = source;
        }

        const storedVal = clonePineGraph(val);
        if (context.params[name].length === 0) {
            context.params[name].push(storedVal);
        } else {
            context.params[name][context.params[name].length - 1] = storedVal;
        }

        // Preserve the ORIGINAL source (with Series identity intact, before
        // value extraction) so request.security_lower_tf can detect pure-
        // builtin expressions (`close`, `[open, high, low, close, volume]`,
        // …) and bypass running the user script in the secondary context.
        // Stored by param-name on a side channel — the existing 2-tuple
        // [val, name] return shape is preserved, so no other consumers of
        // request.param care.
        if (!context._requestParamSources) context._requestParamSources = {};
        context._requestParamSources[name] = source;

        if (!context._requestParamShapes) context._requestParamShapes = {};
        context._requestParamShapes[name] = tupleArity === undefined
            ? { kind: 'scalar' }
            : { kind: 'tuple', arity: tupleArity };

        return [val, name];
    };
}

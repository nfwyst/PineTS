// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { PineArrayObject } from '../namespaces/array/PineArrayObject';
import { ChartPointObject } from '../namespaces/chart/ChartPointObject';
import { PineMapObject } from '../namespaces/map/PineMapObject';
import { PineMatrixObject } from '../namespaces/matrix/PineMatrixObject';
import { PineTypeObject } from '../namespaces/PineTypeObject';

/**
 * Clone the mutable reference types that Pine exposes to user code.
 * A caller-owned memo keeps aliases intact across every snapshot root.
 */
export function clonePineGraph(value: unknown, memo: WeakMap<object, unknown> = new WeakMap()): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (memo.has(value)) return memo.get(value);

    if (value instanceof ChartPointObject) {
        const clone = value.copy();
        memo.set(value, clone);
        return clone;
    }

    if (value instanceof PineArrayObject) {
        const clone = new PineArrayObject([], value.type, value.context);
        memo.set(value, clone);
        clone.array = value.array.map((entry: unknown) => clonePineGraph(entry, memo));
        return clone;
    }

    if (value instanceof PineMapObject) {
        const clone = new PineMapObject(value.context);
        memo.set(value, clone);
        clone.valueType = value.valueType;
        for (const [key, entry] of value.map) {
            clone.map.set(clonePineGraph(key, memo), clonePineGraph(entry, memo));
        }
        return clone;
    }

    if (value instanceof PineMatrixObject) {
        const clone = new PineMatrixObject(0, 0, NaN, value.context);
        memo.set(value, clone);
        clone.matrix = value.matrix.map((row) => row.map((entry) => clonePineGraph(entry, memo)));
        return clone;
    }

    if (value instanceof PineTypeObject) {
        const clone = new PineTypeObject({}, value.context, value._udt);
        memo.set(value, clone);
        memo.set(value.__def__, clone.__def__);
        for (const [key, entry] of Object.entries(value.__def__)) {
            Reflect.set(clone.__def__, key, clonePineGraph(entry, memo));
        }
        for (const [key, entry] of Object.entries(value._fieldValues())) {
            Reflect.set(clone, key, clonePineGraph(entry, memo));
        }
        return clone;
    }

    if (Array.isArray(value)) {
        const clone: unknown[] = [];
        memo.set(value, clone);
        for (const entry of value) clone.push(clonePineGraph(entry, memo));
        return clone;
    }

    return value;
}

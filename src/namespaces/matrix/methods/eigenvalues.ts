// SPDX-License-Identifier: AGPL-3.0-only

import { PineMatrixObject } from '../PineMatrixObject';
import { Context } from '../../../Context.class';
import { PineArrayObject } from '../../array/PineArrayObject';
import { inferValueType } from '@pinets/namespaces/array/utils';
import { calculateEigenvalues } from '../eigen';

export function eigenvalues(context: Context) {
    return (id: PineMatrixObject) => {
        const rows = id.matrix.length;
        const cols = rows > 0 ? id.matrix[0].length : 0;
        if (rows !== cols) {
            const anyType = inferValueType(id.matrix[0][0]);
            return new PineArrayObject([], anyType as any, context);
        }

        const vals = calculateEigenvalues(id.matrix);
        const valueType = inferValueType(vals[0]);
        return new PineArrayObject(vals, valueType as any, context);
    };
}

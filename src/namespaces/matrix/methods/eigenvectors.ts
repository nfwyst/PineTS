// SPDX-License-Identifier: AGPL-3.0-only

import { PineMatrixObject } from '../PineMatrixObject';
import { Context } from '../../../Context.class';
import { decomposeEigen } from '../eigen';

export function eigenvectors(context: Context) {
    return (id: PineMatrixObject) => {
        const rows = id.matrix.length;
        const cols = rows > 0 ? id.matrix[0].length : 0;
        if (rows !== cols) return new PineMatrixObject(0, 0, NaN, context);

        const newMatrix = new PineMatrixObject(rows, cols, 0, context);
        newMatrix.matrix = decomposeEigen(id.matrix).vectors;
        return newMatrix;
    };
}

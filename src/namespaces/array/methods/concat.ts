// SPDX-License-Identifier: AGPL-3.0-only

import { PineArrayObject } from '../PineArrayObject';
import { isArrayOfType } from '../utils';
import { assertCollectionGrowth } from '../../limits';

export function concat(context: any) {
    return (id: PineArrayObject, other: PineArrayObject): PineArrayObject => {
        assertCollectionGrowth(id.array.length, other.array.length, 'array.concat');
        id.array.push(...other.array);
        return id;
    };
}

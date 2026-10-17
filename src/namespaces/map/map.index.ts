// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:map-index

export { PineMapObject } from './PineMapObject';

import { PineMapObject } from './PineMapObject';
import { clear } from './methods/clear';
import { contains } from './methods/contains';
import { copy } from './methods/copy';
import { get } from './methods/get';
import { keys } from './methods/keys';
import { new_fn } from './methods/new';
import { param } from './methods/param';
import { put } from './methods/put';
import { put_all } from './methods/put_all';
import { remove } from './methods/remove';
import { size } from './methods/size';
import { values } from './methods/values';

export class PineMap {
    [key: string]: any;

    constructor(private context: any) {

        // Install methods
    this.clear = clear(context);
    this.contains = contains(context);
    this.copy = copy(context);
    this.get = get(context);
    this.keys = keys(context);
    this.new = new_fn(context);
    this.param = param(context);
    this.put = put(context);
    this.put_all = put_all(context);
    this.remove = remove(context);
    this.size = size(context);
    this.values = values(context);
    }
}

export default PineMap;

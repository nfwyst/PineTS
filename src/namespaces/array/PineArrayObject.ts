// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:array-index

import { tostringElements } from './format';

export enum PineArrayType {
    any = '',
    box = 'box',
    bool = 'bool',
    color = 'color',
    float = 'float',
    int = 'int',
    label = 'label',
    line = 'line',
    linefill = 'linefill',
    string = 'string',
    table = 'table',
}

export class PineArrayObject {
    constructor(public array: any, public type: PineArrayType, public context: any) {}

    // Element count for JavaScript callers (PineTS syntax: `line.all.length`); Pine uses size().
    get length(): number {
        return this.array.length;
    }

    toString(): string {
        return '[' + tostringElements(this).join(', ') + ']';
    }

    [Symbol.iterator]() {
        return this.array[Symbol.iterator]();
    }

    abs(...args: any[]) {
        return this.context.pine.array.abs(this, ...args);
    }

    avg(...args: any[]) {
        return this.context.pine.array.avg(this, ...args);
    }

    binary_search(...args: any[]) {
        return this.context.pine.array.binary_search(this, ...args);
    }

    binary_search_leftmost(...args: any[]) {
        return this.context.pine.array.binary_search_leftmost(this, ...args);
    }

    binary_search_rightmost(...args: any[]) {
        return this.context.pine.array.binary_search_rightmost(this, ...args);
    }

    clear(...args: any[]) {
        return this.context.pine.array.clear(this, ...args);
    }

    concat(...args: any[]) {
        return this.context.pine.array.concat(this, ...args);
    }

    copy(...args: any[]) {
        return this.context.pine.array.copy(this, ...args);
    }

    covariance(...args: any[]) {
        return this.context.pine.array.covariance(this, ...args);
    }

    every(...args: any[]) {
        return this.context.pine.array.every(this, ...args);
    }

    fill(...args: any[]) {
        return this.context.pine.array.fill(this, ...args);
    }

    first(...args: any[]) {
        return this.context.pine.array.first(this, ...args);
    }

    get(...args: any[]) {
        return this.context.pine.array.get(this, ...args);
    }

    includes(...args: any[]) {
        return this.context.pine.array.includes(this, ...args);
    }

    indexof(...args: any[]) {
        return this.context.pine.array.indexof(this, ...args);
    }

    insert(...args: any[]) {
        return this.context.pine.array.insert(this, ...args);
    }

    join(...args: any[]) {
        return this.context.pine.array.join(this, ...args);
    }

    last(...args: any[]) {
        return this.context.pine.array.last(this, ...args);
    }

    lastindexof(...args: any[]) {
        return this.context.pine.array.lastindexof(this, ...args);
    }

    max(...args: any[]) {
        return this.context.pine.array.max(this, ...args);
    }

    median(...args: any[]) {
        return this.context.pine.array.median(this, ...args);
    }

    min(...args: any[]) {
        return this.context.pine.array.min(this, ...args);
    }

    mode(...args: any[]) {
        return this.context.pine.array.mode(this, ...args);
    }

    percentile_linear_interpolation(...args: any[]) {
        return this.context.pine.array.percentile_linear_interpolation(this, ...args);
    }

    percentile_nearest_rank(...args: any[]) {
        return this.context.pine.array.percentile_nearest_rank(this, ...args);
    }

    percentrank(...args: any[]) {
        return this.context.pine.array.percentrank(this, ...args);
    }

    pop(...args: any[]) {
        return this.context.pine.array.pop(this, ...args);
    }

    push(...args: any[]) {
        return this.context.pine.array.push(this, ...args);
    }

    range(...args: any[]) {
        return this.context.pine.array.range(this, ...args);
    }

    remove(...args: any[]) {
        return this.context.pine.array.remove(this, ...args);
    }

    reverse(...args: any[]) {
        return this.context.pine.array.reverse(this, ...args);
    }

    set(...args: any[]) {
        return this.context.pine.array.set(this, ...args);
    }

    shift(...args: any[]) {
        return this.context.pine.array.shift(this, ...args);
    }

    size(...args: any[]) {
        return this.context.pine.array.size(this, ...args);
    }

    slice(...args: any[]) {
        return this.context.pine.array.slice(this, ...args);
    }

    some(...args: any[]) {
        return this.context.pine.array.some(this, ...args);
    }

    sort(...args: any[]) {
        return this.context.pine.array.sort(this, ...args);
    }

    sort_indices(...args: any[]) {
        return this.context.pine.array.sort_indices(this, ...args);
    }

    standardize(...args: any[]) {
        return this.context.pine.array.standardize(this, ...args);
    }

    stdev(...args: any[]) {
        return this.context.pine.array.stdev(this, ...args);
    }

    sum(...args: any[]) {
        return this.context.pine.array.sum(this, ...args);
    }

    unshift(...args: any[]) {
        return this.context.pine.array.unshift(this, ...args);
    }

    variance(...args: any[]) {
        return this.context.pine.array.variance(this, ...args);
    }
}

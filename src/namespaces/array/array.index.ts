// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:array-index

export { PineArrayObject } from './PineArrayObject';

import { PineArrayObject } from './PineArrayObject';
import { __from_int } from './methods/__from_int';
import { abs } from './methods/abs';
import { avg } from './methods/avg';
import { binary_search } from './methods/binary_search';
import { binary_search_leftmost } from './methods/binary_search_leftmost';
import { binary_search_rightmost } from './methods/binary_search_rightmost';
import { clear } from './methods/clear';
import { concat } from './methods/concat';
import { copy } from './methods/copy';
import { covariance } from './methods/covariance';
import { every } from './methods/every';
import { fill } from './methods/fill';
import { first } from './methods/first';
import { from } from './methods/from';
import { get } from './methods/get';
import { includes } from './methods/includes';
import { indexof } from './methods/indexof';
import { insert } from './methods/insert';
import { join } from './methods/join';
import { last } from './methods/last';
import { lastindexof } from './methods/lastindexof';
import { max } from './methods/max';
import { median } from './methods/median';
import { min } from './methods/min';
import { mode } from './methods/mode';
import { new_fn } from './methods/new';
import { new_bool } from './methods/new_bool';
import { new_box } from './methods/new_box';
import { new_color } from './methods/new_color';
import { new_float } from './methods/new_float';
import { new_int } from './methods/new_int';
import { new_label } from './methods/new_label';
import { new_line } from './methods/new_line';
import { new_linefill } from './methods/new_linefill';
import { new_string } from './methods/new_string';
import { new_table } from './methods/new_table';
import { param } from './methods/param';
import { percentile_linear_interpolation } from './methods/percentile_linear_interpolation';
import { percentile_nearest_rank } from './methods/percentile_nearest_rank';
import { percentrank } from './methods/percentrank';
import { pop } from './methods/pop';
import { push } from './methods/push';
import { range } from './methods/range';
import { remove } from './methods/remove';
import { reverse } from './methods/reverse';
import { set } from './methods/set';
import { shift } from './methods/shift';
import { size } from './methods/size';
import { slice } from './methods/slice';
import { some } from './methods/some';
import { sort } from './methods/sort';
import { sort_indices } from './methods/sort_indices';
import { standardize } from './methods/standardize';
import { stdev } from './methods/stdev';
import { sum } from './methods/sum';
import { unshift } from './methods/unshift';
import { variance } from './methods/variance';

export class PineArray {
  [key: string]: any;

  constructor(private context: any) {

    // Install methods
    this.__from_int = __from_int(context);
    this.abs = abs(context);
    this.avg = avg(context);
    this.binary_search = binary_search(context);
    this.binary_search_leftmost = binary_search_leftmost(context);
    this.binary_search_rightmost = binary_search_rightmost(context);
    this.clear = clear(context);
    this.concat = concat(context);
    this.copy = copy(context);
    this.covariance = covariance(context);
    this.every = every(context);
    this.fill = fill(context);
    this.first = first(context);
    this.from = from(context);
    this.get = get(context);
    this.includes = includes(context);
    this.indexof = indexof(context);
    this.insert = insert(context);
    this.join = join(context);
    this.last = last(context);
    this.lastindexof = lastindexof(context);
    this.max = max(context);
    this.median = median(context);
    this.min = min(context);
    this.mode = mode(context);
    this.new = new_fn(context);
    this.new_bool = new_bool(context);
    this.new_box = new_box(context);
    this.new_color = new_color(context);
    this.new_float = new_float(context);
    this.new_int = new_int(context);
    this.new_label = new_label(context);
    this.new_line = new_line(context);
    this.new_linefill = new_linefill(context);
    this.new_string = new_string(context);
    this.new_table = new_table(context);
    this.param = param(context);
    this.percentile_linear_interpolation = percentile_linear_interpolation(context);
    this.percentile_nearest_rank = percentile_nearest_rank(context);
    this.percentrank = percentrank(context);
    this.pop = pop(context);
    this.push = push(context);
    this.range = range(context);
    this.remove = remove(context);
    this.reverse = reverse(context);
    this.set = set(context);
    this.shift = shift(context);
    this.size = size(context);
    this.slice = slice(context);
    this.some = some(context);
    this.sort = sort(context);
    this.sort_indices = sort_indices(context);
    this.standardize = standardize(context);
    this.stdev = stdev(context);
    this.sum = sum(context);
    this.unshift = unshift(context);
    this.variance = variance(context);
  }
}

export default PineArray;

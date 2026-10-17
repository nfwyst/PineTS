// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:matrix-index

export { PineMatrixObject } from './PineMatrixObject';

import { PineMatrixObject } from './PineMatrixObject';
import { add_col } from './methods/add_col';
import { add_row } from './methods/add_row';
import { avg } from './methods/avg';
import { col } from './methods/col';
import { columns } from './methods/columns';
import { concat } from './methods/concat';
import { copy } from './methods/copy';
import { det } from './methods/det';
import { diff } from './methods/diff';
import { eigenvalues } from './methods/eigenvalues';
import { eigenvectors } from './methods/eigenvectors';
import { elements_count } from './methods/elements_count';
import { fill } from './methods/fill';
import { get } from './methods/get';
import { inv } from './methods/inv';
import { is_antidiagonal } from './methods/is_antidiagonal';
import { is_antisymmetric } from './methods/is_antisymmetric';
import { is_binary } from './methods/is_binary';
import { is_diagonal } from './methods/is_diagonal';
import { is_identity } from './methods/is_identity';
import { is_square } from './methods/is_square';
import { is_stochastic } from './methods/is_stochastic';
import { is_symmetric } from './methods/is_symmetric';
import { is_triangular } from './methods/is_triangular';
import { is_zero } from './methods/is_zero';
import { kron } from './methods/kron';
import { max } from './methods/max';
import { median } from './methods/median';
import { min } from './methods/min';
import { mode } from './methods/mode';
import { mult } from './methods/mult';
import { new_fn } from './methods/new';
import { param } from './methods/param';
import { pinv } from './methods/pinv';
import { pow } from './methods/pow';
import { rank } from './methods/rank';
import { remove_col } from './methods/remove_col';
import { remove_row } from './methods/remove_row';
import { reshape } from './methods/reshape';
import { reverse } from './methods/reverse';
import { row } from './methods/row';
import { rows } from './methods/rows';
import { set } from './methods/set';
import { sort } from './methods/sort';
import { submatrix } from './methods/submatrix';
import { sum } from './methods/sum';
import { swap_columns } from './methods/swap_columns';
import { swap_rows } from './methods/swap_rows';
import { trace } from './methods/trace';
import { transpose } from './methods/transpose';

export class PineMatrix {
    [key: string]: any;

    constructor(private context: any) {

        // Install methods
    this.add_col = add_col(context);
    this.add_row = add_row(context);
    this.avg = avg(context);
    this.col = col(context);
    this.columns = columns(context);
    this.concat = concat(context);
    this.copy = copy(context);
    this.det = det(context);
    this.diff = diff(context);
    this.eigenvalues = eigenvalues(context);
    this.eigenvectors = eigenvectors(context);
    this.elements_count = elements_count(context);
    this.fill = fill(context);
    this.get = get(context);
    this.inv = inv(context);
    this.is_antidiagonal = is_antidiagonal(context);
    this.is_antisymmetric = is_antisymmetric(context);
    this.is_binary = is_binary(context);
    this.is_diagonal = is_diagonal(context);
    this.is_identity = is_identity(context);
    this.is_square = is_square(context);
    this.is_stochastic = is_stochastic(context);
    this.is_symmetric = is_symmetric(context);
    this.is_triangular = is_triangular(context);
    this.is_zero = is_zero(context);
    this.kron = kron(context);
    this.max = max(context);
    this.median = median(context);
    this.min = min(context);
    this.mode = mode(context);
    this.mult = mult(context);
    this.new = new_fn(context);
    this.param = param(context);
    this.pinv = pinv(context);
    this.pow = pow(context);
    this.rank = rank(context);
    this.remove_col = remove_col(context);
    this.remove_row = remove_row(context);
    this.reshape = reshape(context);
    this.reverse = reverse(context);
    this.row = row(context);
    this.rows = rows(context);
    this.set = set(context);
    this.sort = sort(context);
    this.submatrix = submatrix(context);
    this.sum = sum(context);
    this.swap_columns = swap_columns(context);
    this.swap_rows = swap_rows(context);
    this.trace = trace(context);
    this.transpose = transpose(context);
    // Type-specific aliases — used internally by PineTS to handle strong types.
    // The transpiler rewrites matrix.new<float>(...) → matrix.new_float(...)
    this.new_float = new_fn(context);
    this.new_int = new_fn(context);
    this.new_string = new_fn(context);
    this.new_bool = new_fn(context);
    this.new_color = new_fn(context);
    this.new_line = new_fn(context);
    this.new_label = new_fn(context);
    this.new_box = new_fn(context);
    this.new_linefill = new_fn(context);
    this.new_table = new_fn(context);
    }
}

export default PineMatrix;

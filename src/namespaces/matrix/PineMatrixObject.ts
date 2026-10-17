// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:matrix-index

export class PineMatrixObject {
    public matrix: any[][];

    constructor(
        rows: number = 0,
        cols: number = 0,
        initialValue: any = NaN,
        public context: any
    ) {
        this.matrix = [];
        if (rows > 0 && cols > 0) {
            for (let i = 0; i < rows; i++) {
                this.matrix.push(Array(cols).fill(initialValue));
            }
        }
    }

    toString(): string {
        let result = '';
        for (let i = 0; i < this.matrix.length; i++) {
            result += result === '' ? '' : '\n';
            result += '[' + this.matrix[i].join(', ') + ']';
        }
        return result;
    }

    add_col(...args: any[]) {
        return this.context.pine.matrix.add_col(this, ...args);
    }

    add_row(...args: any[]) {
        return this.context.pine.matrix.add_row(this, ...args);
    }

    avg(...args: any[]) {
        return this.context.pine.matrix.avg(this, ...args);
    }

    col(...args: any[]) {
        return this.context.pine.matrix.col(this, ...args);
    }

    columns(...args: any[]) {
        return this.context.pine.matrix.columns(this, ...args);
    }

    concat(...args: any[]) {
        return this.context.pine.matrix.concat(this, ...args);
    }

    copy(...args: any[]) {
        return this.context.pine.matrix.copy(this, ...args);
    }

    det(...args: any[]) {
        return this.context.pine.matrix.det(this, ...args);
    }

    diff(...args: any[]) {
        return this.context.pine.matrix.diff(this, ...args);
    }

    eigenvalues(...args: any[]) {
        return this.context.pine.matrix.eigenvalues(this, ...args);
    }

    eigenvectors(...args: any[]) {
        return this.context.pine.matrix.eigenvectors(this, ...args);
    }

    elements_count(...args: any[]) {
        return this.context.pine.matrix.elements_count(this, ...args);
    }

    fill(...args: any[]) {
        return this.context.pine.matrix.fill(this, ...args);
    }

    get(...args: any[]) {
        return this.context.pine.matrix.get(this, ...args);
    }

    inv(...args: any[]) {
        return this.context.pine.matrix.inv(this, ...args);
    }

    is_antidiagonal(...args: any[]) {
        return this.context.pine.matrix.is_antidiagonal(this, ...args);
    }

    is_antisymmetric(...args: any[]) {
        return this.context.pine.matrix.is_antisymmetric(this, ...args);
    }

    is_binary(...args: any[]) {
        return this.context.pine.matrix.is_binary(this, ...args);
    }

    is_diagonal(...args: any[]) {
        return this.context.pine.matrix.is_diagonal(this, ...args);
    }

    is_identity(...args: any[]) {
        return this.context.pine.matrix.is_identity(this, ...args);
    }

    is_square(...args: any[]) {
        return this.context.pine.matrix.is_square(this, ...args);
    }

    is_stochastic(...args: any[]) {
        return this.context.pine.matrix.is_stochastic(this, ...args);
    }

    is_symmetric(...args: any[]) {
        return this.context.pine.matrix.is_symmetric(this, ...args);
    }

    is_triangular(...args: any[]) {
        return this.context.pine.matrix.is_triangular(this, ...args);
    }

    is_zero(...args: any[]) {
        return this.context.pine.matrix.is_zero(this, ...args);
    }

    kron(...args: any[]) {
        return this.context.pine.matrix.kron(this, ...args);
    }

    max(...args: any[]) {
        return this.context.pine.matrix.max(this, ...args);
    }

    median(...args: any[]) {
        return this.context.pine.matrix.median(this, ...args);
    }

    min(...args: any[]) {
        return this.context.pine.matrix.min(this, ...args);
    }

    mode(...args: any[]) {
        return this.context.pine.matrix.mode(this, ...args);
    }

    mult(...args: any[]) {
        return this.context.pine.matrix.mult(this, ...args);
    }

    pinv(...args: any[]) {
        return this.context.pine.matrix.pinv(this, ...args);
    }

    pow(...args: any[]) {
        return this.context.pine.matrix.pow(this, ...args);
    }

    rank(...args: any[]) {
        return this.context.pine.matrix.rank(this, ...args);
    }

    remove_col(...args: any[]) {
        return this.context.pine.matrix.remove_col(this, ...args);
    }

    remove_row(...args: any[]) {
        return this.context.pine.matrix.remove_row(this, ...args);
    }

    reshape(...args: any[]) {
        return this.context.pine.matrix.reshape(this, ...args);
    }

    reverse(...args: any[]) {
        return this.context.pine.matrix.reverse(this, ...args);
    }

    row(...args: any[]) {
        return this.context.pine.matrix.row(this, ...args);
    }

    rows(...args: any[]) {
        return this.context.pine.matrix.rows(this, ...args);
    }

    set(...args: any[]) {
        return this.context.pine.matrix.set(this, ...args);
    }

    sort(...args: any[]) {
        return this.context.pine.matrix.sort(this, ...args);
    }

    submatrix(...args: any[]) {
        return this.context.pine.matrix.submatrix(this, ...args);
    }

    sum(...args: any[]) {
        return this.context.pine.matrix.sum(this, ...args);
    }

    swap_columns(...args: any[]) {
        return this.context.pine.matrix.swap_columns(this, ...args);
    }

    swap_rows(...args: any[]) {
        return this.context.pine.matrix.swap_rows(this, ...args);
    }

    trace(...args: any[]) {
        return this.context.pine.matrix.trace(this, ...args);
    }

    transpose(...args: any[]) {
        return this.context.pine.matrix.transpose(this, ...args);
    }
}

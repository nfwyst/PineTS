// SPDX-License-Identifier: AGPL-3.0-only

const EPSILON = 1e-12;
const ITERATIONS_PER_DIMENSION = 1_000;
const MAX_EIGEN_WORK_UNITS = 20_000_000;

/** Mutable counter whose sole purpose is bounding synchronous matrix work. */
type WorkBudget = { remaining: number };

export type EigenDecomposition = {
    readonly values: number[];
    /** Eigenvectors stored by column, matching `values`. */
    readonly vectors: number[][];
};

function consumeWork(budget: WorkBudget, units: number): boolean {
    if (units > budget.remaining) return false;
    budget.remaining -= units;
    return true;
}

function identity(size: number): number[][] {
    return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) => (row === column ? 1 : 0)),
    );
}

function multiply(left: number[][], right: number[][]): number[][] {
    const size = left.length;
    return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) => {
            let sum = 0;
            for (let index = 0; index < size; index++) sum += left[row][index] * right[index][column];
            return sum;
        }),
    );
}

/** Reduce a general real matrix to upper Hessenberg form by orthogonal similarity. */
function toUpperHessenberg(input: number[][], budget: WorkBudget): number[][] | null {
    const size = input.length;
    if (!consumeWork(budget, size ** 3)) return null;
    const matrix = input.map((row) => [...row]);

    for (let column = 0; column < size - 2; column++) {
        const vector = Array.from(
            { length: size - column - 1 },
            (_, index) => matrix[column + 1 + index][column],
        );
        const norm = Math.hypot(...vector);
        if (norm <= EPSILON) continue;

        vector[0] += vector[0] >= 0 ? norm : -norm;
        const vectorNorm = Math.hypot(...vector);
        if (vectorNorm <= EPSILON) continue;
        for (let index = 0; index < vector.length; index++) vector[index] /= vectorNorm;

        // Left multiply by the Householder reflector.
        for (let targetColumn = column; targetColumn < size; targetColumn++) {
            let dot = 0;
            for (let index = 0; index < vector.length; index++) {
                dot += vector[index] * matrix[column + 1 + index][targetColumn];
            }
            for (let index = 0; index < vector.length; index++) {
                matrix[column + 1 + index][targetColumn] -= 2 * vector[index] * dot;
            }
        }

        // Right multiply by the same reflector to preserve similarity.
        for (let row = 0; row < size; row++) {
            let dot = 0;
            for (let index = 0; index < vector.length; index++) {
                dot += matrix[row][column + 1 + index] * vector[index];
            }
            for (let index = 0; index < vector.length; index++) {
                matrix[row][column + 1 + index] -= 2 * dot * vector[index];
            }
        }

        for (let row = column + 2; row < size; row++) matrix[row][column] = 0;
    }

    return matrix;
}

/** Householder QR decomposition, stable enough for the shifted QR iteration below. */
function qrDecompose(input: number[][]): { readonly q: number[][]; readonly r: number[][] } {
    const size = input.length;
    const q = identity(size);
    const r = input.map((row) => [...row]);

    for (let column = 0; column < size - 1; column++) {
        const vector = Array.from({ length: size - column }, (_, index) => r[column + index][column]);
        const norm = Math.hypot(...vector);
        if (norm <= EPSILON) continue;
        vector[0] += vector[0] >= 0 ? norm : -norm;
        const vectorNorm = Math.hypot(...vector);
        if (vectorNorm <= EPSILON) continue;
        for (let index = 0; index < vector.length; index++) vector[index] /= vectorNorm;

        for (let targetColumn = column; targetColumn < size; targetColumn++) {
            let dot = 0;
            for (let index = 0; index < vector.length; index++) dot += vector[index] * r[column + index][targetColumn];
            for (let index = 0; index < vector.length; index++) r[column + index][targetColumn] -= 2 * vector[index] * dot;
        }
        for (let row = 0; row < size; row++) {
            let dot = 0;
            for (let index = 0; index < vector.length; index++) dot += q[row][column + index] * vector[index];
            for (let index = 0; index < vector.length; index++) q[row][column + index] -= 2 * dot * vector[index];
        }
    }
    return { q, r };
}

function wilkinsonShift(matrix: number[][], size: number): number {
    const a = matrix[size - 2][size - 2];
    const b = matrix[size - 2][size - 1];
    const c = matrix[size - 1][size - 2];
    const d = matrix[size - 1][size - 1];
    const discriminant = (a - d) ** 2 + 4 * b * c;
    if (discriminant < 0) return d;
    const root = Math.sqrt(discriminant);
    const first = (a + d + root) / 2;
    const second = (a + d - root) / 2;
    return Math.abs(first - d) < Math.abs(second - d) ? first : second;
}

function eigenvalues(input: number[][], budget: WorkBudget): number[] {
    const matrix = toUpperHessenberg(input, budget);
    if (!matrix) return new Array(input.length).fill(NaN);
    const values = new Array<number>(matrix.length);
    let size = matrix.length;

    while (size > 1) {
        let iterations = 0;
        while (true) {
            const scale = Math.max(1, Math.abs(matrix[size - 2][size - 2]) + Math.abs(matrix[size - 1][size - 1]));
            if (Math.abs(matrix[size - 1][size - 2]) <= EPSILON * scale) {
                values[size - 1] = matrix[size - 1][size - 1];
                size--;
                break;
            }

            const pairScale = size === 2
                ? 1
                : Math.max(1, Math.abs(matrix[size - 3][size - 3]) + Math.abs(matrix[size - 2][size - 2]));
            const pairIsIsolated = size === 2 || Math.abs(matrix[size - 2][size - 3]) <= EPSILON * pairScale;
            if (pairIsIsolated) {
                const a = matrix[size - 2][size - 2];
                const b = matrix[size - 2][size - 1];
                const c = matrix[size - 1][size - 2];
                const d = matrix[size - 1][size - 1];
                const discriminant = (a - d) ** 2 + 4 * b * c;
                const root = discriminant >= 0 ? Math.sqrt(discriminant) : NaN;
                values[size - 2] = (a + d + root) / 2;
                values[size - 1] = (a + d - root) / 2;
                size -= 2;
                break;
            }

            const iterationWork = 2 * size ** 3;
            if (iterations >= ITERATIONS_PER_DIMENSION * size || !consumeWork(budget, iterationWork)) {
                for (let index = 0; index < size; index++) values[index] = NaN;
                return values;
            }
            const shift = wilkinsonShift(matrix, size);
            const block = Array.from({ length: size }, (_, row) =>
                Array.from({ length: size }, (_, column) => matrix[row][column] - (row === column ? shift : 0)),
            );
            const { q, r } = qrDecompose(block);
            const next = multiply(r, q);
            for (let row = 0; row < size; row++) {
                for (let column = 0; column < size; column++) {
                    matrix[row][column] = next[row][column] + (row === column ? shift : 0);
                }
            }
            iterations++;
        }
    }
    if (size === 1) values[0] = matrix[0][0];
    return values;
}

function solve(matrix: number[][], right: number[]): number[] | null {
    const size = matrix.length;
    const augmented = matrix.map((row, index) => [...row, right[index]]);
    for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++) {
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
        }
        if (Math.abs(augmented[pivot][column]) <= EPSILON) return null;
        [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
        const divisor = augmented[column][column];
        for (let index = column; index <= size; index++) augmented[column][index] /= divisor;
        for (let row = 0; row < size; row++) {
            if (row === column) continue;
            const factor = augmented[row][column];
            for (let index = column; index <= size; index++) augmented[row][index] -= factor * augmented[column][index];
        }
    }
    return augmented.map((row) => row[size]);
}

function eigenvector(matrix: number[][], value: number, seed: number, budget: WorkBudget): number[] {
    const size = matrix.length;
    if (!Number.isFinite(value)) return new Array(size).fill(NaN);
    let vector = Array.from({ length: size }, (_, index) => 1 + ((index + seed) % Math.max(1, size)) / Math.max(1, size));
    const perturbation = Math.max(1, Math.abs(value)) * 1e-10 * (seed + 1);
    const shifted = matrix.map((row, rowIndex) =>
        row.map((entry, columnIndex) => entry - (rowIndex === columnIndex ? value + perturbation : 0)),
    );

    for (let iteration = 0; iteration < 32; iteration++) {
        if (!consumeWork(budget, size ** 3)) return new Array(size).fill(NaN);
        const next = solve(shifted, vector);
        if (!next) break;
        const norm = Math.hypot(...next);
        if (!(norm > EPSILON)) break;
        vector = next.map((entry) => entry / norm);
    }
    const norm = Math.hypot(...vector);
    if (!(norm > EPSILON)) return new Array(size).fill(NaN);
    vector = vector.map((entry) => entry / norm);
    let largest = 0;
    for (let index = 1; index < size; index++) {
        if (Math.abs(vector[index]) > Math.abs(vector[largest])) largest = index;
    }
    if (vector[largest] < 0) vector = vector.map((entry) => -entry);
    return vector;
}

function isSquareFinite(input: number[][]): boolean {
    const size = input.length;
    return input.every((row) => row.length === size && row.every(Number.isFinite));
}

function isDiagonal(input: number[][]): boolean {
    return input.every((row, rowIndex) =>
        row.every((entry, columnIndex) => rowIndex === columnIndex || Math.abs(entry) <= EPSILON),
    );
}

/** Keep numerical tolerances and inverse-iteration shifts relative to the matrix scale. */
function normalize(input: number[][]): { readonly matrix: number[][]; readonly scale: number } {
    const scale = input.reduce((largest, row) =>
        row.reduce((current, entry) => Math.max(current, Math.abs(entry)), largest),
    0) || 1;
    return { matrix: input.map((row) => row.map((entry) => entry / scale)), scale };
}

export function calculateEigenvalues(input: number[][]): number[] {
    if (input.length === 0) return [];
    if (!isSquareFinite(input)) return new Array(input.length).fill(NaN);
    const { matrix, scale } = normalize(input);
    if (isDiagonal(matrix)) return input.map((row, index) => row[index]);
    return eigenvalues(matrix, { remaining: MAX_EIGEN_WORK_UNITS }).map((value) => value * scale);
}

export function decomposeEigen(input: number[][]): EigenDecomposition {
    const size = input.length;
    if (size === 0) return { values: [], vectors: [] };
    if (!isSquareFinite(input)) {
        return {
            values: new Array(size).fill(NaN),
            vectors: Array.from({ length: size }, () => new Array(size).fill(NaN)),
        };
    }

    const { matrix, scale } = normalize(input);
    if (isDiagonal(matrix)) {
        return { values: input.map((row, index) => row[index]), vectors: identity(size) };
    }

    const budget = { remaining: MAX_EIGEN_WORK_UNITS };
    const values = eigenvalues(matrix, budget);
    const columns = values.map((value, index) => eigenvector(matrix, value, index, budget));
    const vectors = Array.from({ length: size }, (_, row) => columns.map((column) => column[row]));
    return { values: values.map((value) => value * scale), vectors };
}

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { PineMatrixObject } from '../../../src/namespaces/matrix/PineMatrixObject';

function context(): Context {
    return new Context({ marketData: [], source: [] });
}

describe('matrix eigen decomposition', () => {
    it.each([1e-14, 1e12])('preserves eigenvalues and eigenvectors under scaling by %s', (scale) => {
        const ctx = context();
        const matrix = new PineMatrixObject(2, 2, 0, ctx);
        matrix.matrix = [[scale, scale], [scale, scale]];

        const values = ctx.pine.matrix.eigenvalues(matrix).array;
        const vectors = ctx.pine.matrix.eigenvectors(matrix).matrix;

        // The all-ones matrix has eigenvalues 0 and 2; scaling preserves its eigenvectors.
        expect(values.map((value: number) => value / scale).toSorted()).toEqual([0, 2]);
        for (let column = 0; column < 2; column++) {
            const x = vectors[0][column];
            const y = vectors[1][column];
            expect(Math.hypot(x, y)).toBeCloseTo(1, 10);
            expect(x + y).toBeCloseTo(values[column] / scale * x, 8);
            expect(x + y).toBeCloseTo(values[column] / scale * y, 8);
        }
    });

    it('returns all eigenvalues of a 3x3 diagonal matrix', () => {
        const ctx = context();
        const matrix = new PineMatrixObject(3, 3, 0, ctx);
        matrix.matrix[0][0] = 1;
        matrix.matrix[1][1] = 2;
        matrix.matrix[2][2] = 3;

        const values = ctx.pine.matrix.eigenvalues(matrix).array.toSorted((left, right) => left - right);

        expect(values).toEqual([1, 2, 3]);
    });

    it('returns normalized right eigenvectors paired with their eigenvalues', () => {
        const ctx = context();
        const matrix = new PineMatrixObject(2, 2, 0, ctx);
        matrix.matrix = [[4, 1], [2, 3]];

        const values = ctx.pine.matrix.eigenvalues(matrix).array;
        const vectors = ctx.pine.matrix.eigenvectors(matrix).matrix;

        for (let column = 0; column < 2; column++) {
            const x = vectors[0][column];
            const y = vectors[1][column];
            const lambda = values[column];
            expect(Math.hypot(x, y)).toBeCloseTo(1, 10);
            expect(4 * x + y).toBeCloseTo(lambda * x, 8);
            expect(2 * x + 3 * y).toBeCloseTo(lambda * y, 8);
        }
    });

    it('decomposes a dense 4x4 real matrix without premature deflation', () => {
        const ctx = context();
        const matrix = new PineMatrixObject(4, 4, 0, ctx);
        matrix.matrix = [
            [1, 1, 0, -1],
            [5, 1, 0, 3],
            [-11, 5, 1, -8],
            [7, -3, 0, 7],
        ];

        const values = ctx.pine.matrix.eigenvalues(matrix).array;
        const vectors = ctx.pine.matrix.eigenvectors(matrix).matrix;

        expect(values.toSorted((left, right) => left - right)).toEqual([
            expect.closeTo(1, 8),
            expect.closeTo(2, 8),
            expect.closeTo(3, 8),
            expect.closeTo(4, 8),
        ]);
        for (let column = 0; column < values.length; column++) {
            const residual = Math.hypot(...matrix.matrix.map((row, rowIndex) =>
                row.reduce((sum, entry, index) => sum + entry * vectors[index][column], 0)
                - values[column] * vectors[rowIndex][column],
            ));
            expect(residual).toBeLessThan(1e-8);
        }
    });

    it('bounds work for isolated complex-conjugate eigenvalue pairs', () => {
        // Given
        const ctx = context();
        const size = 16;
        const matrix = new PineMatrixObject(size, size, 0, ctx);
        for (let index = 0; index < size; index += 2) {
            matrix.matrix[index][index + 1] = -1;
            matrix.matrix[index + 1][index] = 1;
        }

        // When
        const startedAt = performance.now();
        const values = ctx.pine.matrix.eigenvalues(matrix).array;
        const elapsedMs = performance.now() - startedAt;

        // Then
        expect(values).toHaveLength(size);
        expect(values.every(Number.isNaN)).toBe(true);
        expect(elapsedMs).toBeLessThan(1_000);
    });

    it('does not calculate eigenvectors for an eigenvalue-only call', () => {
        // Given
        const ctx = context();
        const size = 96;
        const matrix = new PineMatrixObject(size, size, 0, ctx);
        for (let index = 0; index < size; index++) matrix.matrix[index][index] = index + 1;

        // When
        const startedAt = performance.now();
        const values = ctx.pine.matrix.eigenvalues(matrix).array;
        const elapsedMs = performance.now() - startedAt;

        // Then
        expect(values).toHaveLength(size);
        expect(elapsedMs).toBeLessThan(500);
    });
});

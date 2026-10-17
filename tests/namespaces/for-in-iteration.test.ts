// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '@pinets/marketData/Provider.class';

/**
 * End-to-end runtime tests for `for x in collection` and `for [i, x] in collection`
 * codegen. Iteration must work uniformly across:
 *   - PineArrayObject (var/let arrays, UDT array fields, function params)
 *   - Plain JS arrays (built-ins like box.all, line.all, label.all)
 * for both destructuring and non-destructuring forms.
 *
 * Regressions caught here:
 *   - `for [i, x] in udt.field`  used to throw "is not iterable" (no .array.entries())
 *   - `for el in box.all`        regressed when codegen unconditionally added .array
 */
describe('for-in iteration — runtime end-to-end', () => {
    const mkPts = () =>
        new PineTS(
            Provider.Mock,
            'BTCUSDC',
            'D',
            null,
            new Date('2024-01-01').getTime(),
            new Date('2024-01-15').getTime(),
        );

    it('iterates a PineArrayObject identifier (non-destructuring)', async () => {
        const code = `
//@version=6
indicator("for-in identifier")
var arr = array.from(10.0, 20.0, 30.0, 40.0)
sum = 0.0
for v in arr
    sum := sum + v
plot(sum, "sum")
        `;
        const { plots } = await mkPts().run(code);
        const last = (a: any[]) => a[a.length - 1].value;
        expect(last(plots['sum'].data)).toBe(100);
    });

    it('iterates a PineArrayObject identifier with destructuring', async () => {
        const code = `
//@version=6
indicator("for-in identifier destructured")
var arr = array.from(10.0, 20.0, 30.0, 40.0)
idxsum = 0
valsum = 0.0
for [i, v] in arr
    idxsum := idxsum + i
    valsum := valsum + v
plot(idxsum, "idxsum")
plot(valsum, "valsum")
        `;
        const { plots } = await mkPts().run(code);
        const last = (a: any[]) => a[a.length - 1].value;
        expect(last(plots['idxsum'].data)).toBe(0 + 1 + 2 + 3);
        expect(last(plots['valsum'].data)).toBe(100);
    });

    it('iterates a UDT array field (non-destructuring) — member expression', async () => {
        const code = `
//@version=6
indicator("for-in udt.field")
type bucket
    array<float> prices = na
var b = bucket.new(array.from(1.5, 2.5, 3.5))
sum = 0.0
for p in b.prices
    sum := sum + p
plot(sum, "sum")
        `;
        const { plots } = await mkPts().run(code);
        const last = (a: any[]) => a[a.length - 1].value;
        expect(last(plots['sum'].data)).toBeCloseTo(7.5);
    });

    it('iterates a UDT array field with destructuring — member expression', async () => {
        // Regression: was throwing "is not iterable" — destructuring a scalar yielded
        // by PineArrayObject's [Symbol.iterator]
        const code = `
//@version=6
indicator("for-in udt.field destructured")
type bucket
    array<float> prices = na
var b = bucket.new(array.from(10.0, 20.0, 30.0))
idxsum = 0
valsum = 0.0
for [i, p] in b.prices
    idxsum := idxsum + i
    valsum := valsum + p
plot(idxsum, "idxsum")
plot(valsum, "valsum")
        `;
        const { plots } = await mkPts().run(code);
        const last = (a: any[]) => a[a.length - 1].value;
        expect(last(plots['idxsum'].data)).toBe(0 + 1 + 2);
        expect(last(plots['valsum'].data)).toBe(60);
    });

    it('iterates a built-in plain JS array (box.all) — non-destructuring', async () => {
        // Regression: built-ins like box.all return plain JS arrays (no .array field).
        // Previously codegen emitted `box.all.array` → undefined → "is not iterable".
        const code = `
//@version=6
indicator("for-in box.all")
if barstate.islast
    box.new(0, 100, 1, 50)
    box.new(2, 200, 3, 150)
    box.new(4, 300, 5, 250)
count = 0
for el in box.all
    count := count + 1
plot(count, "count")
        `;
        const { plots } = await mkPts().run(code);
        const last = (a: any[]) => a[a.length - 1].value;
        expect(last(plots['count'].data)).toBe(3);
    });

    it('iterates a built-in plain JS array (box.all) — destructuring', async () => {
        const code = `
//@version=6
indicator("for-in box.all destructured")
if barstate.islast
    box.new(0, 100, 1, 50)
    box.new(2, 200, 3, 150)
idxsum = 0
for [i, el] in box.all
    idxsum := idxsum + i
plot(idxsum, "idxsum")
        `;
        const { plots } = await mkPts().run(code);
        const last = (a: any[]) => a[a.length - 1].value;
        expect(last(plots['idxsum'].data)).toBe(0 + 1);
    });

    it('iterates matrix rows at top level as Pine arrays', async () => {
        // Given: two rows whose elements sum to six.
        const code = `
//@version=6
indicator("for-in matrix rows")
m = matrix.new<float>(2, 2, 0.0)
m.set(0, 0, 1.0)
m.set(0, 1, 2.0)
m.set(1, 0, 3.0)
total = 0.0
// When: the matrix is traversed row by row.
for row in m
    total += row.sum()
    row.set(0, 99.0)
// Then: each row supports Pine array methods and contributes in order.
plot(total, "total")
plot(m.get(0, 0), "matrixFirst")
        `;

        const { plots } = await mkPts().run(code);
        const totalData = plots['total'].data;
        const matrixData = plots['matrixFirst'].data;
        expect(totalData[totalData.length - 1].value).toBe(6);
        expect(matrixData[matrixData.length - 1].value).toBe(1);
    });

    it('iterates matrix rows inside a UDF', async () => {
        // Given: a UDF receiving a populated matrix.
        const code = `
//@version=6
indicator("for-in matrix rows udf")
sumRows(m) =>
    total = 0.0
    // When: the UDF iterates its matrix parameter.
    for row in m
        total += row.sum()
    total
m = matrix.new<float>(2, 2, 0.0)
m.set(0, 0, 1.0)
m.set(0, 1, 2.0)
m.set(1, 0, 3.0)
// Then: wrapped rows behave the same through the function boundary.
plot(sumRows(m), "total")
        `;

        const { plots } = await mkPts().run(code);
        const data = plots['total'].data;
        expect(data[data.length - 1].value).toBe(6);
    });

    it('iterates nested matrix rows and values in order', async () => {
        // Given: a matrix with a distinctive row-major value sequence.
        const code = `
//@version=6
indicator("for-in nested matrix rows")
m = matrix.new<int>(2, 2, 0)
m.set(0, 0, 1)
m.set(0, 1, 2)
m.set(1, 0, 3)
encoded = 0
// When: matrix rows and their elements are traversed with nested loops.
for row in m
    for value in row
        encoded := encoded * 10 + value
// Then: traversal is row-major.
plot(encoded, "encoded")
        `;

        const { plots } = await mkPts().run(code);
        const data = plots['encoded'].data;
        expect(data[data.length - 1].value).toBe(1230);
    });

    it('matrix index yields zero-based indices and wrapped row values', async () => {
        // Given: equal row sums at distinct indices.
        const code = `
//@version=6
indicator("for-in matrix index")
m = matrix.new<float>(2, 2, 0.0)
m.set(0, 0, 1.0)
m.set(0, 1, 2.0)
m.set(1, 0, 3.0)
indexTotal = 0
weightedRows = 0.0
// When: indexed matrix iteration destructures each entry.
for [i, row] in m
    indexTotal += i
    weightedRows += (i + 1) * row.sum()
// Then: indices are zero-based and values remain Pine arrays.
plot(indexTotal, "indices")
plot(weightedRows, "weighted")
        `;

        const { plots } = await mkPts().run(code);
        const indexData = plots['indices'].data;
        const weightedData = plots['weighted'].data;
        expect(indexData[indexData.length - 1].value).toBe(1);
        expect(weightedData[weightedData.length - 1].value).toBe(9);
    });

    it('empty matrix executes zero iterations', async () => {
        // Given: a matrix with no rows.
        const code = `
//@version=6
indicator("for-in empty matrix")
m = matrix.new<float>(0, 0, 0.0)
count = 0
// When: the empty matrix is traversed.
for row in m
    count += 1
// Then: the loop body never executes.
plot(count, "count")
        `;

        const { plots } = await mkPts().run(code);
        const data = plots['count'].data;
        expect(data[data.length - 1].value).toBe(0);
    });
});

// Regression guard: resource-consumption limits that keep a single Pine script
// from hanging or exhausting the host (DoS), and from draining the host
// operator's data-provider quota. TradingView bounds all of these; PineTS now
// does too. See the security advisory findings F2 (matrix.pow(Infinity) +
// uncapped allocations) and F3 (request.security fan-out).

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '@pinets/marketData/Provider.class';
import { PineRuntimeError } from '../../src/errors/PineRuntimeError';
import { Context } from '../../src/Context.class';
import { PineArrayObject, PineArrayType } from '../../src/namespaces/array/PineArrayObject';
import { PineMatrixObject } from '../../src/namespaces/matrix/PineMatrixObject';
import { MAX_COLLECTION_ELEMENTS } from '../../src/namespaces/limits';

function newPineTS(sStr = '2024-01-01', eStr = '2024-01-02') {
    return new PineTS(Provider.Mock, 'BTCUSDC', '60', null, new Date(sStr).getTime(), new Date(eStr).getTime());
}
const H = `//@version=6\nindicator("t")\n`;

describe('F2 — matrix.pow with a non-finite power terminates (no infinite loop)', () => {
    it('returns instead of hanging on matrix.pow(m, Infinity)', async () => {
        // math.pow(10, 400) === Infinity; before the fix this was an unbreakable CPU spin.
        const { plots } = await newPineTS().run(H + `m = matrix.new<float>(2, 2, 1.0)\nr = matrix.pow(m, math.pow(10, 400))\nplot(close)`);
        expect(Object.values(plots).length).toBeGreaterThan(0); // the run completed
    });

    it('still computes a finite matrix power', async () => {
        const { plots } = await newPineTS().run(H + `m = matrix.new<float>(2, 2, 1.0)\nr = matrix.pow(m, 3)\nplot(matrix.get(r, 0, 0))`);
        const v = (Object.values(plots)[0] as any).data.at(-1).value;
        expect(Number.isFinite(v)).toBe(true);
    });
});

describe('F2 — collection built-ins cap allocation at the element limit', () => {
    const tooBig: Array<[string, string]> = [
        ['array.new_float', `a = array.new_float(200000)\nplot(close)`],
        ['matrix.new', `m = matrix.new<float>(1000, 1000, 0.0)\nplot(close)`],
        ['str.repeat', `s = str.repeat("ab", 10000000)\nplot(close)`],
        ['table.new', `t = table.new(position.top_right, 1000, 1000)\nplot(close)`],
    ];
    for (const [name, body] of tooBig) {
        it(`${name} over the limit raises a PineRuntimeError`, async () => {
            await expect(newPineTS().run(H + body)).rejects.toBeInstanceOf(PineRuntimeError);
        });
    }

    it('allocations within the limit still work', async () => {
        const { plots } = await newPineTS().run(H + `a = array.new_float(100, 0.0)\nplot(array.size(a))`);
        expect((Object.values(plots)[0] as any).data.at(-1).value).toBe(100);
    });
});

describe('F2 — collection mutations cannot grow past the element limit', () => {
    function newContext(): Context {
        return new Context({ marketData: [], source: [] });
    }

    function sparseArray(context: Context, length: number): PineArrayObject {
        return new PineArrayObject(new Array(length), PineArrayType.float, context);
    }

    const growthCases: Array<[string, () => void]> = [
        ['array.push', () => {
            const context = newContext();
            context.pine.array.push(sparseArray(context, MAX_COLLECTION_ELEMENTS), 1);
        }],
        ['array.unshift', () => {
            const context = newContext();
            context.pine.array.unshift(sparseArray(context, MAX_COLLECTION_ELEMENTS), 1);
        }],
        ['array.insert', () => {
            const context = newContext();
            context.pine.array.insert(sparseArray(context, MAX_COLLECTION_ELEMENTS), 0, 1);
        }],
        ['array.concat', () => {
            const context = newContext();
            const left = sparseArray(context, 60_000);
            const right = sparseArray(context, 40_001);
            context.pine.array.concat(left, right);
        }],
        ['array slice growth', () => {
            const context = newContext();
            const source = sparseArray(context, MAX_COLLECTION_ELEMENTS);
            const slice = context.pine.array.slice(source, 0, MAX_COLLECTION_ELEMENTS);
            context.pine.array.push(slice, 1);
        }],
        ['matrix.add_row', () => {
            const context = newContext();
            const matrix = new PineMatrixObject(0, 0, NaN, context);
            matrix.matrix = Array.from({ length: 1_000 }, () => new Array(100));
            context.pine.matrix.add_row(matrix);
        }],
    ];

    for (const [name, grow] of growthCases) {
        it(`${name} over the limit raises a PineRuntimeError`, () => {
            expect(grow).toThrow(PineRuntimeError);
        });
    }
});

describe('F3 — request.security fan-out is bounded per run', () => {
    it('a per-bar-varying symbol stops with a PineRuntimeError (quota guard)', async () => {
        // One call site whose symbol changes every bar would otherwise create one
        // provider fetch per bar on the host's API key.
        await expect(
            newPineTS('2024-01-01', '2024-01-05').run(H + `s = str.tostring(ta.cum(1))\nv = request.security(s, "D", close)\nplot(v)`)
        ).rejects.toBeInstanceOf(PineRuntimeError);
    });

    it('a normal, constant-symbol request.security still runs', async () => {
        await expect(
            newPineTS('2024-01-01', '2024-01-05').run(H + `v = request.security("ETHUSDC", "D", close)\nplot(v)`)
        ).resolves.toBeTruthy();
    });
});

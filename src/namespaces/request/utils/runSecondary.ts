// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from '../../../Context.class';
import type { PineTS } from '../../../PineTS.class';

type SecondaryParentContext = Context & {
    readonly _ltfTruncatedBodies?: Readonly<Record<string, Function>>;
};

/** Run a request expression slice, falling back when it did not capture this call path. */
export async function runSecondary(context: SecondaryParentContext, pineTS: PineTS, expressionName: unknown): Promise<Context> {
    const expressionNameString = typeof expressionName === 'string' ? expressionName : '';
    const sliceKey = expressionNameString.match(/p\d+$/)?.[0] ?? expressionNameString;
    const slice = context._ltfTruncatedBodies?.[sliceKey];
    if (slice) {
        const secondaryContext = await pineTS.runPretranspiled(slice, context.inputs);
        if (secondaryContext.params[expressionNameString] !== undefined) return secondaryContext;
    }
    if (context.transpiledFn === null) {
        throw new TypeError('A prepared parent function is required for secondary execution');
    }
    return pineTS.runPretranspiled(context.transpiledFn, context.inputs);
}

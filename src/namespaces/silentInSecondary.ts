// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * `@silentInSecondary` — method decorator.
 *
 * Marks a helper method as a no-op when invoked on a secondary context
 * (i.e. the auxiliary PineTS instance that `request.security` /
 * `request.security_lower_tf` spawns to compute the captured expression
 * at another symbol/timeframe).
 *
 * Drawings, plots, alerts and similar side-effect-only operations are
 * never observable from a secondary context — its sole job is to populate
 * `secContext.params[expression_name]` with the value of the captured
 * expression bar-by-bar. Silencing those operations on secondaries cuts
 * the per-bar work substantially without changing the captured value
 * (the only output that callers ever read).
 *
 * Constructor-style methods (e.g. `label.new`, `line.new`, `box.new`)
 * return `null`; setters / mutators / deletes return `undefined`. The
 * existing helper code is null-safe end-to-end:
 *   - `get_*` methods already return `NaN`/`""` when the receiver is null.
 *   - The transpiler emits method calls on UDT-typed receivers as
 *     `obj?.method?.(...)`, so `null?.set_x1?.(...)` short-circuits.
 *   - Built-in setters like `LineHelper.set_x1(id, x)` already guard
 *     `if (id && !id._deleted) ...` and no-op on null.
 *
 * Pre-condition: target classes use the conventional
 *   `constructor(private context: any) {}`
 * shape, so `this.context.isSecondaryContext` is uniformly accessible.
 * (`Core.ts` `AlertHelper`, `Plots.ts` `PlotHelper`/`HlineHelper`/
 * `FillHelper`, and the drawing helpers all conform.)
 */
// Supports BOTH decorator semantics so PineTS source can be imported from any
// Bun/TS project regardless of its tsconfig:
//   - legacy experimentalDecorators (PineTS own tsconfig):
//       (target, propertyKey, descriptor) => descriptor
//   - TC39 stage-3/standard decorators (Bun default when the importing
//     project has no experimentalDecorators config in scope):
//       (value, context) where context.kind === 'method'
export function silentInSecondary(target: any, propertyKey: any, descriptor?: any): any {
    const wrap = (original: (...args: any[]) => any) =>
        function (this: any, ...args: any[]) {
            if (this && this.context && this.context.isSecondaryContext) {
                return null;
            }
            return original.apply(this, args);
        };

    // TC39 standard method decorator: silentInSecondary(value, {kind:'method'})
    if (typeof target === 'function' && propertyKey && typeof propertyKey === 'object' && propertyKey.kind === 'method') {
        return wrap(target);
    }

    // Legacy experimental decorator: (target, key, descriptor)
    const d = descriptor as PropertyDescriptor | undefined;
    if (!d || typeof d.value !== 'function') return d;
    d.value = wrap(d.value);
    return d;
}

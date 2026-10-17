// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compile-time warning CW10011: "Shadowing built-in variable \"<name>\"".
 *
 * TradingView warns (but compiles) whenever a user declares a variable,
 * function parameter, or for-loop variable whose bare identifier matches a
 * Pine built-in *variable* — e.g. `second = close`, `f(open) =>`,
 * `for high = 0 to 10`. Namespace *names* (e.g. a parameter named `color`,
 * `line`, `table`) are a different rule handled elsewhere and must not be
 * reported here: they are not variables and Pine allows `color.red` to stay
 * reachable through the namespace.
 *
 * Scope semantics mirror TradingView:
 *  - Re-declaring the same user name in a nested scope shadows the outer
 *    *user* variable — no warning (it is not a builtin).
 *  - Declaring the builtin name in ANY scope (global, function, if/for block)
 *    warns once per declaration site, including when an outer user variable
 *    of the same name already exists (the first declaration already shadowed
 *    the builtin; TradingView warns on every binding).
 *  - Tuples are Pine's multi-return binding (`[a, b] = f()`): each id warns
 *    independently.
 *
 * The pass only inspects declaration targets; it never executes or
 * type-checks the initializer, so it cannot reject code — it only collects
 * warning strings.
 */

import { walk } from 'estree-walker';
import { BUILTIN_VARIABLE_NAMES } from './inputs/qualifiers';

export interface PineWarning {
    /** TradingView diagnostic code. */
    readonly code: 'CW10011';
    /** Full TradingView-style message. */
    readonly message: string;
    /** 1-based line:column of the first character of the shadowed name. */
    readonly line: number;
    readonly column: number;
    readonly name: string;
}

function positionOf(id: any): { line: number; column: number } | null {
    if (id?.sourceSpan?.start) {
        return { line: id.sourceSpan.start.line, column: id.sourceSpan.start.column };
    }
    if (typeof id?._pos === 'string' && /^\d+:\d+$/.test(id._pos)) {
        const [line, column] = id._pos.split(':').map(Number);
        return { line, column };
    }
    return null;
}

function makeWarning(name: string, id: any): PineWarning | null {
    const pos = positionOf(id);
    if (!pos) return null;
    return {
        code: 'CW10011',
        message: `Shadowing built-in variable "${name}"`,
        line: pos.line,
        column: pos.column,
        name,
    };
}

function targetIds(node: any): any[] {
    // VariableDeclaration.declarations: VariableDeclarator[]
    if (node.type === 'VariableDeclaration') {
        return (node.declarations ?? [])
            .map((d: any) => d?.id)
            .filter((id: any) => id?.type === 'Identifier');
    }
    if (node.type === 'FunctionDeclaration') {
        // Params are pushed as bare Identifiers (or AssignmentPattern with an
        // Identifier on the left when they carry a default value).
        return (node.params ?? [])
            .map((p: any) => (p?.type === 'AssignmentPattern' ? p.left : p))
            .filter((id: any) => id?.type === 'Identifier');
    }
    if (node.type === 'ForStatement' && !node.isForIn) {
        // C-style for: init is a VariableDeclaration with a single counter.
        if (node.init?.type === 'VariableDeclaration') {
            return (node.init.declarations ?? [])
                .map((d: any) => d?.id)
                .filter((id: any) => id?.type === 'Identifier');
        }
    }
    if (node.type === 'ForStatement' && node.isForIn) {
        // for-in is lowered to a CONST VariableDeclaration holding the
        // iterable; the loop variable sits in init.declarations[0].id.
        if (node.init?.type === 'VariableDeclaration') {
            return (node.init.declarations ?? [])
                .map((d: any) => d?.id)
                .filter((id: any) => id?.type === 'Identifier');
        }
    }
    return [];
}

/**
 * Collect every binding that shadows a bare built-in variable.
 * The pass is deliberately conservative: only node types that unambiguously
 * introduce new bindings are inspected.
 */
export function collectBuiltinShadowWarnings(ast: any): PineWarning[] {
    const warnings: PineWarning[] = [];
    const seen = new Set<string>();

    const consider = (id: any) => {
        if (id?.type !== 'Identifier' || !BUILTIN_VARIABLE_NAMES.has(id.name)) return;
        const w = makeWarning(id.name, id);
        if (!w) return;
        const key = `${w.line}:${w.column}:${w.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        warnings.push(w);
    };

    walk(ast as any, {
        enter(node: any) {
            for (const id of targetIds(node)) consider(id);
        },
    });

    warnings.sort((a, b) => a.line - b.line || a.column - b.column);
    return warnings;
}

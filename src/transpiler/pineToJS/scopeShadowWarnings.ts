// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compile-time warning CW10013:
 *   `Shadowing variable "<name>" which exists in parent scope. Did you want to
 *    use the ":=" operator instead of "=" ?`
 *
 * Pine scopes:
 *  - the global scope, and local blocks nested directly inside it
 *    (`if`/`for`/`while` at the top level) share the global binding chain;
 *  - each user function starts a *fresh* binding chain — its parameters and
 *    body locals cannot see global mutable variables, so a parameter named
 *    like a global never triggers this warning;
 *  - inside a function / local block, every nested `if`/`for`/`while` block
 *    opens a child scope that does see the enclosing locals.
 *
 * Re-declaring a name with `=` in a child scope when the same name is bound in
 * a visible ancestor scope shadows it and produces CW10013; the fix is to use
 * `:=` (assignment) when mutation was intended.
 */

import {
    BlockStatement,
    ForStatement,
    FunctionDeclaration,
    IfStatement,
    VariableDeclaration,
    WhileStatement,
} from './ast';

export interface ScopeShadowWarning {
    /** TradingView diagnostic code. */
    readonly code: 'CW10013';
    /** Full TradingView-style message. */
    readonly message: string;
    /** 1-based line:column of the first character of the shadowed name. */
    readonly line: number;
    readonly column: number;
    readonly name: string;
}

type Scope = {
    /** User-visible bindings introduced in this scope. */
    readonly names: Set<string>;
    /**
     * Index in the scope stack below which ancestor lookups must not descend.
     * Function scopes start a new chain (globals are invisible); every other
     * scope keeps the chain root of its parent.
     */
    readonly chainRoot: number;
};

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

function declarationIds(node: any): any[] {
    if (node instanceof VariableDeclaration) {
        return (node.declarations ?? [])
            .map((d: any) => d?.id)
            .filter((id: any) => id?.type === 'Identifier');
    }
    return [];
}

export function collectParentScopeShadowWarnings(ast: any): ScopeShadowWarning[] {
    const warnings: ScopeShadowWarning[] = [];
    const seen = new Set<string>();
    const stack: Scope[] = [];

    const currentScope = (): Scope => stack[stack.length - 1];

    const isDeclaredInVisibleAncestor = (name: string): boolean => {
        const top = currentScope();
        for (let i = stack.length - 2; i >= top.chainRoot; i--) {
            if (stack[i].names.has(name)) return true;
        }
        return false;
    };

    const consider = (id: any): void => {
        if (id?.type !== 'Identifier') return;
        if (!isDeclaredInVisibleAncestor(id.name)) return;
        const pos = positionOf(id);
        if (!pos) return;
        const key = `${pos.line}:${pos.column}:${id.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        warnings.push({
            code: 'CW10013',
            message: `Shadowing variable "${id.name}" which exists in parent scope. Did you want to use the ":=" operator instead of "=" ?`,
            line: pos.line,
            column: pos.column,
            name: id.name,
        });
    };

    /** Visit every statement/expression node in `nodes` within the current scope. */
    const visitNodes = (nodes: any[]): void => {
        for (const node of nodes ?? []) visitNode(node);
    };

    const visitNode = (node: any): void => {
        if (!node || typeof node !== 'object') return;

        if (node instanceof FunctionDeclaration) {
            // Functions start a fresh binding chain: globals are not visible,
            // and the body scope itself holds the parameters.
            const fnScope: Scope = { names: new Set<string>(), chainRoot: stack.length };
            for (const param of node.params ?? []) {
                const id = param?.type === 'AssignmentPattern' ? param.left : param;
                if (id?.type === 'Identifier') fnScope.names.add(id.name);
            }
            stack.push(fnScope);
            visitNodes(node.body?.body ?? []);
            stack.pop();
            return;
        }

        if (node instanceof IfStatement) {
            visitNode(node.test);
            const childScope: Scope = {
                names: new Set<string>(),
                chainRoot: currentScope()?.chainRoot ?? 0,
            };
            stack.push(childScope);
            visitNodes(node.consequent?.body ?? []);
            stack.pop();
            if (node.alternate) {
                // `else` and `else if` get a sibling scope independent of `then`.
                if (node.alternate instanceof IfStatement) {
                    visitNode(node.alternate);
                } else {
                    const elseScope: Scope = {
                        names: new Set<string>(),
                        chainRoot: currentScope()?.chainRoot ?? 0,
                    };
                    stack.push(elseScope);
                    visitNodes(node.alternate?.body ?? []);
                    stack.pop();
                }
            }
            return;
        }

        if (node instanceof ForStatement) {
            const forScope: Scope = {
                names: new Set<string>(),
                chainRoot: currentScope()?.chainRoot ?? 0,
            };
            stack.push(forScope);
            // The loop counter lives in the loop block scope.
            if (node.init instanceof VariableDeclaration) {
                for (const id of declarationIds(node.init)) {
                    consider(id);
                    forScope.names.add(id.name);
                }
            } else if (node.init) {
                visitNode(node.init);
            }
            visitNode(node.test);
            visitNode(node.update);
            visitNodes(node.body?.body ?? []);
            stack.pop();
            return;
        }

        if (node instanceof WhileStatement) {
            visitNode(node.test);
            const whileScope: Scope = {
                names: new Set<string>(),
                chainRoot: currentScope()?.chainRoot ?? 0,
            };
            stack.push(whileScope);
            visitNodes(node.body?.body ?? []);
            stack.pop();
            return;
        }

        // Transparent sequence wrappers (`once`, flattened local statements)
        // belong to the enclosing scope and must not open a new one.
        if (node instanceof BlockStatement) {
            if ((node as any)._sequence === true) {
                visitNodes(node.body ?? []);
                return;
            }
            const blockScope: Scope = {
                names: new Set<string>(),
                chainRoot: currentScope()?.chainRoot ?? 0,
            };
            stack.push(blockScope);
            visitNodes(node.body ?? []);
            stack.pop();
            return;
        }

        if (node instanceof VariableDeclaration) {
            const scope = currentScope();
            for (const id of declarationIds(node)) {
                consider(id);
                scope?.names.add(id.name);
                const init = (node.declarations ?? []).find((d: any) => d?.id === id)?.init;
                if (init) visitNode(init);
            }
            return;
        }

        // Generic traversal for every other node type (expressions, return
        // statements, …): they never introduce scopes or bindings.
        for (const value of Object.values(node) as unknown[]) {
            if (Array.isArray(value)) visitNodes(value as any[]);
            else if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
                visitNode(value);
            }
        }
    };

    const globalScope: Scope = { names: new Set<string>(), chainRoot: 0 };
    stack.push(globalScope);
    visitNodes(ast?.body ?? []);
    stack.pop();

    warnings.sort((a, b) => a.line - b.line || a.column - b.column);
    return warnings;
}

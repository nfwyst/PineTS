// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compile-time error CE10178:
 *   `The script max_labels_count value (<n>) is greater than the maximum
 *    possible value (500)`
 * (and the box / line / polyline equivalents).
 *
 * TradingView hard-caps every drawing-object budget at 500 for labels, lines
 * and boxes (100 for polylines) on both `indicator()` and `strategy()`.
 * Non-literal values (const ints, calculations) cannot be evaluated at compile
 * time and are left alone, matching TradingView which folds only literals.
 */

import { BlockStatement, CallExpression, ExpressionStatement, Identifier, Literal, Program, Property } from './ast';

const DECLARATION_NAMES: ReadonlySet<string> = new Set(['indicator', 'strategy']);

type LimitSpec = {
    readonly property: string;
    readonly max: number;
};

const DRAWING_LIMITS: readonly LimitSpec[] = [
    { property: 'max_labels_count', max: 500 },
    { property: 'max_lines_count', max: 500 },
    { property: 'max_boxes_count', max: 500 },
    { property: 'max_polylines_count', max: 100 },
];

function declarationCalls(statements: readonly any[]): CallExpression[] {
    const calls: CallExpression[] = [];
    for (const statement of statements ?? []) {
        if (statement instanceof BlockStatement && (statement as any)._sequence === true) {
            calls.push(...declarationCalls(statement.body ?? []));
            continue;
        }
        if (
            statement instanceof ExpressionStatement &&
            statement.expression instanceof CallExpression &&
            statement.expression.callee instanceof Identifier &&
            DECLARATION_NAMES.has(statement.expression.callee.name)
        ) {
            calls.push(statement.expression);
        }
    }
    return calls;
}

function namedArgument(call: CallExpression, property: string): { value: any; key: any } | null {
    // Named arguments are lowered to a trailing ObjectExpression of Property
    // nodes by the parser.
    for (const arg of call.arguments ?? []) {
        if (arg?.type !== 'ObjectExpression') continue;
        for (const prop of arg.properties ?? []) {
            if (!(prop instanceof Property)) continue;
            const keyName =
                prop.key?.type === 'Identifier'
                    ? prop.key.name
                    : prop.key?.type === 'Literal'
                      ? String(prop.key.value)
                      : null;
            if (keyName === property) return { value: prop.value, key: prop.key };
        }
    }
    return null;
}

function literalInt(node: any): number | null {
    if (!(node instanceof Literal) || typeof node.value !== 'number' || !Number.isInteger(node.value)) return null;
    return node.value;
}

function positionText(node: any): string {
    if (typeof node?._pos === 'string' && /^\d+:\d+$/.test(node._pos)) return node._pos;
    return 'end of line';
}

/**
 * Throws the TradingView-style CE10178 error when a drawing-object budget on
 * the indicator/strategy declaration exceeds the platform maximum.
 */
export function validateDrawingLimits(ast: Program): void {
    for (const call of declarationCalls(ast.body ?? [])) {
        for (const { property, max } of DRAWING_LIMITS) {
            const arg = namedArgument(call, property);
            if (!arg) continue;
            const value = literalInt(arg.value);
            if (value !== null && value > max) {
                throw new SyntaxError(
                    `The script ${property} value (${value}) is greater than the maximum possible value (${max}) at ${positionText(arg.key)}`,
                );
            }
        }
    }
}

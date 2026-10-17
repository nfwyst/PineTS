// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { resolveColorToRgba } from '../../../namespaces/color/PineColor';
import { arrayField, field } from '../qualifierAnalysisAst';
import { COLOR_LITERAL, dottedName } from './constEval';

/**
 * Minimal Pine type-qualifier inference, used to reject runtime values in
 * input arguments. Only expressions built from known pieces are classified;
 * anything else is `undefined` and never reported, so an incomplete table can
 * only miss an error, not invent one.
 */

export type Qualifier = 'const' | 'input' | 'simple' | 'series';
export type ValueType = 'int' | 'float' | 'bool' | 'string' | 'color';

export interface Qualified {
    qual: Qualifier;
    type: ValueType;
}

export interface QualifierEnv {
    /**
     * Qualified type of a user variable; `null` for a user variable whose type
     * is unknown (it still shadows built-ins); `undefined` when no user
     * variable has that name.
     */
    lookup(name: string): Qualified | null | undefined;
    /** Resolve calls whose qualified return depends on script-level metadata. */
    resolveCall?(name: string, node: unknown): Qualified | undefined;
}

const RANK: Record<Qualifier, number> = { const: 0, input: 1, simple: 2, series: 3 };

const maxQual = (...qs: Qualifier[]): Qualifier => qs.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'const');

const BUILTIN_VARIABLES: Record<string, Qualified> = {};
/**
 * Bare built-in variable names that trigger CW10011 when a user binding
 * shadows them. Qualified names like `timeframe.multiplier` and namespace
 * names (`color`, `line`, …) are excluded. Populated by `define()` below.
 */
export const BUILTIN_VARIABLE_NAMES = new Set<string>();
const define = (qual: Qualifier, type: ValueType, names: string[]) =>
    names.forEach((n) => {
        BUILTIN_VARIABLES[n] = { qual, type };
        if (!n.includes('.')) BUILTIN_VARIABLE_NAMES.add(n);
    });
define('series', 'float', ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'ask', 'bid']);
define('series', 'int', [
    'bar_index',
    'last_bar_index',
    'time',
    'time_close',
    'timenow',
    'year',
    'month',
    'weekofyear',
    'dayofmonth',
    'dayofweek',
    'hour',
    'minute',
    'second',
]);
define('series', 'bool', [
    'barstate.isfirst',
    'barstate.islast',
    'barstate.ishistory',
    'barstate.isrealtime',
    'barstate.isnew',
    'barstate.isconfirmed',
    'barstate.islastconfirmedhistory',
]);
define('simple', 'int', ['timeframe.multiplier']);
define('simple', 'float', ['syminfo.mintick', 'syminfo.pointvalue']);
define('simple', 'string', [
    'timeframe.period',
    'syminfo.ticker',
    'syminfo.tickerid',
    'syminfo.timezone',
    'syminfo.currency',
    'syminfo.type',
    'syminfo.prefix',
    'syminfo.root',
    'syminfo.description',
]);
define('simple', 'bool', [
    'timeframe.isticks',
    'timeframe.isintraday',
    'timeframe.isdaily',
    'timeframe.isweekly',
    'timeframe.ismonthly',
    'timeframe.isdwm',
    'timeframe.isminutes',
    'timeframe.isseconds',
]);

const TA_BOOL = new Set(['cross', 'crossover', 'crossunder', 'rising', 'falling']);
const TA_INT = new Set(['barssince', 'highestbars', 'lowestbars']);
const MATH_INT = new Set(['floor', 'ceil']);
const MATH_SAME = new Set(['abs', 'max', 'min']);

const numType = (...ts: ValueType[]): ValueType => (ts.every((t) => t === 'int') ? 'int' : 'float');
const isNum = (t: ValueType) => t === 'int' || t === 'float';

export function inferQualified(node: any, env: QualifierEnv): Qualified | undefined {
    if (!node) return undefined;
    switch (node.type) {
        case 'Literal':
            if (typeof node.value === 'boolean') return { qual: 'const', type: 'bool' };
            if (typeof node.value === 'string') return { qual: 'const', type: COLOR_LITERAL.test(node.value) ? 'color' : 'string' };
            if (typeof node.value === 'number')
                return { qual: 'const', type: typeof node.raw === 'string' && /[.eE]/.test(node.raw) ? 'float' : 'int' };
            return undefined;
        case 'Identifier': {
            const user = env.lookup(node.name);
            if (user === null) return undefined;
            return user ?? BUILTIN_VARIABLES[node.name];
        }
        case 'MemberExpression': {
            const name = dottedName(node);
            if (name?.startsWith('color.') && resolveColorToRgba(name)) return { qual: 'const', type: 'color' };
            return name ? BUILTIN_VARIABLES[name] : undefined;
        }
        case 'UnaryExpression': {
            const arg = inferQualified(node.argument, env);
            if (!arg) return undefined;
            if (node.operator === '!') return arg.type === 'bool' ? arg : undefined;
            return isNum(arg.type) ? arg : undefined;
        }
        case 'BinaryExpression':
        case 'LogicalExpression': {
            const l = inferQualified(node.left, env);
            const r = inferQualified(node.right, env);
            if (!l || !r) return undefined;
            const qual = maxQual(l.qual, r.qual);
            const op = node.operator;
            if (['&&', '||', '>', '<', '>=', '<=', '==', '!=', '===', '!=='].includes(op)) return { qual, type: 'bool' };
            if (op === '+' && l.type === 'string' && r.type === 'string') return { qual, type: 'string' };
            if (['+', '-', '*', '/', '%'].includes(op) && isNum(l.type) && isNum(r.type)) return { qual, type: numType(l.type, r.type) };
            return undefined;
        }
        case 'ConditionalExpression': {
            const t = inferQualified(node.test, env);
            const a = inferQualified(node.consequent, env);
            const b = inferQualified(node.alternate, env);
            if (!t || !a || !b) return undefined;
            const qual = maxQual(t.qual, a.qual, b.qual);
            if (a.type === b.type) return { qual, type: a.type };
            if (isNum(a.type) && isNum(b.type)) return { qual, type: 'float' };
            return undefined;
        }
        case 'SwitchExpression':
            return inferSwitch(node, env);
        case 'CallExpression':
            return inferCall(node, env);
        default:
            return undefined;
    }
}

function inferSwitch(node: unknown, env: QualifierEnv): Qualified | undefined {
    const operands: Qualified[] = [], values: Qualified[] = [];
    const discriminantNode = field(node, 'discriminant');
    if (discriminantNode) {
        const discriminant = inferQualified(discriminantNode, env);
        if (!discriminant) return undefined;
        operands.push(discriminant);
    }
    for (const switchCase of arrayField(node, 'cases')) {
        const testNode = field(switchCase, 'test');
        if (testNode) {
            const test = inferQualified(testNode, env);
            if (!test) return undefined;
            operands.push(test);
        }
        const value = inferQualified(field(switchCase, 'consequent'), env);
        if (!value) return undefined;
        operands.push(value); values.push(value);
    }
    if (values.length === 0) return undefined;
    const type = values.every((value) => value.type === values[0].type)
        ? values[0].type
        : values.every((value) => isNum(value.type))
          ? 'float'
          : undefined;
    return type ? { qual: maxQual(...operands.map((operand) => operand.qual)), type } : undefined;
}

function inferCall(node: any, env: QualifierEnv): Qualified | undefined {
    const callee = dottedName(node.callee);
    if (!callee) return undefined;
    const resolved = env.resolveCall?.(callee, node);
    if (resolved) return resolved;
    const rawArgs: any[] = (node.arguments ?? []).filter((a: any) => a?.type !== 'ObjectExpression');
    if (
        (callee === 'int' || callee === 'float') &&
        rawArgs.length === 1 &&
        rawArgs[0]?.type === 'Identifier' &&
        rawArgs[0].name === 'na'
    ) {
        return { qual: 'simple', type: callee };
    }

    if (callee.startsWith('ta.')) {
        const fn = callee.slice(3);
        return { qual: 'series', type: TA_BOOL.has(fn) ? 'bool' : TA_INT.has(fn) ? 'int' : 'float' };
    }

    const args = rawArgs.map((a) => inferQualified(a, env));
    if (args.some((a) => !a)) return undefined;
    const qs = args as Qualified[];
    const qual = maxQual(...qs.map((a) => a.qual));

    if (callee === 'timestamp') {
        // timestamp(dateString) folds; the component forms use the chart's timezone → simple.
        if (qs.length === 1 && qs[0].type === 'string') return { qual, type: 'int' };
        if (qs.length >= 3) return { qual: maxQual('simple', qual), type: 'int' };
        return undefined;
    }
    if (callee === 'timeframe.in_seconds') {
        if (qs.length === 0) return { qual: 'simple', type: 'int' };
        return qs.length === 1 && qs[0].type === 'string' ? { qual: maxQual('simple', qs[0].qual), type: 'int' } : undefined;
    }
    if (callee === 'color.new' || callee === 'color.rgb') return { qual, type: 'color' };
    if (callee === 'int' && qs.length === 1 && isNum(qs[0].type)) return { qual, type: 'int' };
    if (callee === 'float' && qs.length === 1 && isNum(qs[0].type)) return { qual, type: 'float' };
    if (callee === 'str.tostring' || callee === 'str.format') return { qual: maxQual('simple', qual), type: 'string' };
    if (callee.startsWith('math.') && qs.length && qs.every((a) => isNum(a.type))) {
        const fn = callee.slice(5);
        if (fn === 'round') return { qual, type: qs.length === 1 ? 'int' : 'float' };
        if (MATH_INT.has(fn)) return { qual, type: 'int' };
        if (MATH_SAME.has(fn)) return { qual, type: numType(...qs.map((a) => a.type)) };
        return { qual, type: 'float' };
    }
    return undefined;
}

const OPERATOR_NAMES: Record<string, string> = { '&&': 'and', '||': 'or', '!': 'not', '===': '==', '!==': '!=' };

/** How TradingView names an argument expression in qualifier errors. */
export function describeArgument(node: any, q: Qualified): string {
    const suffix = `(${q.qual} ${q.type})`;
    switch (node?.type) {
        case 'Identifier':
        case 'MemberExpression':
            return dottedName(node) ?? '';
        case 'CallExpression':
            return `call "${dottedName(node.callee)}" ${suffix}`;
        case 'ConditionalExpression':
            return `call "operator ?:" ${suffix}`;
        case 'BinaryExpression':
        case 'LogicalExpression':
        case 'UnaryExpression':
            return `call "operator ${OPERATOR_NAMES[node.operator] ?? node.operator}" ${suffix}`;
        default:
            return '';
    }
}

/** Source position of the first token of an expression, when the parser recorded it. */
export function startPos(node: any): string | undefined {
    switch (node?.type) {
        case 'Identifier':
        case 'Literal':
        case 'UnaryExpression':
        case 'ArrayExpression':
            return node._pos;
        case 'MemberExpression':
            return startPos(node.object);
        case 'CallExpression':
            return startPos(node.callee);
        case 'BinaryExpression':
        case 'LogicalExpression':
            return startPos(node.left);
        case 'ConditionalExpression':
            return startPos(node.test);
        default:
            return undefined;
    }
}

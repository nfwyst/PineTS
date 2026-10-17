// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { dottedName } from './inputs/constEval';
import { describeArgument, inferQualified, startPos } from './inputs/qualifiers';
import type { Qualified, Qualifier, QualifierEnv, ValueType } from './inputs/qualifiers';
import {
    annotation,
    arrayField,
    bindArguments,
    field,
    identifierName,
    nodeType,
    parameterIdentifier,
    QualifierScope,
    walk,
} from './qualifierAnalysisAst';

type ParameterContract = {
    readonly name: string;
    qualifier: Qualifier;
    type: ValueType | null;
    readonly fixed: boolean;
    constrained: boolean;
};

type FunctionContract = {
    readonly name: string;
    readonly parameters: ParameterContract[];
    readonly body: unknown;
};

type InferenceContext = {
    readonly scope: QualifierScope;
    readonly activeFunctions: ReadonlySet<string>;
};

const QUALIFIER_RANK: Readonly<Record<Qualifier, number>> = { const: 0, input: 1, simple: 2, series: 3 };
const BUILTIN_PARAMETERS: Readonly<Record<string, readonly ParameterContract[]>> = {
    'ta.atr': [{ name: 'length', qualifier: 'simple', type: 'int', fixed: true, constrained: true }],
};
const INPUT_RETURN_TYPES: Readonly<Record<string, ValueType>> = {
    'input.int': 'int',
    'input.float': 'float',
    'input.price': 'float',
    'input.bool': 'bool',
    'input.color': 'color',
    'input.string': 'string',
    'input.text_area': 'string',
    'input.session': 'string',
    'input.symbol': 'string',
    'input.timeframe': 'string',
    'input.time': 'int',
};

function binaryParameterDependencies(
    expression: unknown,
    parameters: ReadonlyMap<string, ParameterContract>,
    aliases: ReadonlyMap<string, ReadonlySet<ParameterContract>> = new Map<string, ReadonlySet<ParameterContract>>(),
): ReadonlySet<ParameterContract> {
    const dependencies = new Set<ParameterContract>();
    const visit = (node: unknown): void => {
        const name = identifierName(node) ?? '';
        const aliasDependencies = aliases.get(name);
        if (aliasDependencies) {
            for (const dependency of aliasDependencies) dependencies.add(dependency);
            return;
        }
        const parameter = parameters.get(name);
        if (parameter) {
            dependencies.add(parameter);
            return;
        }
        if (nodeType(node) !== 'BinaryExpression') return;
        visit(field(node, 'left'));
        visit(field(node, 'right'));
    };
    visit(expression);
    return dependencies;
}

function collectAliasDependencies(
    body: unknown,
    parameters: ReadonlyMap<string, ParameterContract>,
): ReadonlyMap<string, ReadonlySet<ParameterContract>> {
    const aliases = new Map<string, ReadonlySet<ParameterContract>>();
    let changed = true;
    while (changed) {
        changed = false;
        walk(body, (node) => {
            if (nodeType(node) === 'FunctionDeclaration') return 'skip';
            if (nodeType(node) !== 'VariableDeclaration') return;
            for (const declaration of arrayField(node, 'declarations')) {
                const name = identifierName(field(declaration, 'id'));
                if (!name) continue;
                const previous = aliases.get(name) ?? new Set<ParameterContract>();
                const dependencies = new Set(previous);
                for (const dependency of binaryParameterDependencies(field(declaration, 'init'), parameters, aliases)) {
                    dependencies.add(dependency);
                }
                if (dependencies.size === previous.size) continue;
                aliases.set(name, dependencies);
                changed = true;
            }
        });
    }
    return aliases;
}

class CallQualifierAnalyzer {
    private readonly functions = new Map<string, FunctionContract>();

    constructor(private readonly ast: unknown) {}

    run(): void {
        this.collectFunctions();
        this.inferParameterRequirements();
        this.visit(this.ast, new QualifierScope(null));
    }

    private collectFunctions(): void {
        walk(this.ast, (node) => {
            if (nodeType(node) !== 'FunctionDeclaration') return;
            const name = identifierName(field(node, 'id'));
            if (!name) return;
            const parameters = arrayField(node, 'params').flatMap((parameter): ParameterContract[] => {
                const id = parameterIdentifier(parameter);
                const parameterName = identifierName(id);
                if (!parameterName) return [];
                const declared = annotation(id);
                return [{
                    name: parameterName,
                    qualifier: declared.qualifier ?? 'series',
                    type: declared.type ?? null,
                    fixed: declared.qualifier !== undefined,
                    constrained: declared.qualifier !== undefined,
                }];
            });
            this.functions.set(name, { name, parameters, body: field(node, 'body') });
        });
    }

    private inferParameterRequirements(): void {
        let changed = true;
        while (changed) {
            changed = false;
            for (const fn of this.functions.values()) {
                const ownParameters = new Map(fn.parameters.map((parameter) => [parameter.name, parameter]));
                const aliases = collectAliasDependencies(fn.body, ownParameters);
                walk(fn.body, (node) => {
                    if (nodeType(node) === 'FunctionDeclaration') return 'skip';
                    if (nodeType(node) !== 'CallExpression') return;
                    const name = dottedName(field(node, 'callee'));
                    const targets = name ? BUILTIN_PARAMETERS[name] ?? this.functions.get(name)?.parameters : undefined;
                    if (!targets) return;
                    const args = bindArguments(node, targets.map((target) => target.name));
                    targets.forEach((target, index) => {
                        if (!target.constrained || target.qualifier === 'series') return;
                        for (const source of binaryParameterDependencies(args[index], ownParameters, aliases)) {
                            if (source.fixed || (source.type !== null && source.type !== target.type)) continue;
                            if (!source.constrained || QUALIFIER_RANK[target.qualifier] < QUALIFIER_RANK[source.qualifier]) {
                                source.qualifier = target.qualifier;
                                source.type ??= target.type;
                                source.constrained = true;
                                changed = true;
                            }
                        }
                    });
                });
            }
        }
    }

    private env(scope: QualifierScope, activeFunctions: ReadonlySet<string> = new Set()): QualifierEnv {
        return {
            lookup: (name) => scope.lookup(name),
            resolveCall: (name, node) => this.resolveCall(name, node, { scope, activeFunctions }),
        };
    }

    private resolveCall(name: string, node: unknown, context: InferenceContext): Qualified | undefined {
        const { scope, activeFunctions } = context;
        const inputType = INPUT_RETURN_TYPES[name];
        if (inputType) return { qual: 'input', type: inputType };
        if (name === 'input.source') return { qual: 'series', type: 'float' };
        if (name === 'input') {
            const first = arrayField(node, 'arguments')[0];
            const value = inferQualified(first, this.env(scope, activeFunctions));
            return value ? { qual: value.qual === 'series' ? 'series' : 'input', type: value.type } : undefined;
        }

        const fn = this.functions.get(name);
        if (!fn || activeFunctions.has(name)) return undefined;
        const args = bindArguments(node, fn.parameters.map((parameter) => parameter.name));
        const fnScope = new QualifierScope(scope);
        fn.parameters.forEach((parameter, index) => {
            const actual = inferQualified(args[index], this.env(scope, activeFunctions));
            const type = parameter.type ?? actual?.type;
            if (!type) {
                fnScope.set(parameter.name, null);
                return;
            }
            const qual = parameter.type !== null || parameter.constrained ? parameter.qualifier : actual?.qual ?? 'series';
            fnScope.set(parameter.name, { qual, type });
        });

        const nextFunctions = new Set(activeFunctions).add(name);
        const returns: Qualified[] = [];
        walk(fn.body, (candidate) => {
            if (nodeType(candidate) === 'FunctionDeclaration') return 'skip';
            if (nodeType(candidate) !== 'ReturnStatement') return;
            const result = inferQualified(field(candidate, 'argument'), this.env(fnScope, nextFunctions));
            if (result) returns.push(result);
        });
        if (returns.length === 0) return undefined;
        const type = returns.every((result) => result.type === returns[0].type)
            ? returns[0].type
            : returns.every((result) => result.type === 'int' || result.type === 'float')
              ? 'float'
              : undefined;
        if (!type) return undefined;
        return returns.reduce((result, current) =>
            QUALIFIER_RANK[current.qual] > QUALIFIER_RANK[result.qual] ? { qual: current.qual, type } : result,
        { qual: 'const', type });
    }

    private visit(node: unknown, scope: QualifierScope): void {
        if (Array.isArray(node)) {
            node.forEach((child) => this.visit(child, scope));
            return;
        }
        const type = nodeType(node);
        if (!type) return;

        if (type === 'Program') {
            this.visit(arrayField(node, 'body'), scope);
            return;
        }
        if (type === 'BlockStatement') {
            const nested = field(node, '_sequence') === true ? scope : new QualifierScope(scope);
            this.visit(arrayField(node, 'body'), nested);
            return;
        }
        if (type === 'FunctionDeclaration') {
            const name = identifierName(field(node, 'id'));
            const contract = name ? this.functions.get(name) : undefined;
            const fnScope = new QualifierScope(scope);
            contract?.parameters.forEach((parameter) => {
                const proven = parameter.fixed || parameter.constrained;
                fnScope.set(parameter.name, parameter.type && proven ? { qual: parameter.qualifier, type: parameter.type } : null);
            });
            this.visit(field(node, 'body'), fnScope);
            return;
        }
        if (type === 'VariableDeclaration') {
            for (const declaration of arrayField(node, 'declarations')) {
                const init = field(declaration, 'init');
                this.visit(init, scope);
                const id = field(declaration, 'id');
                const name = identifierName(id);
                if (!name) continue;
                const inferred = inferQualified(init, this.env(scope));
                const declared = annotation(declaration);
                const idDeclared = annotation(id);
                const qualifier = declared.qualifier ?? idDeclared.qualifier ?? inferred?.qual;
                const valueType = declared.type ?? idDeclared.type ?? inferred?.type;
                scope.set(name, qualifier && valueType ? { qual: qualifier, type: valueType } : null);
            }
            return;
        }
        if (type === 'CallExpression') this.checkCall(node, scope);

        for (const [key, child] of Object.entries(node)) {
            if (key === 'args' || key === 'parent' || key === 'type' || key.startsWith('_')) continue;
            this.visit(child, scope);
        }
    }

    private checkCall(call: unknown, scope: QualifierScope): void {
        const name = dottedName(field(call, 'callee'));
        const parameters = name ? BUILTIN_PARAMETERS[name] ?? this.functions.get(name)?.parameters : undefined;
        if (!name || !parameters) return;
        const args = bindArguments(call, parameters.map((parameter) => parameter.name));
        parameters.forEach((parameter, index) => {
            const argument = args[index];
            if (!argument || !parameter.type) return;
            const actual = inferQualified(argument, this.env(scope));
            if (!actual || actual.type !== parameter.type || QUALIFIER_RANK[actual.qual] <= QUALIFIER_RANK[parameter.qualifier]) return;
            const description = describeArgument(argument, actual);
            const position = startPos(argument);
            throw new Error(
                `Cannot call "${name}" with argument "${parameter.name}"="${description}". ` +
                    `An argument of "${actual.qual} ${actual.type}" type was used but a "${parameter.qualifier} ${parameter.type}" is expected.` +
                    (position ? ` at ${position}` : ''),
            );
        });
    }
}

export function analyzeCallQualifiers(ast: unknown): void {
    new CallQualifierAnalyzer(ast).run();
}

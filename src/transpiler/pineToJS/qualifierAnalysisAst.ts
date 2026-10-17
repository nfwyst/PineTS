// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import type { Qualified, Qualifier, ValueType } from './inputs/qualifiers';

export function field(value: unknown, name: string): unknown {
    return value !== null && typeof value === 'object' ? Reflect.get(value, name) : undefined;
}

export function nodeType(value: unknown): string | undefined {
    const type = field(value, 'type');
    return typeof type === 'string' ? type : undefined;
}

export function arrayField(value: unknown, name: string): readonly unknown[] {
    const items = field(value, name);
    return Array.isArray(items) ? items : [];
}

export function identifierName(value: unknown): string | undefined {
    const name = field(value, 'name');
    return nodeType(value) === 'Identifier' && typeof name === 'string' ? name : undefined;
}

export function walk(root: unknown, visit: (node: unknown) => 'skip' | void): void {
    const seen = new WeakSet<object>();
    const step = (value: unknown): void => {
        if (Array.isArray(value)) {
            value.forEach(step);
            return;
        }
        if (value === null || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (visit(value) === 'skip') return;
        for (const [key, child] of Object.entries(value)) {
            if (key === 'args' || key === 'parent' || key.startsWith('_')) continue;
            step(child);
        }
    };
    step(root);
}

function isQualifier(value: string): value is Qualifier {
    return value === 'const' || value === 'input' || value === 'simple' || value === 'series';
}

function isValueType(value: string): value is ValueType {
    return value === 'int' || value === 'float' || value === 'bool' || value === 'string' || value === 'color';
}

export function annotation(value: unknown): { readonly qualifier?: Qualifier; readonly type?: ValueType } {
    const raw = field(value, 'varType');
    if (typeof raw !== 'string') return {};
    const words = raw.split(/\s+/);
    const qualifier = words.find(isQualifier);
    const type = [...words].reverse().find(isValueType);
    return { qualifier, type };
}

export function parameterIdentifier(value: unknown): unknown {
    return nodeType(value) === 'AssignmentPattern' ? field(value, 'left') : value;
}

export function bindArguments(call: unknown, names: readonly string[]): readonly (unknown | undefined)[] {
    const args = arrayField(call, 'arguments');
    const last = args.at(-1);
    const named = nodeType(last) === 'ObjectExpression' ? arrayField(last, 'properties') : [];
    const positional = named.length > 0 ? args.slice(0, -1) : args;
    const bound: Array<unknown | undefined> = names.map((_name, index) => positional[index]);
    for (const property of named) {
        const name = identifierName(field(property, 'key'));
        const index = name === undefined ? -1 : names.indexOf(name);
        if (index >= 0) bound[index] = field(property, 'value');
    }
    return bound;
}

export class QualifierScope {
    private readonly values = new Map<string, Qualified | null>();

    constructor(private readonly parent: QualifierScope | null) {}

    set(name: string, value: Qualified | null): void {
        this.values.set(name, value);
    }

    lookup(name: string): Qualified | null | undefined {
        return this.values.has(name) ? this.values.get(name) : this.parent?.lookup(name);
    }
}

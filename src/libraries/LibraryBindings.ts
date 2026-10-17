// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import {
    ASTNode,
    FunctionDeclaration,
    Identifier,
    ImportDeclaration,
    MemberExpression,
    Property,
    type SourceSpan,
    TypeDefinition,
    VariableDeclaration,
} from '../transpiler/pineToJS/ast';

export const LIBRARY_VERSION_SCOPE_MARKER = '$__pinetsVersionScope';
export const LIBRARY_SYMBOL_PREFIX = '$pineLib';

export type LibraryExportBinding = { readonly symbol: string };
export type LinkedLibraryModule = {
    readonly key: string;
    readonly version: number;
    readonly body: ASTNode[];
    readonly exports: ReadonlyMap<string, LibraryExportBinding>;
};
export type LibraryImportBinding = {
    readonly declaration: ImportDeclaration;
    readonly module: LinkedLibraryModule;
    readonly chain: readonly string[];
};

export function formatLibrarySpan(span: SourceSpan | undefined): string {
    if (!span) return '?:?-?:?';
    return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}

function missingExportError(binding: LibraryImportBinding, name: string): SyntaxError {
    const { declaration, module, chain } = binding;
    return new SyntaxError(
        `Library ${module.key} has no export "${name}" for alias "${declaration.alias}" at ${chain[chain.length - 2]}:${formatLibrarySpan(declaration.sourceSpan)} (import chain: ${chain.join(' -> ')})`,
    );
}

export function collectTopLevelNames(statements: readonly ASTNode[]): Set<string> {
    const names = new Set<string>();
    for (const statement of statements) {
        if (statement instanceof FunctionDeclaration && statement.id instanceof Identifier) names.add(statement.id.name);
        else if (statement instanceof TypeDefinition) names.add(statement.name);
        else if (statement instanceof VariableDeclaration) {
            for (const declaration of statement.declarations) {
                if (declaration.id instanceof Identifier) names.add(declaration.id.name);
            }
        }
    }
    return names;
}

function replaceNode(target: object, replacement: ASTNode): void {
    for (const key of Object.keys(target)) Reflect.deleteProperty(target, key);
    Object.assign(target, replacement);
}

function rewriteTypeName(
    typeName: string,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): string {
    return typeName.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/g, (name) => {
        const ownSymbol = symbols.get(name);
        if (ownSymbol) return ownSymbol;
        const separator = name.indexOf('.');
        if (separator < 0) return name;
        const binding = imported.get(name.slice(0, separator));
        if (!binding) return name;
        const exportName = name.slice(separator + 1);
        const exported = binding.module.exports.get(exportName);
        if (!exported) throw missingExportError(binding, exportName);
        return exported.symbol;
    });
}

function rewriteFunction(
    node: FunctionDeclaration,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): void {
    const renamed = symbols.get(node.id.name);
    if (renamed) node.id.name = renamed;
    if (typeof node.returnType === 'string') node.returnType = rewriteTypeName(node.returnType, symbols, imported);
    if (typeof node.id.returnType === 'string') node.id.returnType = rewriteTypeName(node.id.returnType, symbols, imported);
    const bodySymbols = new Map(symbols);
    for (const parameter of node.params) {
        const identifier = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
        if (identifier instanceof Identifier) bodySymbols.delete(identifier.name);
        if (identifier instanceof Identifier && typeof identifier.varType === 'string') {
            identifier.varType = rewriteTypeName(identifier.varType, symbols, imported);
        }
        if (parameter.type === 'AssignmentPattern' && parameter.right instanceof ASTNode) {
            rewriteNode(parameter.right, symbols, imported);
        }
    }
    rewriteNode(node.body, bodySymbols, imported);
}

function rewriteVariableDeclaration(
    node: VariableDeclaration,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): void {
    for (const declaration of node.declarations) {
        if (declaration.id instanceof Identifier) {
            const renamed = symbols.get(declaration.id.name);
            if (renamed) declaration.id.name = renamed;
            if (typeof declaration.id.varType === 'string') {
                declaration.id.varType = rewriteTypeName(declaration.id.varType, symbols, imported);
            }
        }
        if (typeof declaration.varType === 'string') declaration.varType = rewriteTypeName(declaration.varType, symbols, imported);
        if (declaration.init instanceof ASTNode) rewriteNode(declaration.init, symbols, imported);
    }
}

function rewriteTypeDefinition(
    node: TypeDefinition,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): void {
    const renamed = symbols.get(node.name);
    if (renamed) node.name = renamed;
    for (const field of node.fields) {
        if (typeof field.type === 'string') field.type = rewriteTypeName(field.type, symbols, imported);
        if (field.defaultValue instanceof ASTNode) rewriteNode(field.defaultValue, symbols, imported);
    }
}

function rewriteMemberExpression(
    node: MemberExpression,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): void {
    if (node.object instanceof ASTNode) rewriteNode(node.object, symbols, imported);
    if (node.computed && node.property instanceof ASTNode) rewriteNode(node.property, symbols, imported);
    if (!(node.object instanceof Identifier) || !(node.property instanceof Identifier) || node.computed) return;

    const binding = imported.get(node.object.name);
    if (!binding) return;
    const exported = binding.module.exports.get(node.property.name);
    if (!exported) throw missingExportError(binding, node.property.name);
    replaceNode(node, new Identifier(exported.symbol));
}

function rewriteProperty(
    node: Property,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): void {
    if (node.computed && node.key instanceof ASTNode) rewriteNode(node.key, symbols, imported);
    if (node.value instanceof ASTNode) rewriteNode(node.value, symbols, imported);
}

export function rewriteNode(
    node: ASTNode,
    symbols: ReadonlyMap<string, string>,
    imported: ReadonlyMap<string, LibraryImportBinding>,
): void {
    if (node instanceof MemberExpression) {
        rewriteMemberExpression(node, symbols, imported);
        return;
    }

    if (node instanceof Property) {
        rewriteProperty(node, symbols, imported);
        return;
    }

    if (node instanceof Identifier) {
        const renamed = symbols.get(node.name);
        if (renamed) node.name = renamed;
        if (typeof node.varType === 'string') node.varType = rewriteTypeName(node.varType, symbols, imported);
        if (typeof node.returnType === 'string') node.returnType = rewriteTypeName(node.returnType, symbols, imported);
        return;
    }

    if (node instanceof FunctionDeclaration) {
        rewriteFunction(node, symbols, imported);
        return;
    }

    if (node instanceof TypeDefinition) {
        rewriteTypeDefinition(node, symbols, imported);
        return;
    }

    if (node instanceof VariableDeclaration) {
        rewriteVariableDeclaration(node, symbols, imported);
        return;
    }

    for (const [key, value] of Object.entries(node)) {
        if (key === 'sourceSpan' || key === 'type') continue;
        if (value instanceof ASTNode) rewriteNode(value, symbols, imported);
        else if (Array.isArray(value)) {
            for (const entry of value) {
                if (entry instanceof ASTNode) rewriteNode(entry, symbols, imported);
            }
        }
    }
}

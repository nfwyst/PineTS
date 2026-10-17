// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import {
    AssignmentExpression,
    ASTNode,
    BlockStatement,
    CallExpression,
    ExpressionStatement,
    FunctionDeclaration,
    Identifier,
    ImportDeclaration,
    Literal,
    MemberExpression,
    Program,
} from '../transpiler/pineToJS/ast';
import { Lexer } from '../transpiler/pineToJS/lexer';
import { extractPineScriptVersion, generatePineProgram, parsePineProgram } from '../transpiler/pineToJS/pineToJS.index';
import type { ParsedPineProgram } from '../transpiler/pineToJS/pineToJS.index';
import { collectBuiltinShadowWarnings } from '../transpiler/pineToJS/builtinShadowWarnings';
import { collectParentScopeShadowWarnings } from '../transpiler/pineToJS/scopeShadowWarnings';
import type { PineWarning } from '../transpiler/pineToJS/pineToJS.index';
import { validateDrawingLimits } from '../transpiler/pineToJS/drawingLimits';
import { TokenType } from '../transpiler/pineToJS/tokens';
import { analyzeInputs } from '../transpiler/pineToJS/inputs/analyzeInputs';
import { analyzeCallQualifiers } from '../transpiler/pineToJS/analyzeCallQualifiers';
import type { LibraryResolver as ResolveLibrary } from '../types/PineTypes';
import { PINE_VERSION_PROPERTY } from '../transpiler/markers';
import {
    collectTopLevelNames,
    formatLibrarySpan,
    LIBRARY_SYMBOL_PREFIX,
    LIBRARY_VERSION_SCOPE_MARKER,
    type LibraryExportBinding,
    type LibraryImportBinding,
    type LinkedLibraryModule,
    rewriteNode,
} from './LibraryBindings';
import { LibrarySourceResolver, libraryKey } from './LibraryResolver';

export type LinkedPineSource = {
    readonly code: string;
    readonly version: number;
    readonly warnings: readonly PineWarning[];
};

type LinkState = { readonly modules: Map<string, LinkedLibraryModule>; readonly order: LinkedLibraryModule[] };
type LoadContext = { readonly from: string; readonly ancestry: readonly string[]; readonly state: LinkState };

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isDeclarationCall(statement: ASTNode, name: string): statement is ExpressionStatement {
    return statement instanceof ExpressionStatement &&
        statement.expression instanceof CallExpression &&
        statement.expression.callee instanceof Identifier &&
        statement.expression.callee.name === name;
}

function flattenTopLevel(statements: readonly ASTNode[], declarationToRemove?: string): ASTNode[] {
    const result: ASTNode[] = [];
    for (const statement of statements) {
        if (statement instanceof ImportDeclaration || (declarationToRemove && isDeclarationCall(statement, declarationToRemove))) continue;
        if (statement instanceof BlockStatement && Reflect.get(statement, '_sequence') === true) {
            result.push(...flattenTopLevel(statement.body, declarationToRemove));
        } else {
            result.push(statement);
        }
    }
    return result;
}

function libraryDeclarationName(program: Program): string | undefined {
    for (const statement of flattenTopLevel(program.body)) {
        if (!isDeclarationCall(statement, 'library')) continue;
        const title = statement.expression.arguments[0];
        return typeof title?.value === 'string' ? title.value : '';
    }
    return undefined;
}

function parseLibrarySource(source: string, key: string, chain: readonly string[]): ParsedPineProgram {
    let parsed: ParsedPineProgram;
    try {
        parsed = parsePineProgram(source);
    } catch (error) {
        throw new SyntaxError(`Invalid library ${key} (import chain: ${chain.join(' -> ')}): ${errorText(error)}`);
    }
    if (libraryDeclarationName(parsed.ast) === undefined) {
        throw new SyntaxError(`Resolved source for ${key} must declare library() (import chain: ${chain.join(' -> ')})`);
    }
    return parsed;
}

function versionScopeMarker(version: number): ExpressionStatement {
    return new ExpressionStatement(
        new CallExpression(new Identifier(LIBRARY_VERSION_SCOPE_MARKER), [new Literal(version)]),
    );
}

function propertyAssignment(object: string, property: string, value: number): ExpressionStatement {
    return new ExpressionStatement(
        new AssignmentExpression(
            '=',
            new MemberExpression(new Identifier(object), new Identifier(property)),
            new Literal(value),
        ),
    );
}

function versionedModuleBody(module: LinkedLibraryModule): ASTNode[] {
    const body: ASTNode[] = [versionScopeMarker(module.version), propertyAssignment('$', 'pineVersion', module.version)];
    for (const statement of module.body) {
        if (statement instanceof FunctionDeclaration && statement.id instanceof Identifier) {
            body.push(propertyAssignment(statement.id.name, PINE_VERSION_PROPERTY, module.version));
        }
        body.push(statement);
    }
    return body;
}

export class LibraryGraph {
    private readonly sources: LibrarySourceResolver;
    private readonly moduleIds = new Map<string, number>();

    constructor(resolveLibrary: ResolveLibrary | undefined) {
        this.sources = new LibrarySourceResolver(resolveLibrary);
    }

    public hasImports(source: Function | string): source is string {
        if (typeof source !== 'string' || extractPineScriptVersion(source) === null) return false;
        return new Lexer(source).tokenize().some((token) => token.type === TokenType.KEYWORD && token.value === 'import' && token.indent === 0);
    }

    public async link(source: string): Promise<LinkedPineSource> {
        const root = parsePineProgram(source);
        analyzeInputs(root.ast, { version: root.version });
        const state: LinkState = { modules: new Map(), order: [] };
        const imports = await this.loadImports(root.ast.imports, { from: '<main>', ancestry: ['<main>'], state });
        const rootBody = flattenTopLevel(root.ast.body);
        for (const statement of rootBody) rewriteNode(statement, new Map(), imports);
        const libraryBody = state.order.flatMap(versionedModuleBody);
        const linked = new Program([
            ...libraryBody,
            versionScopeMarker(root.version),
            propertyAssignment('$', 'pineVersion', root.version),
            ...rootBody,
        ]);
        analyzeCallQualifiers(linked);
        validateDrawingLimits(linked);
        const warnings: PineWarning[] = [
            ...collectBuiltinShadowWarnings(linked),
            ...collectParentScopeShadowWarnings(linked),
        ];
        return { code: generatePineProgram(linked, source), version: root.version, warnings };
    }

    private async loadImports(imports: readonly ImportDeclaration[], context: LoadContext): Promise<Map<string, LibraryImportBinding>> {
        const bindings = new Map<string, LibraryImportBinding>();
        for (const declaration of imports) {
            const module = await this.loadModule(declaration, context);
            bindings.set(declaration.alias, { declaration, module, chain: [...context.ancestry, module.key] });
        }
        return bindings;
    }

    private async loadModule(declaration: ImportDeclaration, context: LoadContext): Promise<LinkedLibraryModule> {
        const key = libraryKey(declaration);
        if (context.ancestry.includes(key)) {
            throw new SyntaxError(
                `Library import cycle at ${context.from}:${formatLibrarySpan(declaration.sourceSpan)}: ${[...context.ancestry, key].join(' -> ')}`,
            );
        }
        const cached = context.state.modules.get(key);
        if (cached) return cached;

        if (!this.sources.configured) {
            throw new SyntaxError(
                `Library resolver is not configured for ${key} imported as "${declaration.alias}" at ${context.from}:${formatLibrarySpan(declaration.sourceSpan)} (import chain: ${[...context.ancestry, key].join(' -> ')})`,
            );
        }
        const source = await this.sources.resolve(declaration, context.from);
        if (source === undefined) {
            throw new SyntaxError(
                `Library ${key} imported as "${declaration.alias}" at ${context.from}:${formatLibrarySpan(declaration.sourceSpan)} could not be resolved (import chain: ${[...context.ancestry, key].join(' -> ')})`,
            );
        }

        const parsed = parseLibrarySource(source, key, [...context.ancestry, key]);
        const program = parsed.ast;

        const childImports = await this.loadImports(program.imports, {
            from: key,
            ancestry: [...context.ancestry, key],
            state: context.state,
        });
        const body = flattenTopLevel(program.body, 'library');
        const prefix = `${LIBRARY_SYMBOL_PREFIX}${this.moduleId(key)}$`;
        const symbols = new Map([...collectTopLevelNames(body)].map((name) => [name, `${prefix}${name}`]));
        for (const statement of body) rewriteNode(statement, symbols, childImports);
        analyzeInputs(new Program(body), { version: parsed.version, idPrefix: prefix });

        const exports = new Map<string, LibraryExportBinding>();
        for (const descriptor of program.exports) {
            const symbol = symbols.get(descriptor.name);
            if (!symbol) {
                throw new SyntaxError(
                    `Library ${key} declares export "${descriptor.name}" without a matching binding at ${formatLibrarySpan(descriptor.sourceSpan)}`,
                );
            }
            exports.set(descriptor.name, { symbol });
        }
        const linked = { key, version: parsed.version, body, exports } satisfies LinkedLibraryModule;
        context.state.modules.set(key, linked);
        context.state.order.push(linked);
        return linked;
    }

    private moduleId(key: string): number {
        const known = this.moduleIds.get(key);
        if (known !== undefined) return known;
        const id = this.moduleIds.size;
        this.moduleIds.set(key, id);
        return id;
    }
}

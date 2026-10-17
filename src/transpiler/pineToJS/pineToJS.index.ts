// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// PineScript to JavaScript Converter
// Converts PineScript files to JavaScript using the parser and code generator

import { Lexer } from './lexer';
import { Parser } from './parser';
import { CodeGenerator } from './codegen';
import { analyzeInputs } from './inputs/analyzeInputs';
import { analyzeCallQualifiers } from './analyzeCallQualifiers';
import { collectBuiltinShadowWarnings, type PineWarning as BuiltinShadowWarning } from './builtinShadowWarnings';
import { collectParentScopeShadowWarnings, type ScopeShadowWarning } from './scopeShadowWarnings';
import { validateDrawingLimits } from './drawingLimits';
import { BlockStatement, CallExpression, ExpressionStatement, Identifier, type ASTNode, type Program } from './ast';

export type PineToJSOptions = {
    readonly indentStr?: string;
    readonly includeSourceComments?: boolean;
};

export type ParsedPineProgram = {
    readonly version: number;
    readonly ast: Program;
    readonly tokens: ReturnType<Lexer['tokenize']>;
};

const PINE_DECLARATION_NAMES: ReadonlySet<string> = new Set(['indicator', 'strategy', 'library']);
const PINE_DECLARATION_ERROR = 'Only one study can be in a script';

export type PineWarning = BuiltinShadowWarning | ScopeShadowWarning;

function countTopLevelDeclarations(statements: readonly ASTNode[]): number {
    return statements.reduce((count, statement) => {
        if (statement instanceof BlockStatement && '_sequence' in statement && statement._sequence === true) {
            return count + countTopLevelDeclarations(statement.body);
        }
        if (!(statement instanceof ExpressionStatement) || !(statement.expression instanceof CallExpression)) return count;
        const { callee } = statement.expression;
        return callee instanceof Identifier && PINE_DECLARATION_NAMES.has(callee.name) ? count + 1 : count;
    }, 0);
}

function validatePineDeclaration(ast: Program): void {
    if (countTopLevelDeclarations(ast.body) !== 1) {
        throw new SyntaxError(PINE_DECLARATION_ERROR);
    }
}

export function parsePineProgram(sourceCode: string): ParsedPineProgram {
    const version = extractPineScriptVersion(sourceCode);
    if (version === null) {
        throw new SyntaxError('Pine Script version not found. Please add //@version=X comment to your script.');
    }
    if (version < 5) {
        throw new SyntaxError(`Pine Script version ${version} is not supported. Only version 5 and above are supported.`);
    }

    const tokens = new Lexer(sourceCode).tokenize();
    const ast = new Parser(tokens).parse();
    validatePineDeclaration(ast);
    return { version, ast, tokens };
}

export function generatePineProgram(ast: Program, sourceCode: string, options: PineToJSOptions = {}): string {
    const codegen = new CodeGenerator({ ...options, sourceCode });
    return codegen.generate(ast);
}

/**
 * Extract Pine Script version from source code
 * Looks for //@version=X comment on its own line (can be anywhere in the file)
 * The line must start with // and contain only @version=X (with optional whitespace)
 * Returns the version number or null if not found
 */
export function extractPineScriptVersion(sourceCode: string): number | null {
    // Match //@version=X where:
    // - Line starts with optional whitespace, then //
    // - Followed by optional whitespace, then @version
    // - Then = with optional whitespace around it
    // - Then the version number
    // - Then optional whitespace until end of line
    // - Nothing else allowed on the line
    const versionRegex = /^\s*\/\/\s*@version\s*=\s*(\d+)\s*$/im;
    const match = sourceCode.match(versionRegex);

    if (match && match[1]) {
        return parseInt(match[1], 10);
    }

    return null;
}

export function pineToJS(sourceCode: string, options: PineToJSOptions = {}) {
    // Step 0: Detect Pine Script version
    const version = extractPineScriptVersion(sourceCode);
    if (version === null) {
        return {
            success: false,
            version: null,
            error: 'Pine Script version not found. Please add //@version=X comment to your script.',
        };
    }
    // Check if version is supported (must be 5 or above)
    if (version < 5) {
        return {
            success: false,
            version: version,
            error: `Pine Script version ${version} is not supported. Only version 5 and above are supported.`,
        };
    }

    try {
        const { ast, tokens } = parsePineProgram(sourceCode);

        // CE10178: drawing-object budgets (max_labels_count etc.) are capped.
        validateDrawingLimits(ast);

        // Compile-time warnings (non-blocking):
        //  - CW10011: shadowing a Pine built-in variable;
        //  - CW10013: declaring a name in a nested scope that already exists in
        //    a visible parent scope (use := when mutation was intended).
        const warnings: PineWarning[] = [
            ...collectBuiltinShadowWarnings(ast),
            ...collectParentScopeShadowWarnings(ast),
        ];

        // Step 2b: Declare inputs (ids, labels, compile-time folded arguments)
        const inputs = analyzeInputs(ast, { version });

        // Step 2c: Enforce the bounded qualifier contracts known at compile time.
        analyzeCallQualifiers(ast);

        // Step 3: Generate JavaScript (pass source code for comments)
        const jsCode = generatePineProgram(ast, sourceCode, options);

        return {
            success: true,
            version: version,
            code: jsCode,
            ast: ast,
            tokens: tokens,
            inputs,
            warnings,
        };
    } catch (error) {
        return {
            success: false,
            version,
            error: error.message,
            stack: error.stack,
        };
    }
}

import { describe, expect, it } from 'vitest';
import { Lexer } from '../../src/transpiler/pineToJS/lexer';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { TokenType } from '../../src/transpiler/pineToJS/tokens';

function parseSuccessfully(source: string) {
    const result = pineToJS(source);
    expect(result).toMatchObject({ success: true, version: 6 });
    if (!result.success || !result.ast || !result.code) {
        throw new TypeError(result.error ?? 'Pine source did not produce an AST and code');
    }
    return result;
}

function expectParseError(statement: string, expectedError: string): void {
    const result = pineToJS(`//@version=6
indicator("invalid import")
${statement}
plot(close)
`);

    expect(result).toMatchObject({ success: false, version: 6, error: expectedError });
    expect(result).not.toHaveProperty('ast');
    expect(result).not.toHaveProperty('code');
}

describe('Pine library grammar', () => {
    it('tokenizes import path separators and keywords without consuming division globally', () => {
        const tokens = new Lexer('import alice/Geometry/3 as geo\n').tokenize();
        const syntax = tokens
            .filter((token) => token.type !== TokenType.NEWLINE && token.type !== TokenType.EOF)
            .map((token) => [token.type, token.value]);

        expect(syntax).toEqual([
            [TokenType.KEYWORD, 'import'],
            [TokenType.IDENTIFIER, 'alice'],
            [TokenType.OPERATOR, '/'],
            [TokenType.IDENTIFIER, 'Geometry'],
            [TokenType.OPERATOR, '/'],
            [TokenType.NUMBER, 3],
            [TokenType.KEYWORD, 'as'],
            [TokenType.IDENTIFIER, 'geo'],
        ]);
    });

    it('parses a valid versioned import with an exact source span', () => {
        const { ast, code } = parseSuccessfully(`//@version=6
indicator("imports")
import alice/Geometry/3 as geo
plot(close)
`);

        expect(ast.imports).toMatchObject([
            {
                type: 'ImportDeclaration',
                user: 'alice',
                name: 'Geometry',
                version: 3,
                alias: 'geo',
                sourceSpan: {
                    start: { line: 3, column: 1 },
                    end: { line: 3, column: 31 },
                },
            },
        ]);
        expect(ast.body).toContain(ast.imports[0]);
        expect(code).not.toContain('import alice/Geometry/3');
    });

    it('models valid nested imports and all supported library export kinds', () => {
        const { ast, code } = parseSuccessfully(`//@version=6
library("Geometry")
import alice/Base/1 as base
export type Point
    base.Point origin
export enum Direction
    up = "Up"
    down
export const float SCALE = 2.0
export base.Point identity(base.Point value) =>
    value
`);

        expect(ast.imports).toHaveLength(1);
        expect(ast.imports[0]).toMatchObject({ user: 'alice', name: 'Base', version: 1, alias: 'base' });
        expect(ast.exports).toMatchObject([
            { kind: 'type', name: 'Point', sourceSpan: { start: { line: 4, column: 1 }, end: { line: 5, column: 22 } } },
            { kind: 'enum', name: 'Direction', sourceSpan: { start: { line: 6, column: 1 }, end: { line: 8, column: 9 } } },
            { kind: 'const', name: 'SCALE', sourceSpan: { start: { line: 9, column: 1 }, end: { line: 9, column: 31 } } },
            { kind: 'function', name: 'identity', sourceSpan: { start: { line: 10, column: 1 }, end: { line: 11, column: 10 } } },
        ]);
        expect(ast.body.filter((node) => node.exported)).toHaveLength(4);
        expect(code).toContain("const Point = Type({ origin: 'base.Point' });");
        expect(code).toContain('function identity(value)');
        expect(code).not.toMatch(/^\s*(?:import|export)\b/m);
        expect(() => new Function(code)).not.toThrow();
    });

    it('keeps two versions isolated by alias and preserves alias-qualified types', () => {
        const { ast, code } = parseSuccessfully(`//@version=6
indicator("two versions")
import alice/Geometry/1 as oldGeo
import alice/Geometry/2 as newGeo
oldGeo.Point oldPoint = na
array<newGeo.Point> newPoints = na
oldGeo.Point passthrough(oldGeo.Point value) => value
scaled = oldGeo.twice(1.0) * newGeo.SCALE
side = oldGeo.Direction.up
plot(na(oldPoint) ? 0 : scaled)
`);

        expect(ast.imports.map(({ user, name, version, alias }) => ({ user, name, version, alias }))).toEqual([
            { user: 'alice', name: 'Geometry', version: 1, alias: 'oldGeo' },
            { user: 'alice', name: 'Geometry', version: 2, alias: 'newGeo' },
        ]);
        expect(code).toContain('"__pineTypedVar:oldPoint=oldGeo.Point"');
        expect(code).toContain('"__pineTypedVar:newPoints=array<newGeo.Point>"');
        expect(code).toContain('passthrough.__pineParamTypes__ = {"value": "oldGeo.Point"}');
        expect(code).toContain('oldGeo.twice(1.0) * newGeo.SCALE');
        expect(code).toContain('oldGeo.Direction.up');
        const exportedFunction = ast.body.find((node) => node.type === 'FunctionDeclaration');
        expect(exportedFunction?.id.returnType).toBe('oldGeo.Point');
    });

    it.each([
        ['invalid path', 'import alice/3/4 as geo', 'Invalid library import: expected library name at 3:14'],
        ['invalid version', 'import alice/Geometry/latest as geo', 'Invalid library version at 3:23: expected a positive integer'],
        ['missing alias', 'import alice/Geometry/3', 'Library import alias is required after version at 3:24'],
    ])('rejects %s before module resolution', (_name, statement, expectedError) => {
        expectParseError(statement, expectedError);
    });

    it('rejects a duplicate import alias before module resolution', () => {
        const result = pineToJS(`//@version=6
indicator("duplicate alias")
import alice/Geometry/1 as geo
import bob/Shapes/2 as geo
plot(close)
`);

        expect(result).toMatchObject({
            success: false,
            version: 6,
            error: 'Duplicate library import alias "geo" at 4:24',
        });
        expect(result).not.toHaveProperty('ast');
        expect(result).not.toHaveProperty('code');
    });

    it('rejects a non-const exported variable', () => {
        const result = pineToJS(`//@version=6
library("invalid export")
export float value = 1.0
`);

        expect(result).toMatchObject({
            success: false,
            version: 6,
            error: 'Library variable exports must use const at 3:8',
        });
    });
});

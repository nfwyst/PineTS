import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { prepareDeclarations } from '../../scripts/prepare-declarations.js';

describe('published declaration imports', () => {
    it('supports ESM and CommonJS consumers of dotted filenames, directory exports and import types', () => {
        const directory = mkdtempSync(join(tmpdir(), 'pinets-declarations-'));
        try {
            mkdirSync(join(directory, 'nested'));
            writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
            writeFileSync(join(directory, 'model.class.d.ts'), 'export interface Model { value: number }');
            writeFileSync(join(directory, 'nested/index.d.ts'), 'export declare const count: number;');
            writeFileSync(join(directory, 'index.d.ts'), `import type { Model } from './model.class';
export { count } from './nested';
export declare const model: Model;
export declare function read(): import('./model.class').Model;
export type Literal = './model.class';`);
            const consumer = join(directory, 'consumer.mts');
            writeFileSync(consumer, `import { count, model, read, type Literal } from './index.js';
const value: number = count + model.value + read().value;
const literal: Literal = './model.class';`);
            const commonjsConsumer = join(directory, 'consumer.cts');
            writeFileSync(commonjsConsumer, `import { count, model, read, type Literal } from './cjs/index.js';
const value: number = count + model.value + read().value;
const literal: Literal = './model.class';`);

            prepareDeclarations(directory);

            const program = ts.createProgram([consumer, commonjsConsumer], {
                noEmit: true,
                strict: true,
                types: [],
                module: ts.ModuleKind.Node16,
                moduleResolution: ts.ModuleResolutionKind.Node16,
                target: ts.ScriptTarget.ESNext,
            });
            expect(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
                ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            )).toEqual([]);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

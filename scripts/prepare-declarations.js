// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export function prepareDeclarations(directory) {
    const commonjsDirectory = resolve(directory, 'cjs');
    const paths = [...new Bun.Glob('**/*.d.ts').scanSync({ cwd: directory, absolute: true })]
        .filter((path) => !path.startsWith(commonjsDirectory + sep));
    for (const path of paths) {
        const text = readFileSync(path, 'utf8');
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        const edits = [];
        const visit = (node) => {
            if (ts.isStringLiteral(node) && node.text.startsWith('.')) {
                const parent = node.parent;
                const isModule = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
                    && parent.moduleSpecifier === node;
                const isImportType = ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent);
                if ((isModule || isImportType) && !/\.(?:[cm]?js|json)$/.test(node.text)) {
                    const target = resolve(dirname(path), node.text);
                    const suffix = existsSync(`${target}.d.ts`) ? '.js'
                        : existsSync(resolve(target, 'index.d.ts')) ? '/index.js' : undefined;
                    if (suffix === undefined) throw new Error(`Unresolved declaration import ${node.text} in ${path}`);
                    edits.push({ start: node.getStart(source) + 1, end: node.end - 1, value: node.text + suffix });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        const output = edits.toSorted((left, right) => right.start - left.start)
            .reduce((current, edit) => current.slice(0, edit.start) + edit.value + current.slice(edit.end), text);
        if (output !== text) writeFileSync(path, output);
        const commonjsPath = resolve(commonjsDirectory, relative(directory, path));
        mkdirSync(dirname(commonjsPath), { recursive: true });
        writeFileSync(commonjsPath, output);
    }
    mkdirSync(commonjsDirectory, { recursive: true });
    writeFileSync(resolve(commonjsDirectory, 'package.json'), '{"type":"commonjs"}\n');
}

if (import.meta.main) prepareDeclarations(resolve(process.argv[2] ?? 'dist/types'));

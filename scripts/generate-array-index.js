// SPDX-License-Identifier: AGPL-3.0-only
import { readdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const arrayDir = join(__dirname, '../src/namespaces/array');
const gettersDir = join(arrayDir, 'getters');
const methodsDir = join(arrayDir, 'methods');
const indexFile = join(arrayDir, 'array.index.ts');
const objectFile = join(arrayDir, 'PineArrayObject.ts');

async function generateIndex() {
    try {
        // Read getters directory (if it exists)
        let getters = [];
        try {
            const getterFiles = (await readdir(gettersDir)).sort();
            getters = getterFiles.filter((f) => f.endsWith('.ts') && f !== 'array.index.ts' && f !== 'index.ts').map((f) => f.replace('.ts', ''));
        } catch (error) {
            // Getters directory doesn't exist, that's fine
            getters = [];
        }

        // Read methods directory
        const methodFiles = (await readdir(methodsDir)).sort();
        const methods = methodFiles
            .filter((f) => f.endsWith('.ts'))
            .map((f) => {
                const name = f.replace('.ts', '');
                // Handle 'new' which is a reserved keyword - file is named 'new.ts' but exports as 'new_fn'
                return name === 'new' ? { file: name, export: 'new_fn', classProp: 'new' } : { file: name, export: name, classProp: name };
            });

        const staticMethods = ['new', 'new_bool', 'new_box', 'new_color', 'new_float', 'new_int', 'new_label', 'new_line', 'new_linefill', 'new_string', 'new_table', 'from', '__from_int', 'param'];

        // --- Generate PineArrayObject.ts ---
        const objectMethods = methods.filter((m) => !staticMethods.includes(m.classProp));

        const objectMethodDefs = objectMethods
            .map((m) => {
                return `    ${m.classProp}(...args: any[]) {
        return this.context.pine.array.${m.classProp}(this, ...args);
    }`;
            })
            .join('\n\n');

        const pineArrayTypeEnum = `export enum PineArrayType {
    any = '',
    box = 'box',
    bool = 'bool',
    color = 'color',
    float = 'float',
    int = 'int',
    label = 'label',
    line = 'line',
    linefill = 'linefill',
    string = 'string',
    table = 'table',
}`;

        const objectClassCode = `// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:array-index

import { tostringElements } from './format';

${pineArrayTypeEnum}

export class PineArrayObject {
    constructor(public array: any, public type: PineArrayType, public context: any) {}

    // Element count for JavaScript callers (PineTS syntax: \`line.all.length\`); Pine uses size().
    get length(): number {
        return this.array.length;
    }

    toString(): string {
        return '[' + tostringElements(this).join(', ') + ']';
    }

    [Symbol.iterator]() {
        return this.array[Symbol.iterator]();
    }

${objectMethodDefs}
}
`;
        await writeFile(objectFile, objectClassCode, 'utf-8');
        console.log(`✅ Generated ${objectFile}`);

        // --- Generate array.index.ts ---

        // Generate imports
        const getterImports = getters.length > 0 ? getters.map((name) => `import { ${name} } from './getters/${name}';`).join('\n') : '';

        // Imports for index file
        let indexImports = `export { PineArrayObject } from './PineArrayObject';\n\nimport { PineArrayObject } from './PineArrayObject';`;

        const methodImports = methods
            .map((m) => `import { ${m.export} } from './methods/${m.file}';`)
            .join('\n');

        indexImports += '\n' + methodImports;

        // Generate getters object (for type definitions mostly, or we just inline)
        const getterInstall =
            getters.length > 0
                ? `    // Install getters
    const getters = {
${getters.map((g) => `      ${g}: ${g}`).join(',\n')}
    };
    Object.entries(getters).forEach(([name, factory]) => {
      Object.defineProperty(this, name, {
        get: factory(context),
        enumerable: true
      });
    });`
                : '';

        // Generate methods installation
        const methodInstall = methods
            .map((m) => `    this.${m.classProp} = ${m.export}(context);`)
            .join('\n');

        const classCode = `// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:array-index

${indexImports}
${getterImports ? getterImports + '\n' : ''}
export class PineArray {
  [key: string]: any;

  constructor(private context: any) {
${getterInstall}
    // Install methods
${methodInstall}
  }
}

export default PineArray;
`;

        await writeFile(indexFile, classCode, 'utf-8');
        console.log(`✅ Generated ${indexFile}`);
        if (getters.length > 0) {
            console.log(`   - ${getters.length} getters: ${getters.join(', ')}`);
        }
        console.log(`   - ${methods.length} methods: ${methods.map((m) => m.classProp).join(', ')}`);
    } catch (error) {
        console.error('Error generating Array index:', error);
        process.exit(1);
    }
}

generateIndex();

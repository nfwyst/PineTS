// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateTest } from './gen-test.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('compatibility test generation', () => {
    it('generates numeric plot assertions through the shared normalizer', async () => {
        // Given
        const directory = mkdtempSync(join(tmpdir(), 'pinets-generator-'));
        temporaryDirectories.push(directory);
        const indicatorPath = join(directory, 'sample.pine.ts');
        const testPath = join(directory, 'sample.test.ts');
        writeFileSync(
            indicatorPath,
            `(context) => {
    const { close } = context.data;
    const { plot, plotchar } = context.pine;
    plotchar(close, '_plotchar');
    plot(close, '_plot');
    return { close };
};`,
        );

        // When
        await generateTest(indicatorPath, testPath);
        const generated = readFileSync(testPath, 'utf8');

        // Then
        expect(generated).toContain("import { normalizePlotString } from '");
        expect(generated).toContain('normalizePlotString(plotchar_data_str)');
        expect(generated).toContain('normalizePlotString(plot_data_str)');
    });
});

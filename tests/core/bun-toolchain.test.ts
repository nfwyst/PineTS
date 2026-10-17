// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = new URL('../../', import.meta.url);
const AUTOMATION_FILES = [
    '.github/workflows/ci.yaml',
    '.github/workflows/release.yaml',
    'scripts/release-nfwyst.nu',
    'scripts/bench-ta.mjs',
    'tests/compatibility/expect-gen.ts',
    'tests/compatibility/gen-test.ts',
    'tests/compatibility/gen-all-tests.ts',
] as const;
const manifest: unknown = JSON.parse(readFileSync(new URL('package.json', PROJECT_ROOT), 'utf8'));

if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('package.json must contain an object');
}

describe('Bun-only development toolchain', () => {
    it('runs the test process with Bun', () => {
        // Given / When
        const bunVersion = Reflect.get(process.versions, 'bun');

        // Then
        expect(bunVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('declares Bun and uses no Node or npm executors in package scripts', () => {
        // Given
        const packageManager = Reflect.get(manifest, 'packageManager');
        const scripts = Reflect.get(manifest, 'scripts');

        // When
        const commands = scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts)
            ? Object.values(scripts).filter((value): value is string => typeof value === 'string')
            : [];
        const legacyCommands = commands.filter((command) => /\b(?:node|npm|npx|tsx)\b/.test(command));

        // Then
        expect(packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
        expect(legacyCommands).toEqual([]);
    });

    it('uses bun.lock as the only package-manager lockfile', () => {
        // Given / When
        const hasBunLock = existsSync(new URL('bun.lock', PROJECT_ROOT));
        const hasNpmLock = existsSync(new URL('package-lock.json', PROJECT_ROOT));

        // Then
        expect(hasBunLock).toBe(true);
        expect(hasNpmLock).toBe(false);
    });

    it('keeps CI, release, benchmark and helper executors Bun-only', () => {
        // Given / When
        const legacyExecutors = AUTOMATION_FILES.filter((path) => {
            const source = readFileSync(new URL(path, PROJECT_ROOT), 'utf8');
            return /(?:["'](?:node|npm|npx|tsx)["']|actions\/setup-node|#!\/usr\/bin\/env tsx|\b(?:npm|npx|tsx)\s)/.test(source);
        });

        // Then
        expect(legacyExecutors).toEqual([]);
    });
});

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const isOfflineSuite = process.env.PINETS_OFFLINE_TESTS === 'true';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: [
            'node_modules',
            ...(isOfflineSuite ? [
                'tests/core/livestream.test.ts',
                'tests/namespaces/request-streaming.test.ts',
            ] : []),
        ],
        setupFiles: isOfflineSuite ? ['./tests/offline-setup.ts'] : [],
        coverage: {
            reporter: ['text', 'text-summary', 'html', 'json-summary'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['node_modules'],
        },
    },

    build: {
        sourcemap: true,
    },
});

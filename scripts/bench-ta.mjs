// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const WARMUP_COUNT = 1;
const ITERATION_COUNT = 6;
const FIXTURE_URL = new URL('../tests/namespaces/ta/data/ta-coverage-btcusdt.json', import.meta.url);
const SELF_TEST_FIXTURE_URL = new URL('../tests/namespaces/ta/data/local-block-btcusdt.json', import.meta.url);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), '..');

const BENCHMARKS = Object.freeze([
    { name: 'sma', body: 'plot(ta.sma(close, 200), "value")' },
    { name: 'ema', body: 'plot(ta.ema(close, 200), "value")' },
    { name: 'wma', body: 'plot(ta.wma(close, 200), "value")' },
    { name: 'highest', body: 'plot(ta.highest(high, 200), "value")' },
    { name: 'lowest', body: 'plot(ta.lowest(low, 200), "value")' },
    { name: 'stdev', body: 'plot(ta.stdev(close, 200), "value")' },
    { name: 'bb', body: '[basis, upper, lower] = ta.bb(close, 200, 2)\nplot(upper, "value")' },
    { name: 'rsi', body: 'plot(ta.rsi(close, 200), "value")' },
    { name: 'atr', body: 'plot(ta.atr(200), "value")' },
    { name: 'hma', body: 'plot(ta.hma(close, 200), "value")' },
    { name: 'cci', body: 'plot(ta.cci(hlc3, 200), "value")' },
]);

class BenchmarkError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'BenchmarkError';
        this.code = code;
        this.details = details;
    }
}

function fixture(url) {
    return JSON.parse(readFileSync(url, 'utf8'));
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function gitSha() {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
    if (result.status !== 0) throw new BenchmarkError('git_sha_failed', result.stderr.trim() || 'git rev-parse failed');
    return result.stdout.trim();
}

function environment() {
    const cpu = cpus()[0];
    return {
        bun: Bun.version,
        bunRevision: Bun.revision,
        platform: platform(),
        release: release(),
        arch: arch(),
        cpuModel: cpu?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        timezone: 'UTC',
    };
}

function quantile(sorted, fraction) {
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[index];
}

function median(sorted) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function runSample(name) {
    const benchmark = BENCHMARKS.find((candidate) => candidate.name === name);
    if (benchmark === undefined) throw new BenchmarkError('unknown_function', `Unknown TA benchmark: ${name}`);
    const data = fixture(FIXTURE_URL);
    const { PineTS } = await import('../src/PineTS.class.ts');
    const source = `//@version=6\nindicator("TA #237 ${name}")\n${benchmark.body}`;
    const startedAt = performance.now();
    const context = await new PineTS(data.candles, 'BINANCE:BTCUSDT', '60').run(source);
    const durationMs = performance.now() - startedAt;
    const values = context.plots.value?.data.map((point) => point.value) ?? [];
    if (values.length !== data.candles.length) {
        throw new BenchmarkError('sample_length_mismatch', `${name} emitted ${values.length} values for ${data.candles.length} candles`);
    }
    return {
        durationMs,
        peakMemoryBytes: process.resourceUsage().maxRSS * 1_024,
        outputSha256: sha256(JSON.stringify(values)),
    };
}

function workerSample(name) {
    const child = spawnSync(process.execPath, [SCRIPT_PATH, '--worker', name], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, TZ: 'UTC' },
        maxBuffer: 1_048_576,
    });
    if (child.status !== 0) {
        throw new BenchmarkError('worker_failed', child.stderr.trim() || child.stdout.trim(), { function: name, status: child.status });
    }
    return JSON.parse(child.stdout);
}

function benchmarkFunction(name) {
    const warmupSamples = Array.from({ length: WARMUP_COUNT }, () => workerSample(name));
    const rawSamples = Array.from({ length: ITERATION_COUNT }, () => workerSample(name));
    const checksums = new Set([...warmupSamples, ...rawSamples].map((sample) => sample.outputSha256));
    if (checksums.size !== 1) throw new BenchmarkError('nondeterministic_output', `${name} produced inconsistent output`, { function: name });
    const durations = rawSamples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    return {
        warmupSamples,
        rawSamples,
        medianMs: median(durations),
        p95Ms: quantile(durations, 0.95),
        peakMemoryBytes: Math.max(...rawSamples.map((sample) => sample.peakMemoryBytes)),
        outputSha256: rawSamples[0].outputSha256,
    };
}

function firstParityMismatch(expected, actual) {
    for (let index = 0; index < expected.length; index += 1) {
        const want = expected[index];
        const got = actual[index];
        const bothNa = want === null && (got === undefined || Number.isNaN(got));
        const close = want !== null && got !== undefined && !Number.isNaN(got) && Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want));
        if (!bothNa && !close) return { index, expected: want, actual: got };
    }
    return null;
}

async function selfTest() {
    const data = fixture(SELF_TEST_FIXTURE_URL);
    const probe = data.probes.local;
    const { PineTS } = await import('../src/PineTS.class.ts');
    const context = await new PineTS(data.candles, 'BINANCE:BTCUSDT', '60').run(probe.script);
    const expected = probe.tv.sma;
    const actual = context.plots.sma.data.slice(data.checkFrom).map((point) => point.value);
    const precondition = firstParityMismatch(expected, actual);
    if (precondition !== null) throw new BenchmarkError('sentinel_precondition_failed', 'SMA parity was already broken before sentinel injection', precondition);
    const sentinelIndex = expected.findIndex((value) => value !== null);
    if (sentinelIndex < 0) throw new BenchmarkError('sentinel_target_missing', 'SMA fixture has no numeric sentinel target');
    const injected = [...actual];
    injected[sentinelIndex] += Math.max(1, Math.abs(injected[sentinelIndex])) * 0.01;
    const detected = firstParityMismatch(expected, injected);
    if (detected === null) throw new BenchmarkError('sentinel_escaped', 'Injected parity sentinel was not detected');
    return {
        schemaVersion: 1,
        status: 'fail',
        mode: 'self-test',
        headSha: gitSha(),
        check: 'tradingview-parity',
        function: 'sma',
        plot: 'sma',
        injected: true,
        message: 'Injected TradingView parity sentinel detected',
        mismatch: detected,
    };
}

async function main() {
    process.env.TZ = 'UTC';
    const args = process.argv.slice(2);
    const workerIndex = args.indexOf('--worker');
    if (workerIndex >= 0) {
        const name = args[workerIndex + 1];
        if (name === undefined) throw new BenchmarkError('worker_name_missing', '--worker requires a function name');
        process.stdout.write(JSON.stringify(await runSample(name)));
        return;
    }
    if (args.includes('--self-test')) {
        process.stdout.write(`${JSON.stringify(await selfTest(), null, 2)}\n`);
        process.exitCode = 1;
        return;
    }
    const rawFixture = readFileSync(FIXTURE_URL);
    const functions = Object.fromEntries(BENCHMARKS.map(({ name }) => [name, benchmarkFunction(name)]));
    const report = {
        schemaVersion: 1,
        status: 'pass',
        benchmark: 'ta-237-baseline',
        headSha: gitSha(),
        environment: environment(),
        fixture: {
            path: 'tests/namespaces/ta/data/ta-coverage-btcusdt.json',
            sha256: sha256(rawFixture),
            symbol: 'BINANCE:BTCUSDT',
            timeframe: '1h',
            candleCount: fixture(FIXTURE_URL).candles.length,
        },
        warmupCount: WARMUP_COUNT,
        iterationCount: ITERATION_COUNT,
        functions,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
    // no-excuse-ok: catch -- CLI boundary converts typed and unexpected failures to machine-readable output.
    const known = error instanceof BenchmarkError;
    const report = {
        schemaVersion: 1,
        status: 'error',
        code: known ? error.code : 'unexpected_error',
        message: error instanceof Error ? error.message : String(error),
        details: known ? error.details : {},
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
});

// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '../../../src/marketData/Provider.class';
import type { Kline } from '../../../src/marketData/types';
import localBlock from './data/local-block-btcusdt.json';
import taContexts from './data/ta-contexts-btcusdt.json';
import taCoverage from './data/ta-coverage-btcusdt.json';
import syntheticSources from './data/tv-synthetic-sources.json';
import variableLength from './data/varlen-btcusdt.json';

type Candle = {
    readonly openTime: number;
    readonly closeTime: number;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume: number;
};

type Probe = {
    readonly script: string;
    readonly tv: Readonly<Record<string, readonly (number | null)[]>>;
};

type PlotMap = Readonly<Record<string, { readonly data: readonly { readonly value: number }[] }>>;

const TA_FUNCTIONS = ['sma', 'ema', 'wma', 'highest', 'lowest', 'stdev', 'bb', 'rsi', 'atr', 'hma', 'cci'] as const;
const REQUIRED_SCENARIOS = ['steady', 'conditional', 'sparse', 'dynamic-length', 'na-continuity', 'late-init', 'same-bar-rollback', 'gaps'] as const;

const ROLLBACK_SCRIPT = `//@version=6
indicator("TA rollback oracle")
plot(ta.sma(close, 20), "sma")
plot(ta.ema(close, 20), "ema")
plot(ta.wma(close, 20), "wma")
plot(ta.highest(high, 20), "highest")
plot(ta.lowest(low, 20), "lowest")
plot(ta.stdev(close, 20), "stdev")
[bbBasis, bbUpper, bbLower] = ta.bb(close, 20, 2)
plot(bbUpper, "bb")
plot(ta.rsi(close, 14), "rsi")
plot(ta.atr(14), "atr")
plot(ta.hma(close, 20), "hma")
plot(ta.cci(hlc3, 20), "cci")`;

const syntheticCandles = (times: readonly number[]): Candle[] =>
    times.map((time) => ({
        openTime: time * 1_000,
        closeTime: time * 1_000 + 3_599_999,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
    }));

const parityCases = [
    {
        title: 'conditional windows with na sources and gaps',
        candles: localBlock.candles,
        checkFrom: localBlock.checkFrom,
        probe: localBlock.probes.local,
        plots: ['sma', 'highest', 'stdev'],
        functions: ['sma', 'highest', 'stdev'],
        scenarios: ['conditional', 'gaps'],
    },
    {
        title: 'sparse EMA and RSI calls',
        candles: taContexts.candles,
        checkFrom: taContexts.checkFrom,
        probe: taContexts.probes.ctxTernary,
        plots: ['ema t', 'rsi t'],
        functions: ['ema', 'rsi'],
        scenarios: ['conditional', 'sparse'],
    },
    {
        title: 'conditional Bollinger Bands',
        candles: taCoverage.candles,
        checkFrom: taCoverage.checkFrom,
        probe: taCoverage.probes.covWinT,
        plots: ['bbu t'],
        functions: ['bb'],
        scenarios: ['conditional'],
    },
    {
        title: 'steady ATR',
        candles: taCoverage.candles,
        checkFrom: taCoverage.checkFrom,
        probe: taCoverage.probes.covTop,
        plots: ['atr'],
        functions: ['atr'],
        scenarios: ['steady'],
    },
    {
        title: 'dynamic SMA and WMA lengths',
        candles: variableLength.candles,
        checkFrom: variableLength.checkFrom,
        probe: variableLength.probes.vlAvg,
        plots: ['sma l1', 'wma l1'],
        functions: ['sma', 'wma'],
        scenarios: ['dynamic-length'],
    },
    {
        title: 'dynamic highest and lowest lengths',
        candles: variableLength.candles,
        checkFrom: variableLength.checkFrom,
        probe: variableLength.probes.vlExt,
        plots: ['highest l1', 'lowest l1', 'highest cl1', 'highest cl3', 'lowest cl1', 'lowest cl3'],
        functions: ['highest', 'lowest'],
        scenarios: ['dynamic-length'],
    },
    {
        title: 'dynamic stdev, BB, and CCI lengths',
        candles: variableLength.candles,
        checkFrom: variableLength.checkFrom,
        probe: variableLength.probes.vlAvg2,
        plots: ['stdev l1', 'bbmid l1', 'cci l1'],
        functions: ['stdev', 'bb', 'cci'],
        scenarios: ['dynamic-length'],
    },
    {
        title: 'EMA and HMA na continuity',
        candles: taCoverage.candles,
        checkFrom: taCoverage.checkFrom,
        probe: taCoverage.probes.covNa,
        plots: ['ema g', 'hma r'],
        functions: ['ema', 'hma'],
        scenarios: ['na-continuity'],
    },
    {
        title: 'late initialization after irregular gaps',
        candles: syntheticCandles(syntheticSources.probes.labPosCr.times),
        checkFrom: syntheticSources.probes.labPosCr.checkFrom,
        probe: syntheticSources.probes.labPosCr,
        plots: ['sma ifs', 'hi ifs', 'lo ifs'],
        functions: ['sma', 'highest', 'lowest'],
        scenarios: ['late-init', 'gaps'],
    },
] as const;

function mismatchReport(plots: PlotMap, probe: Probe, names: readonly string[], checkFrom: number): string[] {
    const mismatches: string[] = [];
    for (const name of names) {
        const actual = plots[name]?.data.slice(checkFrom).map((point) => point.value) ?? [];
        const expected = probe.tv[name] ?? [];
        expected.forEach((want, index) => {
            const got = actual[index];
            const bothNa = want === null && (got === undefined || Number.isNaN(got));
            const close = want !== null && got !== undefined && !Number.isNaN(got) && Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want));
            if (!bothNa && !close) mismatches.push(`${name} bar ${checkFrom + index}: TradingView=${want}, PineTS=${got}`);
        });
    }
    return mismatches.slice(0, 20);
}

function plotValues(plots: PlotMap, name: string): readonly number[] {
    return plots[name]?.data.map((point) => point.value) ?? [];
}

describe('TA #237 parity and performance oracle', () => {
    it('records executable TradingView provenance and the complete scenario matrix', () => {
        const btcFixtures = [localBlock, taContexts, taCoverage, variableLength];
        for (const fixture of btcFixtures) {
            expect(fixture.source).toMatch(/BINANCE:BTCUSDT 1h.*TradingView/);
            expect(fixture.candles.length - fixture.checkFrom).toBe(60);
            for (const probe of Object.values(fixture.probes)) expect(probe.script).toMatch(/^\/\/@version=6\nindicator\(/);
        }
        expect(syntheticSources.source).toMatch(/TradingView.*BINANCE:BTCUSDT 1h/);
        for (const probe of Object.values(syntheticSources.probes)) {
            expect(probe.script).toMatch(/^\/\/@version=6\nindicator\(/);
            expect(probe.times.length - probe.checkFrom).toBeGreaterThan(0);
        }

        expect([...new Set(parityCases.flatMap((testCase) => testCase.functions))].sort()).toEqual([...TA_FUNCTIONS].sort());
        const coveredScenarios = [...parityCases.flatMap((testCase) => testCase.scenarios), 'same-bar-rollback'];
        expect([...new Set(coveredScenarios)].sort()).toEqual([...REQUIRED_SCENARIOS].sort());
    });

    it.each(parityCases)('$title matches captured TradingView values', async ({ candles, checkFrom, probe, plots: names }) => {
        // Given committed candles and outputs captured from the script stored in the fixture.
        const pine = new PineTS(candles, 'BINANCE:BTCUSDT', '60');

        // When the unchanged runtime executes that exact Pine v6 script.
        const { plots } = await pine.run(probe.script);

        // Then every selected output matches TradingView, including its na positions.
        expect(mismatchReport(plots, probe, names, checkFrom)).toEqual([]);
    });

    it('restores all 11 TA states before a same-bar replacement', async () => {
        // Given a provisional final tick followed by the committed fixture candle.
        const committed: Kline[] = taCoverage.candles.slice(0, 400).map((bar) => ({
            ...bar,
            quoteAssetVolume: 0,
            numberOfTrades: 0,
            takerBuyBaseAssetVolume: 0,
            takerBuyQuoteAssetVolume: 0,
            ignore: 0,
        }));
        const finalBar = committed.at(-1);
        if (finalBar === undefined) throw new TypeError('TA rollback fixture must contain a final candle');
        const provisional = { ...finalBar, high: finalBar.high + 100, close: finalBar.close + 75 };
        const initial = [...committed.slice(0, -1), provisional];
        let requestCount = 0;
        const provider = {
            getMarketData: async () => {
                requestCount += 1;
                return requestCount === 1 ? initial : [finalBar];
            },
            getSymbolInfo: (tickerId: string) => Provider.Mock.getSymbolInfo(tickerId),
            configure: (): void => {},
        };
        const livePine = new PineTS(provider, 'BTCUSDT', '60');
        const live = await livePine.run(ROLLBACK_SCRIPT);

        // When updateTail replaces that tick and a clean instance replays the same committed candles.
        expect(await livePine.updateTail(live)).toBe(true);
        const replay = await new PineTS(committed, 'BTCUSDT', '60').run(ROLLBACK_SCRIPT);

        // Then rollback leaves every requested TA series exactly equal to the clean replay.
        for (const name of TA_FUNCTIONS) expect(plotValues(live.plots, name)).toEqual(plotValues(replay.plots, name));
    });
});

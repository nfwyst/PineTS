// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { aggregateCandles } from '../../src/marketData/aggregation';
import { MockProvider } from '../../src/marketData/Mock/MockProvider.class';
import type { Context } from '../../src/Context.class';
import type { Kline } from '../../src/marketData/types';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NY_OVERNIGHT = '1700-1700:23456';

// TradingView: higher-than-daily time_tradingday uses the bar's final session.
// https://www.tradingview.com/pine-script-docs/concepts/time/#time_tradingday

const utc = (iso: string): number => Date.parse(iso);

function candle(openTime: number, duration = HOUR_MS): Kline {
    return {
        openTime,
        closeTime: openTime + duration,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

function consecutiveBars(start: number, count: number, duration = HOUR_MS): Kline[] {
    return Array.from({ length: count }, (_, index) => candle(start + index * duration, duration));
}

const SESSION_BARS = [
    ...consecutiveBars(utc('2026-03-05T22:00:00Z'), 24),
    ...consecutiveBars(utc('2026-03-08T21:00:00Z'), 24),
    ...consecutiveBars(utc('2026-03-09T21:00:00Z'), 24),
];

class SessionProvider extends MockProvider {
    constructor(
        private readonly bars: Kline[],
        private readonly sessionValue: string,
        private readonly sessionExtended?: string,
    ) {
        super();
    }

    override async getMarketData(): Promise<Kline[]> {
        return this.bars;
    }

    override async getSymbolInfo(tickerId: string) {
        const base = await super.getSymbolInfo('BTCUSDT');
        return {
            ...base,
            ticker: tickerId,
            tickerid: tickerId,
            timezone: 'America/New_York',
            session: this.sessionValue,
            ...(this.sessionExtended === undefined ? {} : { session_extended: this.sessionExtended }),
        };
    }
}

class StreamingSessionProvider extends SessionProvider {
    private updateCount = 0;

    constructor(
        private readonly initialBar: Kline,
        private readonly appendedBar: Kline,
    ) {
        super([initialBar], '0930-1600:23456', '0400-2000:23456');
    }

    override async getMarketData(
        _tickerId?: string,
        _timeframe?: string,
        _limit?: number,
        startDate?: number,
    ): Promise<Kline[]> {
        if (startDate === undefined) return [this.initialBar];
        return this.updateCount++ === 0 ? [this.appendedBar] : [];
    }
}

function plotAt(context: Context, title: string, timestamp: number): number {
    return context.plots[title].data.find((point: { readonly time: number }) => point.time === timestamp)?.value;
}

describe('calendar-bar trading day', () => {
    it.each([
        ['W', '2026-03-08T21:00:00Z', '2026-03-13T21:00:00Z', '2026-03-13T00:00:00Z'],
        ['M', '2026-03-01T22:00:00Z', '2026-03-31T21:00:00Z', '2026-03-31T00:00:00Z'],
        ['2D', '2025-12-31T22:00:00Z', '2026-01-02T22:00:00Z', '2026-01-02T00:00:00Z'],
    ])('uses the final session trading day for %s bars', async (timeframe, open, close, expected) => {
        const provider = new SessionProvider([candle(utc(open), utc(close) - utc(open))], NY_OVERNIGHT);
        const pine = new PineTS(provider, 'TEST', timeframe);

        const context = await pine.run('//@version=6\nindicator("final trading day")\nplot(time_tradingday, "td")');

        expect(context.plots.td.data.map((point) => point.value)).toEqual([utc(expected)]);
    });
});

interface NormalizedCloseTimeContext {
    readonly normalizedCloseTime: readonly number[];
}

function hasNormalizedCloseTime(context: object): context is NormalizedCloseTimeContext {
    return 'normalizedCloseTime' in context && Array.isArray(context.normalizedCloseTime);
}

describe('shared exchange-session grid', () => {
    it('aligns time, time_close, timeframe.change, time_tradingday, and D/W/M aggregation across New York DST', async () => {
        const provider = new SessionProvider(SESSION_BARS, NY_OVERNIGHT);
        const context = await new PineTS(provider, 'TEST', '60').run(`//@version=6
indicator("session grid")
plot(time("240"), "h4o")
plot(time_close("240"), "h4c")
plot(time("D"), "do")
plot(time_close("D"), "dc")
plot(time("W"), "wo")
plot(time_close("W"), "wc")
plot(time("M"), "mo")
plot(time_close("M"), "mc")
plot(timeframe.change("240") ? 1 : 0, "ch4")
plot(timeframe.change("D") ? 1 : 0, "cd")
plot(timeframe.change("W") ? 1 : 0, "cw")
plot(timeframe.change("M") ? 1 : 0, "cm")
plot(time_tradingday, "td")
`);
        const sundayEvening = utc('2026-03-08T21:00:00Z');
        const sundayNight = utc('2026-03-09T02:00:00Z');
        const mondayEvening = utc('2026-03-09T21:00:00Z');

        expect(plotAt(context, 'do', sundayEvening)).toBe(sundayEvening);
        expect(plotAt(context, 'dc', sundayEvening)).toBe(mondayEvening);
        expect(plotAt(context, 'h4o', sundayNight)).toBe(utc('2026-03-09T01:00:00Z'));
        expect(plotAt(context, 'h4c', sundayNight)).toBe(utc('2026-03-09T05:00:00Z'));
        expect(plotAt(context, 'td', sundayNight)).toBe(utc('2026-03-09T00:00:00Z'));
        expect(plotAt(context, 'wo', sundayEvening)).toBe(sundayEvening);
        expect(plotAt(context, 'wc', sundayEvening)).toBe(utc('2026-03-13T21:00:00Z'));
        expect(plotAt(context, 'mo', sundayEvening)).toBe(utc('2026-03-01T22:00:00Z'));
        expect(plotAt(context, 'mc', sundayEvening)).toBe(utc('2026-03-31T21:00:00Z'));
        expect([plotAt(context, 'ch4', sundayEvening), plotAt(context, 'cd', sundayEvening), plotAt(context, 'cw', sundayEvening)]).toEqual([1, 1, 1]);
        expect([plotAt(context, 'ch4', mondayEvening), plotAt(context, 'cd', mondayEvening), plotAt(context, 'cw', mondayEvening)]).toEqual([1, 1, 0]);
        expect(plotAt(context, 'cm', sundayEvening)).toBe(0);

        const options = { calendarGrid: true, session: NY_OVERNIGHT, timezone: 'America/New_York' };
        expect(aggregateCandles(SESSION_BARS, 'D', '60', options).map(({ openTime, closeTime }) => [openTime, closeTime])).toEqual([
            [utc('2026-03-05T22:00:00Z'), utc('2026-03-06T22:00:00Z')],
            [utc('2026-03-08T21:00:00Z'), utc('2026-03-09T21:00:00Z')],
            [utc('2026-03-09T21:00:00Z'), utc('2026-03-10T21:00:00Z')],
        ]);
        expect(aggregateCandles(SESSION_BARS, 'W', '60', options).map(({ openTime, closeTime }) => [openTime, closeTime])).toEqual([
            [utc('2026-03-01T22:00:00Z'), utc('2026-03-06T22:00:00Z')],
            [utc('2026-03-08T21:00:00Z'), utc('2026-03-13T21:00:00Z')],
        ]);
        expect(aggregateCandles(SESSION_BARS, 'M', '60', options)[0]).toMatchObject({
            openTime: utc('2026-03-01T22:00:00Z'),
            closeTime: utc('2026-03-31T21:00:00Z'),
        });
        expect(hasNormalizedCloseTime(context)).toBe(true);
        if (hasNormalizedCloseTime(context)) expect(context.normalizedCloseTime).toHaveLength(SESSION_BARS.length);
    });

    it('pins PR 400 higher-timeframe closes and keeps 24/7 UTC unchanged', async () => {
        const firstOpen = utc('2026-10-08T22:00:00Z');
        const bars = consecutiveBars(firstOpen, 72, 5 * MINUTE_MS);
        const futures = new SessionProvider(bars, '0930-1600', '1800-1700');
        const source = `//@version=6\nindicator("PR400")\nplot(time("240"), "o4")\nplot(time_close("240"), "c4")\nplot(time("D"), "od")\nplot(time_close("D"), "cd")`;
        const session = await new PineTS(futures, 'TEST', '5').run(source);
        const target = utc('2026-10-09T03:40:00Z');
        expect([plotAt(session, 'o4', target), plotAt(session, 'c4', target), plotAt(session, 'od', target), plotAt(session, 'cd', target)]).toEqual([
            utc('2026-10-09T02:00:00Z'), utc('2026-10-09T06:00:00Z'), firstOpen, utc('2026-10-09T21:00:00Z'),
        ]);

        const crypto = await new PineTS(bars, 'BTCUSD', '5').run(source);
        expect([plotAt(crypto, 'o4', target), plotAt(crypto, 'c4', target), plotAt(crypto, 'od', target), plotAt(crypto, 'cd', target)]).toEqual([
            utc('2026-10-09T00:00:00Z'), utc('2026-10-09T04:00:00Z'), utc('2026-10-09T00:00:00Z'), utc('2026-10-10T00:00:00Z'),
        ]);
    });

    it('exposes a complete normalized close-time view without overwriting explicit provider closes', async () => {
        const bars = consecutiveBars(utc('2026-03-08T21:00:00Z'), 3);
        Reflect.deleteProperty(bars[0], 'closeTime');
        bars[1].closeTime = bars[1].openTime + 30 * MINUTE_MS;
        Reflect.deleteProperty(bars[2], 'closeTime');
        const context = await new PineTS(new SessionProvider(bars, NY_OVERNIGHT), 'TEST', '60').run(
            `//@version=6\nindicator("normalized closes")\nplot(time_close, "c")`,
        );

        expect(hasNormalizedCloseTime(context)).toBe(true);
        if (!hasNormalizedCloseTime(context)) return;
        expect(context.normalizedCloseTime).toEqual([
            bars[0].openTime + HOUR_MS,
            bars[1].openTime + 30 * MINUTE_MS,
            bars[2].openTime + HOUR_MS,
        ]);
    });

    it('reselects the extended-session grid when streaming appends an extended-hours bar', async () => {
        const regularBar = candle(utc('2024-01-02T15:00:00Z'));
        const extendedBar = candle(utc('2024-01-02T22:00:00Z'));
        const pine = new PineTS(new StreamingSessionProvider(regularBar, extendedBar), 'TEST', '60');
        const context = await pine.run(`//@version=6
indicator("streaming session grid")
plot(time("60"), "time")`);

        expect(await pine.updateTail(context)).toBe(true);
        expect(context.plots.time.data.map((point: { readonly value: number }) => point.value)).toEqual([
            regularBar.openTime,
            extendedBar.openTime,
        ]);
    });

    it('supports bars_back and timeframe_bars_back history and future grid bounds', async () => {
        const bars = consecutiveBars(utc('2026-01-01T00:00:00Z'), 5001);
        const context = await new PineTS(bars, 'BTCUSD', '60').run(`//@version=6
indicator("offsets")
plot(time("60", 5000), "past5000")
plot(time("60", -1), "future1")
plot(time_close("60", -500), "future500Close")
plot(time("60", 5001), "tooOld")
plot(time("60", -501), "tooFuture")
plot(time("240", "24x7", "UTC", 0, 1), "targetPast")
plot(time_close("240", "24x7", "UTC", 0, -1), "targetFutureClose")
`);
        const lastOpen = bars.at(-1)?.openTime ?? NaN;
        const last = (title: string) => context.plots[title].data.at(-1)?.value;

        expect(last('past5000')).toBe(bars[0].openTime);
        expect(last('future1')).toBe(lastOpen + HOUR_MS);
        expect(last('future500Close')).toBe(lastOpen + 501 * HOUR_MS);
        expect(last('tooOld')).toBeNaN();
        expect(last('tooFuture')).toBeNaN();
        expect(last('targetPast')).toBe(lastOpen - 4 * HOUR_MS);
        expect(last('targetFutureClose')).toBe(lastOpen + 8 * HOUR_MS);
    });

    it('handles comma segments, a shortened session tail, and explicit holiday exclusion', async () => {
        const tailBars = consecutiveBars(utc('2026-03-08T22:00:00Z'), 23);
        const tail = await new PineTS(new SessionProvider(tailBars, '1800-1700:23456'), 'TEST', '60').run(
            `//@version=6\nindicator("tail")\nplot(time("240"), "o")\nplot(time_close("240"), "c")`,
        );
        const tailProbe = utc('2026-03-09T18:00:00Z');
        expect([plotAt(tail, 'o', tailProbe), plotAt(tail, 'c', tailProbe)]).toEqual([tailProbe, utc('2026-03-09T21:00:00Z')]);

        const segmentBars = [
            ...consecutiveBars(utc('2026-07-06T13:30:00Z'), 4, 30 * MINUTE_MS),
            ...consecutiveBars(utc('2026-07-06T17:00:00Z'), 6, 30 * MINUTE_MS),
        ];
        const segmentOptions = { calendarGrid: true, session: '0930-1130,1300-1600:23456', timezone: 'America/New_York' };
        expect(aggregateCandles(segmentBars, '240', '30', segmentOptions).map(({ openTime, closeTime }) => [openTime, closeTime])).toEqual([
            [utc('2026-07-06T13:30:00Z'), utc('2026-07-06T15:30:00Z')],
            [utc('2026-07-06T17:00:00Z'), utc('2026-07-06T20:00:00Z')],
        ]);

        const holidayBars = consecutiveBars(utc('2026-07-02T21:00:00Z'), 24);
        const holiday = await new PineTS(new SessionProvider(holidayBars, NY_OVERNIGHT), 'TEST', '60').run(
            `//@version=6\nindicator("no holiday calendar")\nplot(time("D"), "o")\nplot(time_close("D"), "c")`,
        );
        expect([plotAt(holiday, 'o', holidayBars[0].openTime), plotAt(holiday, 'c', holidayBars[0].openTime)]).toEqual([
            utc('2026-07-02T21:00:00Z'), utc('2026-07-03T21:00:00Z'),
        ]);
    });

    it('keeps a session ending at midnight on the trading day that follows its start', async () => {
        // Given: the Monday session starts Sunday at 17:00 New York time and ends Monday at midnight.
        const openTime = utc('2026-03-08T22:00:00Z');
        const bars = [candle(openTime)];
        const provider = new SessionProvider(bars, '1700-0000:2');

        // When: both the runtime and public aggregation helper resolve that Sunday-evening bar.
        const context = await new PineTS(provider, 'TEST', '60').run(
            `//@version=6\nindicator("midnight session")\nplot(time("60"), "open")\nplot(time_close("60"), "close")`,
        );
        const aggregated = aggregateCandles(bars, '60', '60', {
            session: '1700-0000:2',
            timezone: 'America/New_York',
        });

        // Then: the bar stays in the Monday trading session instead of becoming na or being dropped.
        expect([plotAt(context, 'open', openTime), plotAt(context, 'close', openTime)]).toEqual([
            openTime,
            openTime + HOUR_MS,
        ]);
        expect(aggregated.map(({ openTime: start, closeTime: end }) => [start, end])).toEqual([
            [openTime, openTime + HOUR_MS],
        ]);
    });
});

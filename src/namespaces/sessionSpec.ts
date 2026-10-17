// SPDX-License-Identifier: AGPL-3.0-only

import type { ParsedTimeframe } from '../timeframe';

/**
 * Pine Script session-string parsing and matching.
 *
 * Session string syntax (see TradingView docs, "Sessions"):
 *
 *     <time_period>[,<time_period>...][:<days>]
 *
 * - <time_period> is "HHmm-HHmm" in 24-hour exchange time. Multiple
 *   comma-separated periods describe a session with breaks.
 * - <days> is a set of digits 1-7 (1 = Sunday ... 7 = Saturday). When
 *   omitted, the session applies to all days ("1234567").
 * - "24x7" is a special string equivalent to "0000-0000:1234567".
 * - An end time of "0000" means end-of-day midnight, so "0000-0000" is a
 *   full 24-hour session on each applicable day.
 * - When the start time is at or after the end time the session spans
 *   midnight; per TradingView, such an overnight session belongs to the
 *   day it ENDS on (e.g. "1700-1700:2" starts Sunday 17:00 and ends
 *   Monday 17:00 — the Monday trading day).
 */

interface SessionWindow {
    /** Minutes from midnight, inclusive. */
    start: number;
    /** Minutes from midnight, exclusive. End-of-day midnight is 1440. */
    end: number;
}

type ZonedDateParts = Readonly<{ year: number; month: number; day: number; hour: number; minute: number }>;

export type SessionGrid = Readonly<{ spec: SessionSpec; timezone: string }>;

/** A grid bar plus midnight UTC of its exchange-local trading-day label. */
export type SessionBar = Readonly<{ start: number; end: number; tradingDay: number }>;

export interface SessionSpec {
    windows: SessionWindow[];
    /** Pine day numbers the session applies to: 1 = Sunday ... 7 = Saturday. */
    days: Set<number>;
}

const WINDOW_RE = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/;

/**
 * Parse a Pine session string. Returns null when the string is malformed
 * (callers decide whether that is a runtime error).
 */
export function parseSessionSpec(spec: string): SessionSpec | null {
    if (typeof spec !== 'string') return null;
    const trimmed = spec.trim();
    if (!trimmed) return null;

    if (trimmed === '24x7') {
        return { windows: [{ start: 0, end: 1440 }], days: new Set([1, 2, 3, 4, 5, 6, 7]) };
    }

    const colonParts = trimmed.split(':');
    if (colonParts.length > 2) return null;

    const days = new Set<number>();
    if (colonParts.length === 2) {
        if (!/^[1-7]+$/.test(colonParts[1])) return null;
        for (const digit of colonParts[1]) days.add(parseInt(digit, 10));
    } else {
        for (let d = 1; d <= 7; d++) days.add(d);
    }

    const windows: SessionWindow[] = [];
    for (const period of colonParts[0].split(',')) {
        const match = period.match(WINDOW_RE);
        if (!match) return null;

        const startHour = parseInt(match[1], 10);
        const startMin = parseInt(match[2], 10);
        const endHour = parseInt(match[3], 10);
        const endMin = parseInt(match[4], 10);
        if (startHour > 23 || startMin > 59 || endHour > 23 || endMin > 59) return null;

        const start = startHour * 60 + startMin;
        // Only 0000-0000 uses 24:00 to represent a full day. For any later
        // start, an end of 0000 must stay 0 so the window remains overnight.
        const end = endHour === 0 && endMin === 0 && start === 0 ? 1440 : endHour * 60 + endMin;
        windows.push({ start, end });
    }

    return { windows, days };
}

/**
 * Test whether a bar time (already decomposed in the session's timezone)
 * falls inside the session.
 *
 * @param minutesOfDay minutes since midnight in the session timezone
 * @param jsDayOfWeek  JS day-of-week convention (0 = Sunday ... 6 = Saturday)
 */
export function isInSessionSpec(spec: SessionSpec, minutesOfDay: number, jsDayOfWeek: number): boolean {
    const pineDayToday = jsDayOfWeek + 1; // 1 = Sunday ... 7 = Saturday
    const pineDayTomorrow = (pineDayToday % 7) + 1;

    for (const { start, end } of spec.windows) {
        if (start < end) {
            // Same-day window; the trading day is the current day.
            if (minutesOfDay >= start && minutesOfDay < end && spec.days.has(pineDayToday)) return true;
        } else {
            // Overnight window (start >= end): the trading day is the day the
            // session ends. The pre-midnight part belongs to tomorrow's
            // trading day, the post-midnight part to today's.
            if (minutesOfDay >= start && spec.days.has(pineDayTomorrow)) return true;
            if (minutesOfDay < end && spec.days.has(pineDayToday)) return true;
        }
    }
    return false;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const UTC_TIMEZONES = new Set(['UTC', 'GMT', 'Etc/UTC']);
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(timestamp: number, timezone: string): ZonedDateParts {
    if (UTC_TIMEZONES.has(timezone)) {
        const date = new Date(timestamp);
        return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour: date.getUTCHours(),
            minute: date.getUTCMinutes(),
        };
    }

    let formatter = formatterCache.get(timezone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false,
        });
        formatterCache.set(timezone, formatter);
    }
    const parts = formatter.formatToParts(new Date(timestamp));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const hour = read('hour');
    return { year: read('year'), month: read('month'), day: read('day'), hour: hour === 24 ? 0 : hour, minute: read('minute') };
}

function localDayIndex(parts: Pick<ZonedDateParts, 'year' | 'month' | 'day'>): number {
    return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function localDate(dayIndex: number): Pick<ZonedDateParts, 'year' | 'month' | 'day'> {
    const date = new Date(dayIndex * DAY_MS);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function pineDay(dayIndex: number): number {
    return new Date(dayIndex * DAY_MS).getUTCDay() + 1;
}

function localTimestamp(dayIndex: number, minute: number, timezone: string): number {
    const normalizedDay = dayIndex + Math.floor(minute / 1440);
    const normalizedMinute = ((minute % 1440) + 1440) % 1440;
    const date = localDate(normalizedDay);
    const wallClock = Date.UTC(date.year, date.month - 1, date.day, Math.floor(normalizedMinute / 60), normalizedMinute % 60);
    if (UTC_TIMEZONES.has(timezone)) return wallClock;

    let timestamp = wallClock;
    for (let iteration = 0; iteration < 3; iteration++) {
        const actual = zonedParts(timestamp, timezone);
        const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
        timestamp += wallClock - represented;
    }
    return timestamp;
}

function windowBounds(window: SessionWindow, tradingDay: number, timezone: string): { start: number; end: number } {
    const wraps = window.start >= window.end;
    const startDay = wraps ? tradingDay - 1 : tradingDay;
    return {
        start: localTimestamp(startDay, window.start, timezone),
        end: localTimestamp(tradingDay, window.end, timezone),
    };
}

function sessionDayBounds(grid: SessionGrid, tradingDay: number): { start: number; end: number } | null {
    if (!grid.spec.days.has(pineDay(tradingDay))) return null;
    const bounds = grid.spec.windows.map((window) => windowBounds(window, tradingDay, grid.timezone));
    if (bounds.length === 0) return null;
    return {
        start: Math.min(...bounds.map((bound) => bound.start)),
        end: Math.max(...bounds.map((bound) => bound.end)),
    };
}

function containingSession(timestamp: number, grid: SessionGrid): { tradingDay: number; segmentStart: number; segmentEnd: number } | null {
    const parts = zonedParts(timestamp, grid.timezone);
    const currentDay = localDayIndex(parts);
    const minute = parts.hour * 60 + parts.minute;

    for (const window of grid.spec.windows) {
        let tradingDay: number | null = null;
        if (window.start < window.end) {
            if (minute >= window.start && minute < window.end) tradingDay = currentDay;
        } else if (minute >= window.start) {
            tradingDay = currentDay + 1;
        } else if (minute < window.end) {
            tradingDay = currentDay;
        }
        if (tradingDay === null || !grid.spec.days.has(pineDay(tradingDay))) continue;
        const bounds = windowBounds(window, tradingDay, grid.timezone);
        if (timestamp >= bounds.start && timestamp < bounds.end) {
            return { tradingDay, segmentStart: bounds.start, segmentEnd: bounds.end };
        }
    }
    return null;
}

function periodDays(tradingDay: number, timeframe: ParsedTimeframe): { start: number; end: number } {
    const date = new Date(tradingDay * DAY_MS);
    if (timeframe.unit === 'D') {
        const yearStart = Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / DAY_MS);
        const offset = Math.floor((tradingDay - yearStart) / timeframe.multiplier) * timeframe.multiplier;
        return { start: yearStart + offset, end: yearStart + offset + timeframe.multiplier };
    }
    if (timeframe.unit === 'W') {
        const monday = tradingDay - ((date.getUTCDay() + 6) % 7);
        const anchor = Math.floor(Date.UTC(1970, 0, 5) / DAY_MS);
        const width = timeframe.multiplier * 7;
        const start = anchor + Math.floor((monday - anchor) / width) * width;
        return { start, end: start + width };
    }
    const startMonth = Math.floor((date.getUTCMonth()) / timeframe.multiplier) * timeframe.multiplier;
    const start = Math.floor(Date.UTC(date.getUTCFullYear(), startMonth, 1) / DAY_MS);
    const end = Math.floor(Date.UTC(date.getUTCFullYear(), startMonth + timeframe.multiplier, 1) / DAY_MS);
    return { start, end };
}

function calendarSessionBar(tradingDay: number, timeframe: ParsedTimeframe, grid: SessionGrid): SessionBar | null {
    const period = periodDays(tradingDay, timeframe);
    let first: { start: number; end: number } | null = null;
    let last: { start: number; end: number } | null = null;
    let lastTradingDay = tradingDay;
    for (let day = period.start; day < period.end; day++) {
        const bounds = sessionDayBounds(grid, day);
        if (!bounds) continue;
        first ??= bounds;
        last = bounds;
        lastTradingDay = day;
    }
    return first && last ? { start: first.start, end: last.end, tradingDay: lastTradingDay * DAY_MS } : null;
}

export function createSessionGrid(session: unknown, timezone: unknown): SessionGrid | null {
    if (typeof session !== 'string' || session.trim() === '24x7' || typeof timezone !== 'string') return null;
    const spec = parseSessionSpec(session);
    return spec ? { spec, timezone } : null;
}

export function resolveSessionGrid(syminfo: unknown, openTimes: readonly number[]): SessionGrid | null {
    if (syminfo === null || typeof syminfo !== 'object') return null;
    const timezone = Reflect.get(syminfo, 'timezone');
    const regular = createSessionGrid(Reflect.get(syminfo, 'session'), timezone);
    const extended = createSessionGrid(Reflect.get(syminfo, 'session_extended'), timezone);
    if (!extended) return regular;
    if (!regular) return extended;
    const carriesExtendedBars = openTimes.some((time) => containingSession(time, extended) !== null && containingSession(time, regular) === null);
    return carriesExtendedBars ? extended : regular;
}

export function sessionTimeframeBar(timestamp: number, timeframe: ParsedTimeframe, grid: SessionGrid): SessionBar | null {
    const session = containingSession(timestamp, grid);
    if (!session) return null;
    if (timeframe.unit === 'D' || timeframe.unit === 'W' || timeframe.unit === 'M') {
        return calendarSessionBar(session.tradingDay, timeframe, grid);
    }

    const duration = timeframe.multiplier * (timeframe.unit === 'S' ? 1000 : MINUTE_MS);
    const start = session.segmentStart + Math.floor((timestamp - session.segmentStart) / duration) * duration;
    return {
        start,
        end: Math.min(start + duration, session.segmentEnd),
        tradingDay: session.tradingDay * DAY_MS,
    };
}

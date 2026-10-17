// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS, Provider } from 'index';
import { transpile } from '../../src/transpiler';

type PlotPoint = { readonly value: number };
type PlotOutput = { readonly data: readonly PlotPoint[] };

const START = new Date('2024-01-01').getTime();

function expectAllOnes(plots: Record<string, PlotOutput>, names: readonly string[]): void {
    for (const name of names) {
        expect(new Set(plots[name].data.map((point) => point.value)), name).toEqual(new Set([1]));
    }
}

async function runSource(source: string, timeframe: string, end: string) {
    const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', timeframe, undefined, START, new Date(end).getTime());
    return pineTS.run(source);
}

describe('bare built-ins in request expressions', () => {
    it('generates request.param around a bare namespace builtin', () => {
        // Given: the issue #257 scalar expression shape.
        const source = `//@version=6
indicator("request builtin generated")
v = request.security(syminfo.tickerid, "D", ta.vwap)
plot(v)
`;

        // When: Pine source is lowered to executable JavaScript.
        const code = transpile(source).toString();

        // Then: the hoisted built-in is captured under a named request param.
        expect(code).toMatch(/const p\d+ = request\.param\(temp_\d+, undefined, 'p\d+'\)/);
        expect(code).toMatch(/request\.security\(p\d+, p\d+, p\d+\)/);
    });

    it('generates a captured tuple with a transformed bare namespace builtin', () => {
        // Given: a tuple mixing a bare TA builtin, time, and price.
        const source = `//@version=6
indicator("request builtin tuple generated")
[v, t, c] = request.security(syminfo.tickerid, "D", [ta.vwap, time, close])
plot(v)
plot(t)
plot(c)
`;

        // When: the tuple expression is transformed.
        const code = transpile(source).toString();

        // Then: request.param captures the tuple and ta.vwap has a stable call id.
        expect(code).toMatch(/const temp_\d+ = ta\.vwap\("_ta\d+"\)/);
        expect(code).toMatch(/request\.param\(\[temp_\d+, time\.__value, close\], undefined, 'p\d+'\)/);
    });

    it('matches explicit scalar and tuple references for HTF builtins', async () => {
        // Given: scalar and tuple HTF requests for VWAP, time, and close.
        const source = `//@version=6
indicator("request builtin HTF")
same(a, b) => (na(a) and na(b)) or math.abs(a - b) < 0.0000001
bareVwap = request.security(syminfo.tickerid, "D", ta.vwap)
callVwap = request.security(syminfo.tickerid, "D", ta.vwap(hlc3))
[tupleVwap, tupleTime, tupleClose] = request.security(syminfo.tickerid, "D", [ta.vwap, time, close])
scalarTime = request.security(syminfo.tickerid, "D", time)
scalarClose = request.security(syminfo.tickerid, "D", close)
plot(same(bareVwap, callVwap) and same(tupleVwap, callVwap) ? 1 : 0, "vwapOk")
plot(same(tupleTime, scalarTime) ? 1 : 0, "timeOk")
plot(same(tupleClose, scalarClose) ? 1 : 0, "closeOk")
`;

        // When: the public runtime evaluates requested daily contexts.
        const { plots } = await runSource(source, '60', '2024-01-10');

        // Then: bare and explicit references are equal on every chart bar.
        expectAllOnes(plots, ['vwapOk', 'timeOk', 'closeOk']);
    });

    it('matches explicit scalar and tuple references for LTF builtins', async () => {
        // Given: scalar and tuple LTF requests for VWAP, time, and close.
        const source = `//@version=6
indicator("request builtin LTF")
same(a, b) => (na(a) and na(b)) or math.abs(a - b) < 0.0000001
arrEq(a, b) =>
    ok = a.size() == b.size()
    if ok
        for [i, value] in a
            if not same(value, b.get(i))
                ok := false
    ok
bareVwap = request.security_lower_tf(syminfo.tickerid, "60", ta.vwap)
callVwap = request.security_lower_tf(syminfo.tickerid, "60", ta.vwap(hlc3))
[tupleVwap, tupleTime, tupleClose] = request.security_lower_tf(syminfo.tickerid, "60", [ta.vwap, time, close])
scalarTime = request.security_lower_tf(syminfo.tickerid, "60", time)
scalarClose = request.security_lower_tf(syminfo.tickerid, "60", close)
plot(arrEq(bareVwap, callVwap) and arrEq(tupleVwap, callVwap) ? 1 : 0, "vwapOk")
plot(arrEq(tupleTime, scalarTime) ? 1 : 0, "timeOk")
plot(arrEq(tupleClose, scalarClose) ? 1 : 0, "closeOk")
`;

        // When: the public runtime evaluates hourly intrabars.
        const { plots } = await runSource(source, 'D', '2024-02-01');

        // Then: bare and explicit references are equal on every chart bar.
        expectAllOnes(plots, ['vwapOk', 'timeOk', 'closeOk']);
    });

    it('keeps two callsites isolated with a path-qualified request param', async () => {
        // Given: one UDF request expression reached through two syntactic paths.
        const source = `//@version=6
indicator("request builtin paths")
same(a, b) => (na(a) and na(b)) or math.abs(a - b) < 0.0000001
fetchVwap(tf) => request.security(syminfo.tickerid, tf, ta.vwap)
daily = fetchVwap("D")
weekly = fetchVwap("W")
dailyRef = request.security(syminfo.tickerid, "D", ta.vwap(hlc3))
weeklyRef = request.security(syminfo.tickerid, "W", ta.vwap(hlc3))
plot(same(daily, dailyRef) ? 1 : 0, "dailyOk")
plot(same(weekly, weeklyRef) ? 1 : 0, "weeklyOk")
`;

        // When: generated code and runtime results are observed.
        const code = transpile(source).toString();
        const { plots } = await runSource(source, '60', '2024-02-01');

        // Then: the wrapper name uses the function call path and both invocations retain their values.
        expect(code).toMatch(/request\.param\(temp_\d+,[\s\S]*?\$\$\.id \+ 'p\d+'\)/);
        expectAllOnes(plots, ['dailyOk', 'weeklyOk']);
    });
});

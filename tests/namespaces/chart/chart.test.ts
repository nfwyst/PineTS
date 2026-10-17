import { PineTS } from 'index';
import { describe, expect, it } from 'vitest';

import { Provider } from '@pinets/marketData/Provider.class';

describe('CHART Namespace', () => {
    describe('chart.point', () => {
        it('chart.point.new() creates point with given properties', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var myPoint = chart.point.new(1000, 5, 50000);
                var pt_time = myPoint.time;
                var pt_index = myPoint.index;
                var pt_price = myPoint.price;
                return { pt_time, pt_index, pt_price };
            });

            expect(result.pt_time[0]).toBe(1000);
            expect(result.pt_index[0]).toBe(5);
            expect(result.pt_price[0]).toBe(50000);
        });

        it('chart.point.from_index() creates point from bar index', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var myPoint = chart.point.from_index(42, 75000);
                var pt_index = myPoint.index;
                var pt_price = myPoint.price;
                var hasTime = myPoint.time !== undefined;
                return { pt_index, pt_price, hasTime };
            });

            expect(result.pt_index[0]).toBe(42);
            expect(result.pt_price[0]).toBe(75000);
            expect(result.hasTime[0]).toBe(false);
        });

        it('chart.point.from_time() creates point from timestamp', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var myPoint = chart.point.from_time(1700000000000, 80000);
                var pt_time = myPoint.time;
                var pt_price = myPoint.price;
                var hasIndex = myPoint.index !== undefined;
                return { pt_time, pt_price, hasIndex };
            });

            expect(result.pt_time[0]).toBe(1700000000000);
            expect(result.pt_price[0]).toBe(80000);
            expect(result.hasIndex[0]).toBe(false);
        });

        it('chart.point.now() creates point at current bar', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var myPoint = chart.point.now(65000);
                var pt_index = myPoint.index;
                var pt_price = myPoint.price;
                var hasTime = myPoint.time !== undefined;
                var matchesBarIndex = myPoint.index === bar_index;
                return { pt_index, pt_price, hasTime, matchesBarIndex };
            });

            expect(result.pt_price[0]).toBe(65000);
            expect(result.pt_index[0]).toBe(0);
            expect(result.hasTime[0]).toBe(true);
            expect(result.matchesBarIndex[0]).toBe(true);
        });

        it('chart.point.copy() creates independent clone', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var orig = chart.point.new(1000, 5, 50000);
                var cp = chart.point.copy(orig);
                var origPrice = orig.price;
                var copyPrice = cp.price;

                cp.price = 99999;
                var origPriceAfter = orig.price;
                var copyPriceAfter = cp.price;

                return { origPrice, copyPrice, origPriceAfter, copyPriceAfter };
            });

            expect(result.origPrice[0]).toBe(50000);
            expect(result.copyPrice[0]).toBe(50000);
            expect(result.origPriceAfter[0]).toBe(50000);
            expect(result.copyPriceAfter[0]).toBe(99999);
        });
    });

    describe('chart properties', () => {
        it('chart.bg_color keeps the exact default dark background', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var bgColor = chart.bg_color;
                return { bgColor };
            });

            expect(result.bgColor[0]).toBe('#1e293b');
        });

        it('chart.fg_color keeps the exact default dark foreground', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var fgColor = chart.fg_color;
                return { fgColor };
            });

            expect(result.fgColor[0]).toBe('#d1d4dc');
        });

        it('host theme reaches chart variables and plot and drawing consumers', async () => {
            // Given: one PineTS instance with a validated custom host theme.
            const background = '#102030';
            const foreground = '#abcdef';
            const pineTS = new PineTS(
                Provider.Mock,
                'BTCUSDC',
                'D',
                null,
                new Date('2025-01-01').getTime(),
                new Date('2025-01-05').getTime(),
                { chartTheme: { background, foreground } },
            );

            // When: chart variables flow through plot and line color arguments.
            const context = await pineTS.run(`//@version=6
indicator("host theme", overlay=true)
plot(close, "themedPlot", color=chart.fg_color)
if barstate.isfirst
    line.new(0, 1, 1, 2, color=chart.bg_color)
`);

            // Then: the variables and both serialized consumers use the configured values.
            expect(context.pine.chart.bg_color).toBe(background);
            expect(context.pine.chart.fg_color).toBe(foreground);
            expect(context.plots['themedPlot'].data[0].options.color).toBe(foreground);
            expect(context.plots['__lines__'].data[0].value[0].color).toBe(background);
        });

        it('keeps host themes isolated per instance without rerunning unrelated scripts', async () => {
            // Given: two instances with different immutable host themes.
            const bars = [{ openTime: 0, closeTime: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
            const source = `//@version=6
indicator("isolated themes")
plot(close, "value", color=chart.fg_color)
`;
            const first = new PineTS(bars, 'FIRST', 'D', undefined, undefined, undefined, {
                chartTheme: { background: '#111111', foreground: '#222222' },
            });
            const second = new PineTS(bars, 'SECOND', 'D', undefined, undefined, undefined, {
                chartTheme: { background: '#aaaaaa', foreground: '#bbbbbb' },
            });

            // When: each instance runs and the first is updated after the second.
            const firstContext = await first.update(source);
            const secondContext = await second.update(source);
            const firstCached = await first.update();

            // Then: values are instance-local and the unrelated theme did not invalidate the first cache.
            expect(firstContext.pine.chart.bg_color).toBe('#111111');
            expect(firstContext.pine.chart.fg_color).toBe('#222222');
            expect(secondContext.pine.chart.bg_color).toBe('#aaaaaa');
            expect(secondContext.pine.chart.fg_color).toBe('#bbbbbb');
            expect(firstContext.plots['value'].data[0].options.color).toBe('#222222');
            expect(secondContext.plots['value'].data[0].options.color).toBe('#bbbbbb');
            expect(firstCached).toBe(firstContext);
        });

        it('keeps the host theme inside request.security secondary execution', async () => {
            const foreground = '#aabbcc';
            const pineTS = new PineTS(
                Provider.Mock,
                'BTCUSDC',
                '60',
                undefined,
                new Date('2024-01-01').getTime(),
                new Date('2024-01-03').getTime(),
                { chartTheme: { background: '#010203', foreground } },
            );

            const context = await pineTS.run(`//@version=6
indicator("secondary host theme")
requestedColor = request.security(syminfo.tickerid, "D", chart.fg_color)
plot(close, "value", color=requestedColor)`);

            expect(context.plots.value.data.at(-1)?.options.color).toBe(foreground);
        });

        it('chart.is_standard returns true (Pine variable — bare member access)', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var isStandard = chart.is_standard;
                return { isStandard };
            });

            expect(result.isStandard[0]).toBe(true);
        });
    });

    describe('chart.point integration with label', () => {
        it('label.set_point() uses chart.point from_index coordinates', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var myLabel = label.new(bar_index, close, 'PointInteg');
                var myPoint = chart.point.from_index(55, 90000);
                label.set_point(myLabel, myPoint);
                var lblX = myLabel.x;
                var lblY = myLabel.y;
                var lblXloc = myLabel.xloc;
                return { lblX, lblY, lblXloc };
            });

            expect(result.lblX[0]).toBe(55);
            expect(result.lblY[0]).toBe(90000);
            expect(result.lblXloc[0]).toBe('bi');
        });

        it('label.set_point() keeps the label xloc (a from_time point on a bar_index label gives na)', async () => {
            const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-11-20').getTime());

            const { result } = await pineTS.run((context) => {
                var myLabel = label.new(bar_index, close, 'TimePoint');
                var myPoint = chart.point.from_time(1700000000000, 85000);
                label.set_point(myLabel, myPoint);
                var lblX = myLabel.x;
                var lblXloc = myLabel.xloc;
                return { lblX, lblXloc };
            });

            // TradingView keeps the label's xloc (bar_index): a from_time point has no index, so x is na.
            expect(result.lblX[0]).toBeNaN();
            expect(result.lblXloc[0]).toBe('bi');
        });
    });
});

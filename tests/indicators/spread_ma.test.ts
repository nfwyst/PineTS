import { describe, expect, it } from 'vitest';

import { Indicator, PineTS, Provider } from 'index';
import { normalizePlotString } from '../utils';

describe('Indicators', () => {
    it('SPREAD_MA - Spread MA', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math, input } = context.pine;

            const length = input.int(5, 'Length');
            const sma = ta.sma(close, length);
            const ssma = (100 * (close - sma)) / sma;
            const res = ssma;
            plotchar(res, '_plot');
        };

        const pineCode = `
//@version=5
indicator("Spread Moving Average", overlay=false)

length = input.int(5, "Length")
sma = ta.sma(close, length)
ssma = 100 * (close - sma) / sma
plot(ssma, "_plot", color.blue, linewidth=2)        
`;

        const { result, plots } = await pineTS.run(pineCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2018-12-10').getTime();
        const endDate = new Date('2019-03-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: NaN
[2018-12-17T00:00:00.000-00:00]: NaN
[2018-12-24T00:00:00.000-00:00]: NaN
[2018-12-31T00:00:00.000-00:00]: NaN
[2019-01-07T00:00:00.000-00:00]: -5.273026266064024
[2019-01-14T00:00:00.000-00:00]: -6.258616447711691
[2019-01-21T00:00:00.000-00:00]: -4.2324871251793175
[2019-01-28T00:00:00.000-00:00]: -5.333921276613445
[2019-02-04T00:00:00.000-00:00]: 3.494395849760149
[2019-02-11T00:00:00.000-00:00]: 2.1507010977032515
[2019-02-18T00:00:00.000-00:00]: 3.6866654742382536
[2019-02-25T00:00:00.000-00:00]: 3.974265707830406
[2019-03-04T00:00:00.000-00:00]: 4.302199804859045
[2019-03-11T00:00:00.000-00:00]: 4.398461633201533`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(normalizePlotString(plotdata_str)).toEqual(normalizePlotString(expected_plot));
    });


    it('SPREAD_MA - Spread MA with custom input', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());



        const pineCode = `
//@version=5
indicator("Spread Moving Average", overlay=false)

length = input.int(5, "Length")
sma = ta.sma(close, length)
ssma = 100 * (close - sma) / sma
plot(ssma, "_plot", color.blue, linewidth=2)        
`;

        const inputs = {
            Length: 10,
        };
        const indicator = new Indicator(pineCode, inputs);

        const { result, plots } = await pineTS.run(indicator);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2018-12-10').getTime();
        const endDate = new Date('2019-03-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: NaN
[2018-12-17T00:00:00.000-00:00]: NaN
[2018-12-24T00:00:00.000-00:00]: NaN
[2018-12-31T00:00:00.000-00:00]: NaN
[2019-01-07T00:00:00.000-00:00]: NaN
[2019-01-14T00:00:00.000-00:00]: NaN
[2019-01-21T00:00:00.000-00:00]: NaN
[2019-01-28T00:00:00.000-00:00]: NaN
[2019-02-04T00:00:00.000-00:00]: NaN
[2019-02-11T00:00:00.000-00:00]: 0.005291664415872107
[2019-02-18T00:00:00.000-00:00]: 1.115447680192139
[2019-02-25T00:00:00.000-00:00]: 3.3007897209896346
[2019-03-04T00:00:00.000-00:00]: 6.163014179219941
[2019-03-11T00:00:00.000-00:00]: 8.267677853843649`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(normalizePlotString(plotdata_str)).toEqual(normalizePlotString(expected_plot));
    });    
});

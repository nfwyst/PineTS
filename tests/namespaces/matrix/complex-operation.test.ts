import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, normalizePlotString, runNSFunctionWithArgs } from '../../utils';

import { Context, PineTS, Provider } from 'index';

describe('Matrix - Complex Operation', () => {
    it('kernel_matrix', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = `
//@version=5
indicator("PineTS Test")

window = 5
sigma = 0.01
rbf(x1, x2, l)=> math.exp(-math.pow(x1 - x2, 2) / (2.0 * math.pow(l, 2)))

kernel_matrix(X1, X2, l)=>
    km = matrix.new<float>(X1.size(), X2.size())

    i = 0
    for x1 in X1
        j = 0
        for x2 in X2
            rbf = rbf(x1, x2, l)
            km.set(i, j, rbf)
            j += 1
        i += 1
    
    km

var identity = matrix.new<int>(window, window, 0)
var array<float> K_row = na

xtrain = array.new<int>(0)

//Build identity matrix and training array
for i = 0 to window-1
    for j = 0 to window-1
        identity.set(i, j, i == j ? 1 : 0)

    xtrain.push(i)

_rbf = rbf(close, open, 5)
//Compute kernel matrices
s = identity.mult(sigma * sigma)
//failing syntax
Ktrain = kernel_matrix(xtrain, xtrain, window).sum(s)



plotchar(Ktrain, '_plot')
plotchar(_rbf, '_rbf')
`;

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        let _rbfdata = plots['_rbf']?.data;
        const startDate = new Date('2018-12-10').getTime();
        const endDate = new Date('2019-01-10').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            const rbf = _rbfdata[i].value;
            plotdata_str += `[${str_time}]: ${rbf} ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 0.9893985952 [1.0001, 0.9801986733, 0.9231163464, 0.8352702114, 0.7261490371]
[0.9801986733, 1.0001, 0.9801986733, 0.9231163464, 0.8352702114]
[0.9231163464, 0.9801986733, 1.0001, 0.9801986733, 0.9231163464]
[0.8352702114, 0.9231163464, 0.9801986733, 1.0001, 0.9801986733]
[0.7261490371, 0.8352702114, 0.9231163464, 0.9801986733, 1.0001]
[2018-12-17T00:00:00.000-00:00]: 0 [1.0001, 0.9801986733, 0.9231163464, 0.8352702114, 0.7261490371]
[0.9801986733, 1.0001, 0.9801986733, 0.9231163464, 0.8352702114]
[0.9231163464, 0.9801986733, 1.0001, 0.9801986733, 0.9231163464]
[0.8352702114, 0.9231163464, 0.9801986733, 1.0001, 0.9801986733]
[0.7261490371, 0.8352702114, 0.9231163464, 0.9801986733, 1.0001]
[2018-12-24T00:00:00.000-00:00]: 2.1659909e-139 [1.0001, 0.9801986733, 0.9231163464, 0.8352702114, 0.7261490371]
[0.9801986733, 1.0001, 0.9801986733, 0.9231163464, 0.8352702114]
[0.9231163464, 0.9801986733, 1.0001, 0.9801986733, 0.9231163464]
[0.8352702114, 0.9231163464, 0.9801986733, 1.0001, 0.9801986733]
[0.7261490371, 0.8352702114, 0.9231163464, 0.9801986733, 1.0001]
[2018-12-31T00:00:00.000-00:00]: 0 [1.0001, 0.9801986733, 0.9231163464, 0.8352702114, 0.7261490371]
[0.9801986733, 1.0001, 0.9801986733, 0.9231163464, 0.8352702114]
[0.9231163464, 0.9801986733, 1.0001, 0.9801986733, 0.9231163464]
[0.8352702114, 0.9231163464, 0.9801986733, 1.0001, 0.9801986733]
[0.7261490371, 0.8352702114, 0.9231163464, 0.9801986733, 1.0001]
[2019-01-07T00:00:00.000-00:00]: 0 [1.0001, 0.9801986733, 0.9231163464, 0.8352702114, 0.7261490371]
[0.9801986733, 1.0001, 0.9801986733, 0.9231163464, 0.8352702114]
[0.9231163464, 0.9801986733, 1.0001, 0.9801986733, 0.9231163464]
[0.8352702114, 0.9231163464, 0.9801986733, 1.0001, 0.9801986733]
[0.7261490371, 0.8352702114, 0.9231163464, 0.9801986733, 1.0001]`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(normalizePlotString(plotdata_str)).toEqual(normalizePlotString(expected_plot));
    });
});

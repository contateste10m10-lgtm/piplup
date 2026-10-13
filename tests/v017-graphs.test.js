'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('V0.18 includes the five reference scientific visualizations', () => {
  for (const id of ['batchClassHistogram','batchTemporalGrid','batchHeatmap','batchBandProfile','batchSampenVariability']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing graph ${id}`);
  }
  assert.match(app, /histnorm|Densidade de probabilidade/);
  assert.match(app, /BATCH_HISTOGRAM_MARKERS/);
  assert.match(app, /function batchTemporalCoincidences\(points,tolerance=0\.001\)/);
  assert.match(app, /function renderBatchTemporalGrid\(rows\)/);
  assert.match(app, /Média entre fontes/);
  assert.match(app, /batchViridisColor/);
  assert.match(app, /variabilidade robusta/);
});

test('temporal coincidence clusters never exceed the maximum SampEn tolerance', () => {
  const start = app.indexOf('function batchTemporalCoincidences');
  const end = app.indexOf('\nfunction renderBatchTemporalGrid', start);
  assert.ok(start >= 0 && end > start, 'coincidence helper must be defined');
  const source = app.slice(start, end);
  const fn = new Function('mean', `${source}; return batchTemporalCoincidences;`)(values => values.reduce((a,b)=>a+b,0)/values.length);
  const matches = fn([
    {x:1,y:1.0000,source:'A',band:'band_1'},
    {x:1,y:1.0008,source:'A',band:'band_2'},
    {x:1,y:1.0016,source:'A',band:'band_3'},
    {x:2,y:1.5,source:'A',band:'band_1'},
    {x:2,y:1.5009,source:'A',band:'band_2'}
  ],0.001);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(x=>x.nBands), [2,2]);
  assert.ok(matches.every(x => x.max - x.min <= 0.001));
  assert.deepEqual(matches.map(x=>x.x), [1,2]);
});

test('temporal grid is responsive and source-band profile records equal-source methodology', () => {
  assert.match(css, /\.batch-temporal-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:620px\)\{\.batch-temporal-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(app, /groupby|batchGroupMean\(rows\.filter\(r=>r\.band!=='Sem banda'\),\['source','band'\]\)/);
  assert.match(app, /Each source|Cada fonte recebe peso igual/);
});

test('class density integrates to one on shared adaptive bin edges', () => {
  const binsStart = app.indexOf('function batchBuildBins');
  const binsEnd = app.indexOf('\nfunction batchSortBands', binsStart);
  assert.ok(binsStart >= 0 && binsEnd > binsStart, 'histogram helpers must be defined');
  const helpers = app.slice(binsStart, binsEnd);
  const { batchBuildBins, batchDensity } = new Function(
    'finiteMinMax', 'mean', 'stdSample',
    `${helpers}; return { batchBuildBins, batchDensity };`
  )(
    values => ({ min: Math.min(...values), max: Math.max(...values) }),
    values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    values => values.length > 1 ? Math.sqrt(values.reduce((sum,value)=>sum+(value-values.reduce((a,b)=>a+b,0)/values.length)**2,0)/(values.length-1)) : 0
  );
  const classA = [1.1, 1.2, 1.3, 1.7, 1.9, 2.0];
  const classB = [1.15, 1.45, 1.55, 1.8, 2.1, 2.3];
  const bins = batchBuildBins([...classA, ...classB]);
  assert.equal(bins.length, Math.ceil(Math.sqrt(classA.length + classB.length)));
  assert.equal(batchBuildBins(Array.from({length: 10000}, (_, i) => i)).length, 30, 'bin count is capped at 30 for large samples');
  assert.equal(bins[0].low, Math.min(...classA, ...classB));
  assert.equal(bins.at(-1).high, Math.max(...classA, ...classB));
  for (const sample of [classA, classB]) {
    const density = batchDensity(sample, bins);
    const width = bins[0].high - bins[0].low;
    const integratedArea = density.reduce((sum, value) => sum + value * width, 0);
    assert.ok(Math.abs(integratedArea - 1) < 1e-12, `density area should be 1, got ${integratedArea}`);
  }
});

test('band profile averages per source before averaging sources', () => {
  const groupStart = app.indexOf('function batchGroupMean');
  const groupEnd = app.indexOf('\nfunction batchDistributionRows', groupStart);
  const profileStart = app.indexOf('function batchBuildBandProfile');
  const profileEnd = app.indexOf('\nfunction batchSortBands', profileStart);
  assert.ok(groupStart >= 0 && groupEnd > groupStart && profileStart >= 0 && profileEnd > profileStart);
  const helpers = `${app.slice(groupStart, groupEnd)}\n${app.slice(profileStart, profileEnd)}`;
  const { batchGroupMean, batchBuildBandProfile } = new Function(
    'mean', 'stdSample',
    `${helpers}; return { batchGroupMean, batchBuildBandProfile };`
  )(
    values => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null,
    values => values.length > 1 ? Math.sqrt(values.reduce((sum,value)=>sum+(value-values.reduce((a,b)=>a+b,0)/values.length)**2,0)/(values.length-1)) : 0
  );
  const raw = [
    { source: 'A', band: 'band_1', sampen: 1 },
    { source: 'A', band: 'band_1', sampen: 1 },
    { source: 'A', band: 'band_1', sampen: 1 },
    { source: 'A', band: 'band_1', sampen: 1 },
    { source: 'B', band: 'band_1', sampen: 3 }
  ];
  const perSourceBand = batchGroupMean(raw, ['source', 'band']);
  const profile = batchBuildBandProfile(perSourceBand, ['band_1']);
  assert.equal(perSourceBand.length, 2);
  assert.equal(profile[0].n, 2);
  assert.equal(profile[0].mean, 2);
  assert.ok(Math.abs(profile[0].sd - Math.sqrt(2)) < 1e-12);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('page loads scientific core before application code', () => {
  const core = html.indexOf('src="analysis-core.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(core >= 0 && app > core);
});

test('results UI includes both measurements and export actions', () => {
  for (const id of ['entropyChart','modulationChart','metricModMean','resultsTable','downloadCsvBtn','downloadPngBtn','downloadModulationPngBtn']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /Modulação intrínseca \(%\)/i);
  assert.match(html, /SampEn/);
  assert.match(js, /intrinsicModulation/);
  assert.match(js, /N_excluded_missing_invalid_error/);
});

test('HTML and application references use the expected chart and table field IDs', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = new Set([...js.matchAll(/el\('([A-Za-z][A-Za-z0-9_-]*)'\)/g)].map(match => match[1]));
  const missing = [...refs].filter(id => !ids.has(id) && id !== 'timeColumn' && id !== 'demoBtn'); // timeColumn is built after file mapping.
  assert.deepEqual(missing, []);
});

test('V0.10 Sample Entropy match overlay controls are present and wired to the chart', () => {
  for (const id of ['showSampenMatches', 'sampenMatchBandSelect', 'sampenMatchStatus', 'lightcurveOverlayChart']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(js, /sampenMatchOverlayPlugin/);
  assert.match(js, /matchPairs\.mPlus1/);
  assert.match(js, /updateSampenMatchOverlay/);
  assert.match(html, /Linhas tracejadas representam padrões semelhantes/);
});

test('adaptive chart policy avoids weak panels and defers advanced visualization work', () => {
  assert.match(js, /function histogramIsUseful\(values,minN=15,minDistinct=5\)/);
  assert.match(js, /const scatterOK=validPairs.length>=8&&xDistinct>=4&&yDistinct>=4/);
  assert.match(js, /const bubbleOK=bubblePairs.length>=12/);
  assert.match(js, /function renderBatchGallery\(rows,\{advancedOnly=false\}=\{\}\)/);
  assert.match(js, /function destroyBatchAdvancedCharts\(\)/);
  assert.match(js, /batchState\.advancedChartsRenderedForRows!==batchState\.rows/);
  assert.match(js, /sources.length<=80&&realBands.length>=2&&realBands.length<=12/);
  assert.match(js, /ranking.length<=40/);
  assert.match(js, /function groupRowsForChart\(rows,maxGroups=8\)/);
  assert.match(html, /id="articleAdvancedVisuals"/);
  assert.match(html, /id="batchAdvancedVisuals"/);
  assert.match(html, /id="articleClassComparisonTable"/);
});

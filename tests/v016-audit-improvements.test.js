'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const worker = read('analysis-worker.js');
const css = read('styles.css');

test('V0.18 preserves visible provenance and a correctly labelled modulation metric', () => {
  assert.match(html, /id="reproducibilityPanel"/);
  for (const id of ['reproSource','reproInstrument','reproDatasetType','reproHash','reproParams','reproAlgorithm','reproTimestamp']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Modulação intrínseca \(%\)/);
  assert.doesNotMatch(html, /m intrínseco \(%\)/i);
  assert.match(app, /function updateReproducibilityPanel\(\)/);
  assert.match(app, /datasetHash/);
});

test('V0.18 has a visible self-test, sensitivity map and citation', () => {
  for (const id of ['runSelfTestBtn','selfTestResult','runSensitivityBtn','sensitivityGrid','sensitivityBandSelect']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function runLocalSelfTest\(\)/);
  assert.match(app, /function runSensitivityAnalysis\(\)/);
  assert.match(worker, /data\.type === 'sensitivity'/);
  assert.match(html, /RichmanMoorman2000SampEn/);
});

test('Sensitivity analysis reuses the exact stored band used in the displayed result', () => {
  assert.match(app, /const index=Number\(select\?\.value\), band=state\.results\[index\]/);
  assert.match(app, /new Map\(cells\.map\(cell=>\[`\$\{cell\.m\}:\$\{cell\.r\}`/);
});

test('mobile/tablet and touch refinements are defined', () => {
  assert.match(css, /@media \(min-width:761px\) and \(max-width:1050px\)/);
  assert.match(css, /@media \(max-width:420px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(app, /Toque para escolher um arquivo/);
});

test('local data privacy disclosure accurately acknowledges remaining CDN requests', () => {
  assert.match(html, /assets\/vendor\/pako\.min\.js/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /servidor CDN recebe a requisição.*IP/s);
  assert.match(html, /não promete uso totalmente offline/i);
  assert.match(html, /href="https:\/\/github\.com\/contateste10m10-lgtm\/novo_laufey"/);
});

test('chart navigation preserves Ctrl drag and Ctrl wheel for mouse users', () => {
  assert.match(app, /modifierKey:'ctrl'/);
  assert.match(app, /Ctrl \+ arraste para mover · Ctrl \+ roda para zoom/);
  assert.doesNotMatch(app, /pan\.addEventListener\('click'/);
});

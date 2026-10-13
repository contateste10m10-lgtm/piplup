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

test('V0.18 preserves the three-stage flow, local privacy cue, and synthetic demo entry point', () => {
  assert.match(html, /Multiband Entropy Lab V0\.18/);
  for (const id of ['heroDemoBtn', 'heroLocalBtn', 'workflowStep1', 'workflowStep2', 'workflowStep3', 'workflowStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /DADOS NO NAVEGADOR/);
  assert.match(app, /makeDemo\(\{autoCalculate:true\}\)/);
  assert.match(html, /Não são dados observacionais/);
});

test('V0.18 preserves input validation, parameter guidance, and a session summary export', () => {
  for (const id of ['validationSummary', 'analysisProgress', 'downloadSessionJsonBtn', 'recommendedParamsBtn']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /class="format-guide"/);
  assert.match(html, /class="concept-guide"/);
  assert.match(app, /function renderValidationSummary\(parsed\)/);
  assert.match(app, /function exportAnalysisSessionJson\(\)/);
  assert.match(app, /demoData:Boolean\(state\.demoMode\)/);
});

test('text and FITS parsers yield to the browser while reading large tables', () => {
  assert.match(app, /async function parseTextTable\(/);
  assert.match(app, /async function parseFitsBuffer\(/);
  assert.match(app, /await parseFitsBuffer\(buffer,file\.name\)/);
  assert.match(app, /await parseTextTable\(/);
  assert.match(app, /Lendo tabela de texto/);
  assert.match(app, /Convertendo valores/);
  assert.match(app, /Lendo tabela FITS/);
});

test('scientific worker reports band start and completion while remaining same-origin', () => {
  assert.match(worker, /importScripts\('\.\/analysis-core\.js'\)/);
  assert.match(worker, /phase: 'start'/);
  assert.match(worker, /phase: 'done'/);
  assert.match(app, /new URL\('analysis-worker\.js', document\.baseURI\)/);
  assert.match(app, /phaseLabel = done \? 'Concluída' : 'Calculando'/);
});

test('responsive mobile controls and reduced-motion preferences are defined', () => {
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('styles.css');
const workflow = read('.github/workflows/tests.yml');

test('mobile calculate dock can be used repeatedly after a calculation', () => {
  assert.match(app, /const ready=Boolean\(state\.parsed&&state\.dataRows\.length&&button\.dataset\.busy!=='true'\)/);
  assert.match(app, /mobileBtn\.dataset\.busy='false'/);
  assert.match(app, /syncMobileCalculateDock\(/);
});

test('canonical and social metadata plus project links use the current GitHub Pages path', () => {
  const current = 'https://contateste10m10-lgtm.github.io/novo_laufey/';
  assert.match(html, new RegExp(`<link rel="canonical" href="${current.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}">`));
  assert.match(html, /property="og:url" content="https:\/\/contateste10m10-lgtm\.github\.io\/novo_laufey\//);
  assert.match(html, /property="og:image" content="https:\/\/contateste10m10-lgtm\.github\.io\/novo_laufey\/assets\/icons\/social-preview\.png/);
  assert.doesNotMatch(html, /teste-2000/);
  assert.match(html, /github\.com\/contateste10m10-lgtm\/novo_laufey/);
});

test('scientific status and column mapping are compact, expandable details by default', () => {
  assert.match(html, /<details class="validation-status-banner validation-status-details"><summary>/);
  assert.match(html, /<details id="columnMappingDetails" class="column-mapping-details">/);
  assert.doesNotMatch(html.match(/<details id="columnMappingDetails"[^>]*>/)?.[0] || '', /\sopen(?:\s|>)/);
  assert.match(css, /\.validation-status-details>summary[^\{]*\{[^}]*min-height:44px/s);
});

test('all external script dependencies have integrity metadata while offline limitation stays explicit', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*src="https?:\/\/[^>]+>/g)].map(match => match[0]);
  assert.ok(scripts.length >= 3, 'expected external chart/gesture dependencies');
  for (const script of scripts) assert.match(script, /\bintegrity="(?:sha256|sha384|sha512)-/, `missing SRI: ${script}`);
  assert.match(html, /não promete uso totalmente offline/i);
  assert.match(read('README.md'), /não é completamente offline/i);
});

test('histogram bins adapt to sample size and are capped at 30', () => {
  assert.match(app, /const n=Math\.min\(maxBins,Math\.max\(1,Math\.ceil\(Math\.sqrt\(vals\.length\)\)\)\)/);
  assert.match(read('tests/v017-graphs.test.js'), /batchBuildBins\(Array\.from\(\{length: 10000\}/);
});

test('profile standard-deviation band is hidden below four sources per band', () => {
  assert.match(app, /const showBandSd=bandProfileOK&&profile\.every\(point=>point\.n>=4\)/);
  assert.match(app, /faixa de ±1 DP omitida porque alguma banda tem menos de 4 fontes/);
});

test('temporal coincidence threshold is user-configurable and group mean is labelled honestly', () => {
  assert.match(html, /id="batchCoincidenceTolerance"[^>]*value="0\.001"/);
  assert.match(app, /function getBatchCoincidenceTolerance\(\)/);
  assert.match(app, /batchTemporalCoincidences\(item\.points\.filter\(point=>bandsForPlot\.includes\(point\.band\)\),coincidenceTolerance\)/);
  assert.match(app, /Média do grupo · coincidência/);
  assert.match(app, /A posição do diamante não é uma nova medição/);
});

test('software citation is available in page and repository metadata', () => {
  assert.match(html, /Como citar o Multiband Entropy Lab/);
  assert.match(html, /@software\{multiband_entropy_lab_v018/);
  assert.match(read('CITATION.cff'), /version: "0\.18"/);
  assert.match(read('CITATION.cff'), /https:\/\/github\.com\/contateste10m10-lgtm\/novo_laufey/);
});

test('continuous integration includes a 390px Playwright smoke test', () => {
  assert.match(workflow, /npm install --no-save --no-package-lock playwright@/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /tests\/mobile-smoke\.playwright\.cjs/);
  assert.match(read('tests/mobile-smoke.playwright.cjs'), /width:390,height:844/);
  assert.match(read('tests/mobile-smoke.playwright.cjs'), /scrollWidth <= layout\.width \+ 1/);
});

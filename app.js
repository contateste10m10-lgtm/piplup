'use strict';

const BAND_DEFS = [
  { key: 'b1', name: '14–20 keV', short: '14–20', color: '#8a8dff' },
  { key: 'b2', name: '20–24 keV', short: '20–24', color: '#5cdec2' },
  { key: 'b3', name: '24–35 keV', short: '24–35', color: '#ffbd78' },
  { key: 'b4', name: '35–50 keV', short: '35–50', color: '#f285a3' },
  { key: 'b5', name: '50–75 keV', short: '50–75', color: '#71b7ff' },
  { key: 'b6', name: '75–100 keV', short: '75–100', color: '#d0a1ff' },
  { key: 'b7', name: '100–150 keV', short: '100–150', color: '#b1d765' },
  { key: 'b8', name: '150–195 keV', short: '150–195', color: '#ff9e6d' }
];
const state = { table: null, source: '', instrument: '', charts: [], results: [], parsed: false, demoMode: false, uiStage: 1, dataRows: [], header: [], delimiter: 'whitespace', fileName: '', fileHash: '', timeIndex: 0, bandIndices: [], errorIndices: [], timeLabel: 'Tempo', columnNames: [], latestAnalysis: null, workerRequestId: 0, pendingSession: null, bandDefs: BAND_DEFS.map(b => ({...b})) };
const el = id => document.getElementById(id);

// Optional Chart.js zoom plugin. Toolbar-based zoom remains available as a fallback.
try {
  if (window.Chart && window.ChartZoom) {
    const zoomPlugin = window.ChartZoom.default || window.ChartZoom;
    if (!Chart.registry?.plugins?.get?.('zoom')) Chart.register(zoomPlugin);
  }
} catch (err) { console.warn('Plugin de zoom indisponível; controles manuais continuam ativos.', err); }

function message(text, type = '') { const n = el('analysisMessage'); n.textContent = text; n.className = `analysis-message ${type}`.trim(); }
function fileStatus(text, type = '') { const n = el('fileStatus'); n.textContent = text; n.className = `file-status ${type}`.trim(); }
function fileSizeLabel(length) {
  const bytes = Math.max(0, Number(length) || 0);
  if (bytes < 1024) return `${bytes} caracteres`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} Ki caracteres`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR',{maximumFractionDigits:1})} Mi caracteres`;
}
function setWorkflowStage(stage) {
  const hasData = Boolean(state.parsed && state.table && state.dataRows.length);
  const hasResults = Boolean(el('resultsSection') && !el('resultsSection').classList.contains('hidden'));
  const maxStep = hasResults ? 3 : (hasData ? 2 : 1);
  const nextStage = Math.max(1, Math.min(Number(stage) || 1, maxStep));
  state.uiStage = nextStage;
  const copy = {
    1: 'Comece carregando um arquivo ou experimente a demonstração.',
    2: 'Dados reconhecidos. Confira o mapeamento e os parâmetros antes de calcular.',
    3: 'Análise concluída. Explore os resultados, os detalhes e as exportações.'
  };
  for (const number of [1, 2, 3]) {
    const button = el(`workflowStep${number}`);
    if (!button) continue;
    const available = number === 1 || (number === 2 && hasData) || (number === 3 && hasResults);
    button.disabled = !available;
    button.classList.toggle('is-active', number === nextStage);
    button.classList.toggle('is-complete', number < nextStage && available);
    if (number === nextStage) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  const status = el('workflowStatus');
  if (status) status.textContent = copy[nextStage];
  syncMobileCalculateDock();
}
function navigateWorkflowStep(step) {
  const target = step === 1 ? el('inputStep') : step === 2 ? el('setupPanel') : el('resultsSection');
  if (!target || target.classList.contains('hidden')) return;
  setWorkflowStage(step);
  if (target.matches('section, aside, article')) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderValidationSummary(parsed) {
  const summary = el('validationSummary');
  if (!summary || !parsed) return;
  const rowCount = parsed.rows.length;
  let timeCount = 0;
  const rateColumns = parsed.rates || [];
  const bandCounts = rateColumns.map(() => 0);
  // One pass for time validity/band counts; one bounded Set avoids creating multiple
  // full-size arrays merely to warn about duplicate timestamps in huge files.
  const inspectDuplicateTimes = rowCount <= 250000;
  const seenTimes = inspectDuplicateTimes ? new Set() : null;
  let repeatedTimes = false;
  for (const row of parsed.rows) {
    const time = row[parsed.time];
    if (Number.isFinite(time)) {
      timeCount++;
      if (seenTimes) { if (seenTimes.has(time)) repeatedTimes = true; else seenTimes.add(time); }
    }
    for (let band = 0; band < rateColumns.length; band++) {
      const column = rateColumns[band];
      if (Number.isInteger(column) && column >= 0 && Number.isFinite(row[column])) bandCounts[band]++;
    }
  }
  const mappedBands = bandCounts.filter(count => count >= 4).length;
  const warnings = [];
  if (timeCount < 4) warnings.push('Há poucas observações com tempo válido.');
  if (mappedBands < 3) warnings.push('Menos de três bandas têm pontos suficientes; confira o mapeamento antes de interpretar comparações.');
  if (rowCount > 100000) warnings.push('Arquivo grande: os gráficos podem demorar para renderizar, mas os dados originais não serão descartados.');
  if (inspectDuplicateTimes && repeatedTimes) warnings.push('Há tempos repetidos; confira se eles são válidos para o instrumento e para a análise.');
  if (!inspectDuplicateTimes) warnings.push('O arquivo é muito grande; a verificação automática de tempos repetidos foi omitida para poupar memória.');
  if (parsed.rows.length > 0 && timeCount / parsed.rows.length < 0.8) warnings.push('Mais de 20% das linhas não têm tempo numérico válido. Confira a coluna de tempo.');
  summary.innerHTML = `<div class="validation-summary-head"><strong>Arquivo reconhecido</strong><span>${warnings.length ? 'verifique os avisos' : 'pronto para revisar'}</span></div><div class="validation-stats"><div><strong>${rowCount.toLocaleString('pt-BR')}</strong><span>linhas lidas</span></div><div><strong>${parsed.header.length.toLocaleString('pt-BR')}</strong><span>colunas</span></div><div><strong>${mappedBands}/8</strong><span>bandas com ≥ 4 pontos</span></div></div><p>${warnings.length ? warnings.map(escapeHtml).join(' ') : 'A leitura inicial terminou. O mapeamento automático é uma sugestão: confirme tempo, fluxo e erros antes do cálculo.'}</p>`;
  summary.classList.remove('hidden');
  summary.classList.toggle('has-warning', warnings.length > 0);
}
function renderDataPreview() {
  const box = el('dataPreview'), plot = el('dataPreviewPlot'), label = el('dataPreviewLabel');
  if (!box || !plot || !state.table || !state.dataRows.length) return;
  const timeIdx = Number(el('timeColumn')?.value ?? state.timeIndex);
  let selectedBand = -1, rateIdx = -1;
  for (let i = 0; i < 8; i++) {
    const candidate = Number(el(`rate-${i}`)?.value ?? -1);
    if (candidate >= 0) { selectedBand = i; rateIdx = candidate; break; }
  }
  if (rateIdx < 0) { box.classList.add('hidden'); return; }
  const stride = Math.max(1, Math.ceil(state.dataRows.length / 900));
  const sampled = [];
  let nValid = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < state.dataRows.length; i++) {
    const row = state.dataRows[i], x = row[timeIdx], y = row[rateIdx];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    nValid++; min = Math.min(min, y); max = Math.max(max, y);
    if (i % stride === 0 || i === state.dataRows.length - 1) sampled.push({x, y});
  }
  if (nValid < 2) { box.classList.add('hidden'); return; }
  sampled.sort((a,b) => a.x-b.x);
  const width=480,height=106,pad=8,range=max-min || 1;
  const points=sampled.map((p,i)=>`${(pad+(sampled.length===1?0:i/(sampled.length-1))*(width-pad*2)).toFixed(2)},${(height-pad-((p.y-min)/range)*(height-pad*2)).toFixed(2)}`).join(' ');
  const def = state.bandDefs[selectedBand] || BAND_DEFS[selectedBand];
  if (label) label.textContent = `${def?.name || `Banda ${selectedBand+1}`} · ${nValid.toLocaleString('pt-BR')} pontos válidos`;
  plot.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Prévia de ${escapeHtml(def?.name || `banda ${selectedBand+1}`)} com ${nValid} pontos"><line x1="8" y1="${height-8}" x2="${width-8}" y2="${height-8}" stroke="rgba(150,166,193,.35)"/><polyline points="${points}" fill="none" stroke="${def?.color || '#5cdec2'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><div class="data-preview-range"><span>mín. ${formatNum(min,5)}</span><span>máx. ${formatNum(max,5)}</span></div>`;
  box.classList.remove('hidden');
}
async function sha256ForBuffer(buffer) {
  try {
    if (window.crypto?.subtle?.digest) {
      const hash = await window.crypto.subtle.digest('SHA-256', buffer);
      return 'SHA-256:' + [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  } catch (_) {}
  // Fallback for local previews: yield per MiB to avoid freezing the main thread.
  const bytes = new Uint8Array(buffer); let hash = 2166136261; const chunk = 1024 * 1024;
  for (let start = 0; start < bytes.length; start += chunk) {
    const stop = Math.min(bytes.length, start + chunk);
    for (let i = start; i < stop; i++) { hash ^= bytes[i]; hash = Math.imul(hash, 16777619); }
    if (stop < bytes.length) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return 'FNV-1a-32-fallback:' + (hash >>> 0).toString(16).padStart(8,'0');
}

function syncMobileCalculateDock() {
  const dock=el('mobileCalculateDock'), button=el('mobileAnalyzeBtn'), status=el('mobileCalculateStatus');
  if(!dock||!button)return;
  const mobile=window.matchMedia?.('(max-width: 760px)').matches;
  const setupVisible=Boolean(el('setupPanel')&&!el('setupPanel').classList.contains('hidden'));
  const ready=Boolean(state.parsed&&state.dataRows.length&&button.dataset.busy!=='true');
  dock.classList.toggle('hidden', !(mobile && setupVisible));
  button.disabled=!ready;
  if(status) status.textContent=button.dataset.busy==='true'?'Cálculo em andamento…':ready?'Parâmetros prontos. Calcule quando quiser.':'Carregue os dados primeiro.';
}
function saveUiConfig() {
  try { localStorage.setItem('mel-v016-settings', JSON.stringify({m:el('embedding')?.value || '2',r:el('tolerance')?.value || '0.2',source:el('sourceName')?.value || '',instrument:el('instrumentName')?.value || ''})); } catch (_) {}
}
function updateToleranceControls(source='number') {
  const number=el('tolerance'), slider=el('toleranceSlider'), output=el('toleranceValue');
  if(!number)return;
  const value=Number(source==='slider' ? slider?.value : number.value);
  if(!Number.isFinite(value)||value<=0)return;
  if(source==='slider'&&slider) number.value=String(value);
  if(source!=='slider'&&slider) slider.value=String(Math.min(Number(slider.max),Math.max(Number(slider.min),value)));
  if(output) output.textContent=`${value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} × σ`;
  saveUiConfig();
}
function showDependencyHealth() {
  const notice=el('dependencyNotice'); if(!notice)return;
  const missing=[];
  if(!window.Chart) missing.push('Chart.js (desenho dos gráficos)');
  if(!window.pako) missing.push('pako (leitura de arquivos gzip)');
  if(window.Chart && !window.ChartZoom) missing.push('plugin de zoom (Ctrl + roda/arraste e pinça podem ficar indisponíveis)');
  if(missing.length) {
    notice.innerHTML=`<strong>Dependência não carregada</strong><span>Não foi possível iniciar: ${missing.map(escapeHtml).join(', ')}. Verifique a conexão e recarregue a página. O restante da interface pode abrir, mas a função afetada ficará indisponível.</span>`;
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
    notice.classList.remove('is-info');
  }
}

function setAnalysisProgress(percent, label, detail = '') {
  const wrap = el('analysisProgress');
  if (!wrap) return;
  wrap.classList.remove('hidden');
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  el('analysisProgressBar').value = safePercent;
  el('analysisProgressPercent').textContent = `${safePercent}%`;
  el('analysisProgressLabel').textContent = label;
  el('analysisProgressDetail').textContent = detail;
}
function createScienceWorker() {
  if (typeof Worker !== 'function') return null;
  return new Worker(new URL('analysis-worker.js', document.baseURI));
}
function runScienceTask(payload, onProgress) {
  const requestId = ++state.workerRequestId;
  let worker;
  try { worker = createScienceWorker(); } catch (_) { worker = null; }
  if (!worker) return runScienceTaskInline(payload, onProgress);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; worker.terminate(); callback(value); };
    worker.onmessage = event => {
      const data = event.data || {};
      if (data.requestId !== requestId) return;
      if (data.type === 'progress') { if (onProgress) onProgress(data); return; }
      if (data.type === 'result') finish(resolve, data.results);
      else if (data.type === 'match-pairs') finish(resolve, data.matchPairs);
      else if (data.type === 'error') finish(reject, new Error(data.message || 'Falha no worker científico.'));
    };
    worker.onerror = () => finish(reject, new Error('O worker científico não iniciou corretamente.'));
    worker.postMessage({ ...payload, requestId });
  }).catch(error => {
    console.warn('Worker científico indisponível; usando fallback no navegador.', error);
    return runScienceTaskInline(payload, onProgress);
  });
}
async function runScienceTaskInline(payload, onProgress) {
  if (payload.type === 'match-pairs') {
    return sampleEntropy(payload.series || [], payload.m, payload.tolerance, { maxMatchPairs: 12 }).matchPairs || { m: [], mPlus1: [], maxStoredPerDimension: 12 };
  }
  if (payload.type === 'sensitivity') {
    const cells=[], combinations=(payload.mValues||[]).length*(payload.rValues||[]).length; let completed=0;
    for (const m of payload.mValues||[]) for (const r of payload.rValues||[]) {
      await new Promise(resolve=>setTimeout(resolve,0));
      const sample=sampleEntropy(payload.series||[],m,r);
      cells.push({m,r,value:sample.value,A:sample.A,B:sample.B,reason:sample.reason}); completed++;
      onProgress?.({phase:'cell',completed,total:combinations,m,r});
    }
    return cells;
  }
  if (payload.type !== 'analyze') throw new Error('Tarefa científica desconhecida.');
  const results = [];
  for (let index = 0; index < payload.bands.length; index++) {
    const band = payload.bands[index];
    const progress = { index: index + 1, total: payload.bands.length, label: band.label, points: band.points.length };
    onProgress?.({ ...progress, phase: 'start' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const sample = sampleEntropy(band.points.map(point => point.y), payload.m, payload.tolerance);
    const modulation = window.EntropyCore.intrinsicModulation(band.points.map(point => ({ y: point.y, error: point.error })), band.errorIndex >= 0);
    results.push({ sample, modulation });
    onProgress?.({ ...progress, phase: 'done' });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return results;
}
function normName(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function numericToken(s) { if (s == null) return null; const t = String(s).trim().replace(/,/g, '.'); if (!t || /^(-|--|nan|nan\(|null|none|indef|inf|\*+)$/i.test(t)) return null; const v = Number(t); return Number.isFinite(v) ? v : null; }
function splitLine(line, delimiter) { if (delimiter === 'comma') return line.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')); if (delimiter === 'semicolon') return line.split(';').map(x => x.trim().replace(/^['"]|['"]$/g, '')); if (delimiter === 'tab') return line.split(/\t+/).map(x => x.trim()); return line.trim().split(/\s+/); }

function detectDelimiter(lines) {
  const sample = lines.filter(x => x.trim() && !x.trim().startsWith('#')).slice(0, 8).join('\n');
  const counts = { comma: (sample.match(/,/g) || []).length, semicolon: (sample.match(/;/g) || []).length, tab: (sample.match(/\t/g) || []).length };
  if (counts.comma > 0 && counts.comma >= counts.semicolon && counts.comma >= counts.tab) return 'comma';
  if (counts.semicolon > 0 && counts.semicolon > counts.comma && counts.semicolon >= counts.tab) return 'semicolon';
  if (counts.tab > 0) return 'tab';
  return 'whitespace';
}
function looksLikeHeader(tokens) { return tokens.some(t => /time|mjd|date|rate|count|error|err|band|energy|flux|exposure|cent_rate|bkg_var/i.test(t)) && tokens.some(t => /time|mjd|date|rate|count|error|err|band|energy|flux/i.test(t)); }
function findTimeColumn(header) { const rx = [/^mjd$/, /time/, /date/, /day/]; for (const pat of rx) { const i = header.findIndex(h => pat.test(normName(h))); if (i >= 0) return i; } return 0; }
function explicitBandScore(name, bandNum, aliases) { const n = normName(name); let score = 0; if (new RegExp(`\\b(?:band|b) ?0?${bandNum}\\b`).test(n)) score += 5; if (n.includes(aliases[0]) || n.includes(aliases[1])) score += 5; if (/rate|count|flux|cent/.test(n)) score += 1; if (/err|error|sigma|uncert|bkg var/.test(n)) score -= 4; return score; }
function guessColumnMap(header, nCols) {
  const time = findTimeColumn(header);
  const rates = [], errors = [];
  const aliases = [['14 20','14 20'], ['20 24','20 24'], ['24 35','24 35'], ['35 50','35 50'], ['50 75','50 75'], ['75 100','75 100'], ['100 150','100 150'], ['150 195','150 195']];
  const unused = new Set(Array.from({ length:nCols }, (_,i)=>i).filter(i=>i!==time));
  for (let b = 0; b < 8; b++) {
    const scores = [...unused].map(i => ({i, score: explicitBandScore(header[i] || '', b+1, aliases[b])})).sort((a,c)=>c.score-a.score);
    const candidate = scores[0] && scores[0].score >= 5 ? scores[0].i : null;
    if (candidate != null) { rates[b] = candidate; unused.delete(candidate); } else rates[b] = null;
  }
  // Swift-BAT snapshot tables commonly store a time column, nine rates (8 bands + total), then nine errors.
  // When headers are not informative, offer a conservative default and expose every selector for correction.
  if (rates.filter(x=>x != null).length < 8) {
    const possible = Array.from({length:nCols},(_,i)=>i).filter(i=>i!==time);
    let defaultRates;
    if (nCols >= 19) defaultRates = possible.slice(0,8); // time + 8 band-rate columns; total-rate may follow
    else if (nCols >= 9) defaultRates = possible.slice(0,8);
    else defaultRates = possible.slice(0, Math.min(8, possible.length));
    for (let b=0;b<8;b++) if (rates[b] == null) rates[b] = defaultRates[b] ?? null;
  }
  // Error columns are only selected when column names make them explicit or the table resembles rate+error groups.
  for (let b=0;b<8;b++) {
    const rn = normName(header[rates[b]] || '');
    const energyAlias = aliases[b][0];
    const e = header.findIndex((h,i)=>i!==rates[b] && (/error|err|sigma|bkg var|uncert/.test(normName(h))) && (normName(h).includes(energyAlias) || new RegExp(`(?:band|b) ?0?${b+1}\\b`).test(normName(h))));
    errors[b] = e >= 0 ? e : null;
    if (errors[b] == null && /^(?:rate|cent rate) ?\d*$/.test(rn) && nCols >= 18) {
      const likely = rates[b] + 9; if (likely < nCols && likely !== time) errors[b] = likely;
    }
  }
  return {time, rates, errors};
}

async function parseTextTable(text, filename = 'dados') {
  if (text.includes('\u0000')) throw new Error('O arquivo parece ser binário (por exemplo, FITS). Use um FITS compatível com o leitor ou exporte a tabela como ASCII/CSV.');
  fileStatus(`Preparando tabela de texto · ${fileSizeLabel(text.length)}…`, 'loading');
  await new Promise(resolve => setTimeout(resolve, 0));
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const delimiter = detectDelimiter(lines);
  let header = null, headerLine = -1;
  const body = [];
  for (let i=0; i<lines.length; i++) {
    if (i > 0 && i % 5000 === 0) {
      fileStatus(`Lendo tabela de texto · ${i.toLocaleString('pt-BR')} de ${lines.length.toLocaleString('pt-BR')} linhas…`, 'loading');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const raw=lines[i].trim(); if (!raw) continue;
    const cleaned = raw.replace(/^#+\s?/, '');
    const tokens = splitLine(cleaned, delimiter);
    const numericCount = tokens.filter(t => numericToken(t) !== null).length;
    if (header === null && looksLikeHeader(tokens) && numericCount < tokens.length * 0.65) { header = tokens; headerLine = i; continue; }
    if (raw.startsWith('#')) continue;
    if (numericCount >= Math.min(2, tokens.length)) body.push({line:i+1, tokens});
  }
  if (!body.length) throw new Error('Não encontrei linhas numéricas no arquivo. Verifique se o arquivo foi descompactado corretamente e está em formato ASCII.');
  const nCols = body.reduce((max, row) => Math.max(max, row.tokens.length), 0);
  if (nCols < 2) throw new Error('A tabela precisa ter uma coluna de tempo e ao menos uma coluna de medidas.');
  // Align labels to numeric row width; if there is no recognizable header, build editable generic labels.
  if (!header || header.length !== nCols || !looksLikeHeader(header)) header = Array.from({length:nCols},(_,i)=>`Coluna ${i+1}`);
  else if (header.length < nCols) header = [...header, ...Array.from({length:nCols-header.length},(_,i)=>`Coluna ${header.length+i+1}`)];
  const rows = [];
  const rowChunkSize = 8000;
  for (let start = 0; start < body.length; start += rowChunkSize) {
    const end = Math.min(body.length, start + rowChunkSize);
    for (let index = start; index < end; index++) {
      const row = body[index];
      rows.push(Array.from({length:nCols},(_,i)=>numericToken(row.tokens[i])));
    }
    if (end < body.length) {
      fileStatus(`Convertendo valores · ${end.toLocaleString('pt-BR')} de ${body.length.toLocaleString('pt-BR')} linhas…`, 'loading');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const map = guessColumnMap(header,nCols);
  return {filename, header, rows, delimiter, ...map, rawLines: lines.length, headerLine};
}

async function readFileBuffer(file) {
  let buffer = await file.arrayBuffer();
  const u8 = new Uint8Array(buffer);
  // Decide from the file signature, not the extension: some browsers save an already-decoded response with a .gz name.
  const isGzip = u8[0] === 0x1f && u8[1] === 0x8b;
  if (isGzip) {
    let decompressed=false;
    if (typeof DecompressionStream !== 'undefined') {
      try { const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')); buffer = await new Response(stream).arrayBuffer(); decompressed=true; } catch (_) {}
    }
    if(!decompressed && window.pako && typeof window.pako.ungzip==='function') {
      try { buffer=window.pako.ungzip(new Uint8Array(buffer)).buffer; decompressed=true; } catch (_) {}
    }
    if(!decompressed) throw new Error('O arquivo tem assinatura gzip, mas não foi possível descompactá-lo. Confira se o download terminou ou tente baixá-lo novamente.');
  }
  return buffer;
}

function fitsCardValue(card) {
  let raw = card.slice(10).trim();
  if (!raw) return '';
  let inQuote = false, out = '';
  for (let i=0;i<raw.length;i++) {
    const c=raw[i];
    if (c==="'") { if (inQuote && raw[i+1]==="'") { out += "''"; i++; continue; } inQuote=!inQuote; out+=c; continue; }
    if (c==='/' && !inQuote) break;
    out+=c;
  }
  out=out.trim();
  if (out.startsWith("'")) return out.slice(1,out.lastIndexOf("'")).replace(/''/g,"'").trim();
  if (out==='T') return true; if (out==='F') return false;
  const n=Number(out); return out!=='' && Number.isFinite(n) ? n : out;
}
function readFitsHeader(bytes, start) {
  const decoder=new TextDecoder('ascii'); const header={}; let pos=start, ended=false, cards=0;
  while(pos+80<=bytes.length && !ended) {
    const card=decoder.decode(bytes.subarray(pos,pos+80)); pos+=80; cards++;
    const key=card.slice(0,8).trim();
    if(key==='END'){ended=true;break;}
    if(key && card[8]==='=') header[key]=fitsCardValue(card);
  }
  if(!ended) throw new Error('Cabeçalho FITS inválido ou incompleto.');
  const headerBytes=Math.ceil((cards*80)/2880)*2880;
  return {header, dataStart:start+headerBytes};
}
function fitsFormat(form) {
  const raw=String(form||'').trim().toUpperCase();
  const variable=raw.match(/^(\d*)([PQ])([LXBIJKAEDCM])(?:\((\d+)\))?$/);
  if(variable){
    const repeat=Number(variable[1]||1),code=variable[2],elementCode=variable[3];
    return {repeat,code,width:repeat*(code==='P'?8:16),elementCode,maxElements:variable[4]?Number(variable[4]):null,variable:true};
  }
  const m=raw.match(/^(\d*)([A-Z])(?:\((\d+)\))?/);
  if(!m) throw new Error(`Formato de coluna FITS não reconhecido: ${form}`);
  const repeat=Number(m[1]||1), code=m[2];
  const sizeMap={L:1,A:1,B:1,I:2,J:4,K:8,E:4,D:8,C:8,M:16,X:0};
  if(!(code in sizeMap)) throw new Error(`Tipo FITS não suportado: ${code}`);
  const width=code==='X'?Math.ceil(repeat/8):repeat*sizeMap[code];
  return {repeat,code,width,variable:false};
}
function fitsReadScalar(view, offset, code) {
  switch(code){case 'L': return String.fromCharCode(view.getUint8(offset))==='T'?1:0;case 'B': return view.getUint8(offset);case 'I': return view.getInt16(offset,false);case 'J': return view.getInt32(offset,false);case 'K': return Number(view.getBigInt64(offset,false));case 'E': return view.getFloat32(offset,false);case 'D': return view.getFloat64(offset,false);case 'C': return view.getFloat32(offset,false);case 'M': return view.getFloat64(offset,false);default:return null;}
}
async function parseFitsBuffer(buffer, filename) {
  const bytes=new Uint8Array(buffer); const decoder=new TextDecoder('ascii');
  if(decoder.decode(bytes.subarray(0,8)).trim()!=='SIMPLE') throw new Error('O arquivo não parece ser um FITS válido.');
  let offset=0, chosen=null, hduCount=0;
  while(offset+2880<=bytes.length && hduCount<30) {
    const {header,dataStart}=readFitsHeader(bytes,offset); hduCount++;
    const xtension=String(header.XTENSION||'').trim().toUpperCase();
    const naxis=Number(header.NAXIS||0), bitpix=Math.abs(Number(header.BITPIX||8));
    let rawDataSize=0;
    if(naxis>0){let dims=1;for(let n=1;n<=naxis;n++)dims*=Number(header[`NAXIS${n}`]||0);rawDataSize=(bitpix/8)*dims+Number(header.PCOUNT||0);if(Number(header.GCOUNT||1)>1)rawDataSize*=Number(header.GCOUNT||1);}
    if(xtension.includes('BINTABLE')) {
      const nRows=Number(header.NAXIS2||0), rowWidth=Number(header.NAXIS1||0), nFields=Number(header.TFIELDS||0), cols=[];let cursor=0;
      for(let c=1;c<=nFields;c++){
        const name=String(header[`TTYPE${c}`]||`COL${c}`).trim();const format=fitsFormat(header[`TFORM${c}`]);
        cols.push({name,format,offset:cursor,unit:header[`TUNIT${c}`]||''});cursor+=format.width;
      }
      if(nRows>0 && rowWidth>0 && dataStart+rowWidth*nRows<=bytes.length) {
        const hasTime=cols.some(c=>/time|mjd|date/i.test(c.name));
        const hasRate=cols.some(c=>/(rate|flux|count|cent)/i.test(c.name) && !/(err|error|sigma)/i.test(c.name) && (c.format.repeat>=8 || (c.format.variable && /[PQ]/.test(c.format.code))));
        if(hasTime && hasRate){chosen={header,cols,nRows,rowWidth,dataStart};break;}
      }
    }
    const padded=Math.ceil(rawDataSize/2880)*2880;offset=dataStart+padded;
  }
  if(!chosen) throw new Error('O FITS foi reconhecido, mas não encontrei uma tabela BINTABLE com tempo e um vetor multibanda. Selecione/exporte a tabela RATE para CSV/ASCII, ou envie um arquivo FITS com colunas de taxa explícitas.');
  const {header,cols,nRows,rowWidth,dataStart}=chosen;const view=new DataView(buffer);const swift=/swift|bat/i.test(filename);const energyLabels=['14_20','20_24','24_35','35_50','50_75','75_100','100_150','150_195','14_195'];
  const heapStart=dataStart+Number(header.THEAP??(rowWidth*nRows));
  const outHeader=[], layout=[];
  for(const col of cols){
    const normalized=normName(col.name);const isTime=/^time$|^mjd$|date/.test(normalized);const isError=/(err|error|sigma|uncert|bkg var)/.test(normalized);const isRates=/(rate|flux|count|cent)/.test(normalized)&&!isError;
    if(col.format.code==='X') continue;
    if(col.format.variable){
      if(swift && (isRates||isError)){
        for(let k=0;k<9;k++){const label=`${isError?'ERR':'RATE'}_${energyLabels[k]}`;outHeader.push(label);layout.push({col,index:k,label,variable:true});}
      } else if(isTime){outHeader.push(col.name);layout.push({col,index:0,label:col.name,variable:true});}
      else if(/rate|flux|count|cent/i.test(col.name)){for(let k=0;k<8;k++){const label=`${col.name}_${k+1}`;outHeader.push(label);layout.push({col,index:k,label,variable:true});}}
      continue;
    }
    for(let k=0;k<col.format.repeat;k++){
      let label;
      if(col.format.repeat===1)label=col.name;
      else if(swift && (isRates||isError) && k<9){const e=energyLabels[k];label=`${isError?'ERR':'RATE'}_${e}`;}
      else label=`${col.name}_${k+1}`;
      outHeader.push(label);layout.push({col,index:k,label,variable:false});
    }
  }
  const rows=[];
  for(let r=0;r<nRows;r++){
    if (r > 0 && r % 2000 === 0) {
      fileStatus(`Lendo tabela FITS · ${r.toLocaleString('pt-BR')} de ${nRows.toLocaleString('pt-BR')} linhas…`, 'loading');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const base=dataStart+r*rowWidth, values=[];
    for(const item of layout){const {col,index}=item;const {code}=col.format;let value=null;const at=base+col.offset;
      if(item.variable && (code==='P'||code==='Q')){
        const descAt=at+index* (code==='P'?8:16);
        const count=code==='P'?view.getInt32(descAt,false):Number(view.getBigInt64(descAt,false));
        const heapOffset=code==='P'?view.getInt32(descAt+4,false):Number(view.getBigInt64(descAt+8,false));
        const elementCode=col.format.elementCode;const elementBytes=({L:1,B:1,I:2,J:4,K:8,E:4,D:8,C:8,M:16,A:1})[elementCode]||0;
        if(count>index && elementBytes>0 && heapOffset>=0){const pos=heapStart+heapOffset+index*elementBytes;if(pos+elementBytes<=bytes.length)value=fitsReadScalar(view,pos,elementCode);}
      } else if(code==='A'){value=decoder.decode(bytes.subarray(at,at+col.format.repeat)).trim();}
      else value=fitsReadScalar(view,at+index*col.format.width/col.format.repeat,code);
      values.push(typeof value==='number'&&Number.isFinite(value)?value:null);
    }
    rows.push(values);
  }
  const parsedMap=guessColumnMap(outHeader,outHeader.length);
  return {filename,header:outHeader,rows,delimiter:'fits',...parsedMap,rawLines:nRows,headerLine:-1,fits:true,units:cols.map(c=>c.unit)};
}

function populateMapping(parsed) {
  const swiftProfile = /swift|bat/i.test(parsed.filename || '') || parsed.header.some(h => /14.?20|20.?24|24.?35|35.?50|50.?75|75.?100|100.?150|150.?195/i.test(String(h)));
  state.bandDefs = BAND_DEFS.map((b,i) => ({...b, name: swiftProfile ? b.name : `Banda ${i+1}`, short: swiftProfile ? b.short : `B${i+1}`}));
  state.table = parsed; state.header = parsed.header; state.dataRows = parsed.rows; state.delimiter = parsed.delimiter; state.fileName = parsed.filename;
  state.timeIndex = parsed.time; state.bandIndices = parsed.rates.slice(); state.errorIndices = parsed.errors.slice(); state.timeLabel = parsed.header[parsed.time] || 'Tempo';
  const area = el('mappingArea');
  const options = parsed.header.map((name,i)=>`<option value="${i}">${escapeHtml(`${i+1}. ${name}`)}</option>`).join('');
  const timeSelect = `<select id="timeColumn" aria-label="Coluna de tempo">${options}</select>`;
  const selectFor = (id, val, label) => `<select id="${id}" aria-label="${escapeHtml(label)}"><option value="-1">— não usar —</option>${options}</select>`;
  area.innerHTML = `<div class="mapping-card-grid">${state.bandDefs.map((b,i)=>`<article class="mapping-card" data-band-index="${i}"><div class="mapping-card-heading"><span class="mapping-band-swatch" style="--band-color:${b.color}"></span><strong>${escapeHtml(b.name)}</strong><span class="mapping-band-number">B${i+1}</span></div><label class="field"><span>Taxa / fluxo</span>${selectFor(`rate-${i}`, parsed.rates[i], `Taxa de ${b.name}`)}</label><label class="field"><span>Erro / incerteza (opcional)</span>${selectFor(`err-${i}`, parsed.errors[i], `Erro de ${b.name}`)}</label><label class="field"><span>Rótulo da banda</span><input class="band-label-input" id="label-${i}" value="${escapeHtml(b.name)}" aria-label="Rótulo da banda ${i+1}" maxlength="60"></label></article>`).join('')}</div><div class="mapping-time"><label class="field"><span>Coluna de tempo</span>${timeSelect}</label></div>`;
  const tc=el('timeColumn'); tc.value=String(parsed.time);
  for (let i=0;i<8;i++) { const rs=el(`rate-${i}`), es=el(`err-${i}`), label=el(`label-${i}`); rs.value=String(parsed.rates[i] ?? -1); es.value=String(parsed.errors[i] ?? -1); rs.addEventListener('change',()=>{state.bandIndices[i]=Number(rs.value)>=0?Number(rs.value):null;renderDataPreview();}); es.addEventListener('change',()=>{state.errorIndices[i]=Number(es.value)>=0?Number(es.value):null;renderDataPreview();}); label.addEventListener('change',()=>{const text=label.value.trim()||`Banda ${i+1}`;state.bandDefs[i].name=text;state.bandDefs[i].short=text;}); label.addEventListener('blur',()=>{const text=label.value.trim()||`Banda ${i+1}`;state.bandDefs[i].name=text;state.bandDefs[i].short=text;renderDataPreview();}); }
  tc.addEventListener('change',()=>{state.timeIndex=Number(tc.value);state.timeLabel=parsed.header[state.timeIndex]||'Tempo';renderDataPreview();});
  el('mappingCount').textContent=`${parsed.header.length} colunas detectadas`;
  el('dataBadge').textContent='DADOS CARREGADOS';
  el('setupPanel')?.classList.remove('hidden');
  el('resultsSection')?.classList.add('hidden');
  el('demoResultsNotice')?.classList.add('hidden');
  state.parsed = true;
  applyPendingSessionMapping();
  renderValidationSummary(parsed);
  renderDataPreview();
  setWorkflowStage(2);
  el('analyzeBtn').disabled=false;
  syncMobileCalculateDock();
  if(window.matchMedia?.('(max-width: 760px)').matches) setTimeout(()=>navigateWorkflowStep(2),90);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function labelLikelyRates(rows, nCols) { return rows.length > 1 && nCols > 1; }

async function handleFile(file) {
  if (!file) return;
  state.parsed=false; state.demoMode=false; state.results=[]; state.latestAnalysis=null;
  destroyCharts();
  el('setupPanel')?.classList.add('hidden');
  el('resultsSection')?.classList.add('hidden');
  el('validationSummary')?.classList.add('hidden');
  el('demoResultsNotice')?.classList.add('hidden');
  el('individualCurvesDetails')?.removeAttribute('open');
  el('analysisProgress')?.classList.add('hidden');
  el('analyzeBtn').disabled=true;
  setWorkflowStage(1);
  fileStatus(`Lendo e validando ${file.name}…`, 'loading');
  message('');
  try {
    const buffer = await readFileBuffer(file);
    state.fileHash = await sha256ForBuffer(buffer);
    const bytes = new Uint8Array(buffer);
    const looksFits = new TextDecoder('ascii').decode(bytes.subarray(0,8)).trim() === 'SIMPLE';
    const parsed = looksFits ? await parseFitsBuffer(buffer,file.name) : await parseTextTable(new TextDecoder('utf-8',{fatal:false}).decode(buffer),file.name);
    const sessionToRestore = state.pendingSession;
    populateMapping(parsed);
    if (sessionToRestore?.analysis?.source) el('sourceName').value=String(sessionToRestore.analysis.source).slice(0,160);
    else el('sourceName').value = file.name.replace(/\.(lc|txt|csv|tsv|dat)(\.gz)?$/i,'').replace(/^BAT_157m_eight_band_snapshot_/i,'').replaceAll('_',' ');
    if (sessionToRestore?.analysis?.instrument) el('instrumentName').value=String(sessionToRestore.analysis.instrument).slice(0,100);
    else if (/swift|bat/i.test(file.name)) el('instrumentName').value='Swift-BAT';
    saveUiConfig();
    fileStatus(`${file.name} · ${parsed.rows.length.toLocaleString('pt-BR')} linhas · ${parsed.header.length} colunas`, 'success');
    message('Verifique o mapeamento das colunas antes de calcular. Os valores sugeridos pelo site são editáveis.');
    state.parsed=true;
  } catch (err) {
    fileStatus(err.message || 'Erro ao ler arquivo.', 'error');
    message(err.message || 'Erro ao ler arquivo.', 'error');
    el('setupPanel')?.classList.add('hidden');
    el('validationSummary')?.classList.add('hidden');
    el('analyzeBtn').disabled=true; el('mappingCount').textContent='—'; el('dataBadge').textContent='ERRO NA LEITURA';
    setWorkflowStage(1);
  }
}

// The validated scientific core is shared by full-series and temporal-window analyses.
function sampleEntropy(series, m, toleranceMultiplier, options = {}) {
  if (!window.EntropyCore || typeof window.EntropyCore.sampleEntropy !== 'function') {
    throw new Error('O núcleo científico analysis-core.js não carregou. Recarregue a página e confira se o arquivo está na raiz do projeto.');
  }
  return window.EntropyCore.sampleEntropy(series, m, toleranceMultiplier, options);
}
function mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function std(arr) { if (!arr.length) return null; const m=mean(arr); return Math.sqrt(mean(arr.map(v=>(v-m)**2))); }
function formatNum(v,d=3) { return Number.isFinite(v) ? v.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—'; }
function formatInt(v) { return Number(v).toLocaleString('pt-BR'); }
function parseTime(v) { return Number.isFinite(v) ? v : null; }
function getRowsFromMap() {
  const timeIdx=Number(el('timeColumn').value); state.timeIndex=timeIdx;
  const bands=[];
  for(let i=0;i<8;i++) {
    const ri=Number(el(`rate-${i}`).value), ei=Number(el(`err-${i}`).value);
    state.bandIndices[i]=ri>=0?ri:null; state.errorIndices[i]=ei>=0?ei:null;
    const points=[];
    for(const row of state.dataRows) {
      const t=row[timeIdx], y=ri>=0?row[ri]:null, err=ei>=0?row[ei]:null;
      if (Number.isFinite(t) && Number.isFinite(y)) points.push({x:t,y,error:Number.isFinite(err)?err:null});
    }
    points.sort((a,b)=>a.x-b.x);
    bands.push({def:state.bandDefs[i],points,rawValues:points.map(p=>p.y),errorIndex:ei});
  }
  return bands;
}
function timeUnitLabel(header) { const n=normName(header); if(n.includes('mjd')) return 'MJD'; if(n.includes('time')) return 'Tempo'; if(n.includes('date')) return 'Data'; if(n.includes('day')) return 'Dias'; return header || 'Tempo'; }
function timeCadence(points) {
  const diffs=[]; for(let i=1;i<points.length;i++){const d=points[i].x-points[i-1].x;if(d>0&&Number.isFinite(d))diffs.push(d);}
  if(diffs.length<2) return {median:null,cv:null};
  const med=[...diffs].sort((a,b)=>a-b)[Math.floor(diffs.length/2)]; const m=mean(diffs);return {median:med,cv:m?std(diffs)/m:null};
}

async function analyze() {
  if(!state.parsed || !state.dataRows.length) {message('Carregue um arquivo primeiro.','error');return false;}
  const m=Number(el('embedding').value), r=Number(el('tolerance').value);
  if(!Number.isInteger(m)||m<1||m>4){message('A dimensão m precisa ser um inteiro entre 1 e 4.','error');return false;}
  if(!Number.isFinite(r)||r<=0||r>2){message('A tolerância precisa ser maior que zero e não pode exceder 2σ.','error');return false;}
  const bands=getRowsFromMap();
  if(bands.every(b=>!b.points.length)){message('Nenhuma banda tem dados válidos. Confira o mapeamento das colunas.','error');return false;}
  message('');
  setAnalysisProgress(0,'Preparando cálculos…','A análise usa as observações válidas de cada banda. O navegador continuará responsivo enquanto o núcleo científico calcula.');
  const payloadBands = bands.map(band=>({
    label: band.def.name,
    errorIndex: band.errorIndex,
    points: band.points.map(point=>({x:point.x,y:point.y,error:point.error}))
  }));
  const calculated = await runScienceTask({type:'analyze',bands:payloadBands,m,tolerance:r}, progress=>{
    const done = progress.phase === 'done';
    const completedBands = Math.max(0, progress.index - (done ? 0 : 1));
    const percent = progress.total ? (completedBands / progress.total) * 100 : 0;
    const phaseLabel = done ? 'Concluída' : 'Calculando';
    setAnalysisProgress(percent,`${phaseLabel} banda ${progress.index} de ${progress.total} · ${progress.label}`,`${formatInt(progress.points||0)} pontos válidos. O cálculo científico usa a série completa; reduções visuais não alteram os dados analisados.`);
  });
  const results=bands.map((band,index)=>{
    const computed=calculated[index]||{};
    const sample=computed.sample||{};
    const modulationResult=computed.modulation||{};
    const values=band.points.map(point=>point.y);
    return {
      ...band, ...sample,
      modulationIndex: modulationResult.value,
      modulationResult,
      mean:mean(values), std:std(values), n:values.length,
      cadence:timeCadence(band.points)
    };
  });
  const valid=results.filter(result=>Number.isFinite(result.value));
  state.results=results;state.latestAnalysis={m,r,source:el('sourceName').value.trim()||state.fileName,instrument:el('instrumentName').value.trim()||'Não informado',timeLabel:timeUnitLabel(state.table.header[state.timeIndex]),algorithmVersion:window.EntropyCore.VERSION,timestamp:new Date(),datasetHash:state.fileHash||'',datasetKind:state.demoMode?'SINTÉTICO':'DADOS DO USUÁRIO'};
  updateReproducibilityPanel();
  const sens=el('runSensitivityBtn'); if(sens) sens.disabled=!bands.some(b=>b.points.length>=8&&b.points.length<=3000);
  const sensSelect=el('sensitivityBandSelect'); if(sensSelect){ sensSelect.innerHTML=bands.map((b,i)=>`<option value="${i}" ${b.points.length<8||b.points.length>3000?'disabled':''}>${escapeHtml(b.def.name)} · ${b.points.length.toLocaleString('pt-BR')} pontos</option>`).join(''); const usable=bands.findIndex(b=>b.points.length>=8&&b.points.length<=3000); if(usable>=0)sensSelect.value=String(usable); }
  saveUiConfig();
  renderResults(results, valid);
  el('resultsSection').classList.remove('hidden');
  el('demoResultsNotice')?.classList.toggle('hidden',!state.demoMode);
  setAnalysisProgress(100,'Análise concluída','Resultados calculados no navegador. Você pode consultar a tabela, abrir as visualizações complementares ou exportar os resultados.');
  setWorkflowStage(3);
  el('resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
  const missing=results.filter(result=>!Number.isFinite(result.value)).length;
  message(missing?`Análise concluída. ${missing} banda(s) não produziram SampEn finita; veja a coluna Status.`:`Análise concluída para ${valid.length} de ${results.length} bandas com SampEn finita. Confira os avisos e a qualidade dos dados.`,'');
  return true;
}
function destroyCharts(){for(const c of state.charts){try{removeChartToolbar(c.canvas);c.destroy()}catch{}}state.charts=[];if(state.temporalSampenChart){try{removeChartToolbar(state.temporalSampenChart.canvas);state.temporalSampenChart.destroy()}catch{}state.temporalSampenChart=null;if(el('temporalSampenStatus'))el('temporalSampenStatus').textContent='Os dados mudaram. Recalcule a SampEn temporal para atualizar este gráfico.';}}
function chartDefaults(){
  const plugins={legend:{display:false},tooltip:{backgroundColor:'#0b1020',borderColor:'#35435f',borderWidth:1,titleColor:'#eaf1ff',bodyColor:'#bdcbe4',displayColors:false}};
  if (window.ChartZoom || (window.Chart && Chart.registry?.plugins?.get?.('zoom'))) {
    plugins.zoom={limits:{x:{min:'original',max:'original'},y:{min:'original',max:'original'}},pan:{enabled:true,mode:'xy',modifierKey:'ctrl'},zoom:{wheel:{enabled:true,modifierKey:'ctrl',speed:0.08},pinch:{enabled:true},drag:{enabled:true,backgroundColor:'rgba(92,222,194,.12)',borderColor:'rgba(92,222,194,.75)',borderWidth:1},mode:'xy'}};
  }
  return {responsive:true,maintainAspectRatio:false,animation:{duration:0},plugins,scales:{x:{grid:{color:'rgba(128,149,190,.08)'},ticks:{color:'#7787a5',maxTicksLimit:7,font:{family:'DM Mono',size:9}},border:{color:'#34405a'}},y:{grid:{color:'rgba(128,149,190,.10)'},ticks:{color:'#7787a5',maxTicksLimit:5,font:{family:'DM Mono',size:9}},border:{color:'#34405a'}}}};
}
function removeChartToolbar(canvas){
  const card=canvas?.closest?.('.chart-panel, .lightcurve-card');
  card?.querySelector('.chart-zoom-toolbar')?.remove();
}
function changeChartZoom(chart, factor){
  if(typeof chart.zoom==='function') { chart.zoom(factor); return; }
  const scales=Object.values(chart.scales||{});
  if(!chart.$melOriginalBounds){
    chart.$melOriginalBounds={};
    for(const scale of scales) chart.$melOriginalBounds[scale.id]={min:scale.min,max:scale.max,type:scale.type};
  }
  for(const scale of scales){
    const original=chart.$melOriginalBounds[scale.id];
    const options=chart.options.scales?.[scale.id];
    if(!options||!Number.isFinite(scale.min)||!Number.isFinite(scale.max)||scale.max<=scale.min)continue;
    const log=scale.type==='logarithmic';
    const low=log?Math.log(scale.min):scale.min, high=log?Math.log(scale.max):scale.max;
    const center=(low+high)/2, half=(high-low)/(2*factor);
    let min=log?Math.exp(center-half):center-half;
    let max=log?Math.exp(center+half):center+half;
    if(original && Number.isFinite(original.min)&&Number.isFinite(original.max)){
      if(factor>1){min=Math.max(min,original.min);max=Math.min(max,original.max);}
    }
    options.min=min;options.max=max;
  }
  chart.update('none');
}
function resetChartZoom(chart){
  if(typeof chart.resetZoom==='function'){chart.resetZoom();return;}
  const scales=chart.options.scales||{};
  for(const [id,bounds] of Object.entries(chart.$melOriginalBounds||{})){
    if(scales[id]){scales[id].min=bounds.min;scales[id].max=bounds.max;}
  }
  chart.update('none');
}
function installChartToolbar(chart){
  const canvas=chart?.canvas;
  const card=canvas?.closest?.('.chart-panel, .lightcurve-card');
  if(!canvas||!card)return;
  card.querySelector('.chart-zoom-toolbar')?.remove();
  const anchor=card.querySelector('.chart-heading, .lightcurve-card-head');
  if(!anchor)return;
  const toolbar=document.createElement('div');toolbar.className='chart-zoom-toolbar';toolbar.setAttribute('aria-label','Controles do gráfico');
  const makeButton=(label,title,action,extra='')=>{const b=document.createElement('button');b.type='button';b.className=`chart-tool-button ${extra}`.trim();b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.addEventListener('click',()=>action(chart));toolbar.appendChild(b);};
  makeButton('−','Diminuir zoom',c=>changeChartZoom(c,1/1.25));
  makeButton('+','Aumentar zoom',c=>changeChartZoom(c,1.25));
  makeButton('Reset','Restaurar escala original',c=>resetChartZoom(c),'chart-tool-reset');
  makeButton('PNG','Salvar este gráfico como PNG',c=>downloadChartPng(c.canvas.id,`${(c.canvas.id||'grafico').replace(/[^a-z0-9_-]+/gi,'_')}.png`),'chart-tool-download');
  const hint=document.createElement('span');hint.className='chart-zoom-hint';hint.textContent=(window.ChartZoom||chart.zoom)?'Ctrl + roda: zoom · Ctrl + arraste: mover · pinça: zoom':'Use +/− para zoom';toolbar.appendChild(hint);
  anchor.insertAdjacentElement('afterend',toolbar);
}
function makeChart(ctx,config){if(!window.Chart)throw new Error('A biblioteca de gráficos não carregou. Confira a conexão à internet e recarregue a página.');const c=new Chart(ctx,config);state.charts.push(c);installChartToolbar(c);return c;}
function renderResults(results,valid){
  const an=state.latestAnalysis;const source=an.source||'Fonte sem nome';
  el('resultsSubtitle').textContent=`${source} · ${an.instrument} · m = ${an.m}, r = ${String(an.r).replace('.',',')}σ`;
  el('metricBands').textContent=`${valid.length}/8`;
  el('metricMean').textContent=valid.length?formatNum(mean(valid.map(x=>x.value))):'—';
  const max=valid.length?valid.reduce((a,b)=>a.value>b.value?a:b):null;
  el('metricMax').textContent=max?formatNum(max.value):'—';el('metricMaxBand').textContent=max?max.def.name:'nenhuma banda válida';
  const maxPoints=results.reduce((a,b)=>Math.max(a,b.n),0);el('metricPoints').textContent=formatInt(maxPoints);
  const validModulations=results.filter(r=>Number.isFinite(r.modulationIndex));
  el('metricModMean').textContent=validModulations.length?`${formatNum(mean(validModulations.map(r=>r.modulationIndex)),2)}%`:'—';
  const tbody=el('resultsTable').querySelector('tbody');
  tbody.innerHTML=results.map(r=>{
    const sampenOK=Number.isFinite(r.value), sampenStatus=sampenOK?'OK':(r.reason||'Indisponível');
    const mod=r.modulationResult||{};
    const modStatus=mod.status==='OK'?'OK':(mod.reason||'Indisponível');
    const sampenClass=sampenOK?'':'warning';
    const modClass=Number.isFinite(r.modulationIndex)?'':(mod.status==='negative_intrinsic_variance'||mod.status==='nonpositive_mean'?'warning':'failed');
    return `<tr><td><span class="band-dot" style="background:${r.def.color}"></span>${r.def.name}</td><td>${formatInt(r.n)}</td><td>${formatNum(r.sigma,3)}</td><td><strong>${formatNum(r.value,4)}</strong></td><td><strong>${Number.isFinite(r.modulationIndex)?formatNum(r.modulationIndex,2)+'%':'—'}</strong></td><td><span class="result-status ${sampenClass}" title="${escapeHtml(sampenStatus)}">${escapeHtml(sampenStatus)}</span></td><td><span class="result-status ${modClass}" title="${escapeHtml(modStatus)}">${escapeHtml(modStatus)}</span><br><small class="microcopy">N usado: ${formatInt(mod.nUsed??0)} · erros excluídos: ${formatInt(mod.nErrorExcluded??0)}</small></td></tr>`;
  }).join('');
  destroyCharts();
  const chartAvailable=Boolean(window.Chart);
  if(chartAvailable){
    const ctx=el('entropyChart').getContext('2d');
    makeChart(ctx,{type:'bar',data:{labels:results.map(r=>r.def.short),datasets:[{data:results.map(r=>Number.isFinite(r.value)?r.value:null),backgroundColor:results.map(r=>r.def.color+'cc'),borderColor:results.map(r=>r.def.color),borderWidth:1,borderRadius:4,maxBarThickness:42}]},options:{...chartDefaults(),plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`SampEn: ${Number.isFinite(results[c.dataIndex]?.value)?formatNum(results[c.dataIndex].value,4):'indisponível'}`,afterLabel:c=>{const r=results[c.dataIndex];return [`B (padrões m=${an.m}): ${formatInt(r.B||0)} pares`,`A (extensões m+1=${an.m+1}): ${formatInt(r.A||0)} pares`];}}}},scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...chartDefaults().scales.x,title:{display:true,text:'Banda',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
    const modCanvas=el('modulationChart');
    makeChart(modCanvas.getContext('2d'),{type:'bar',data:{labels:results.map(r=>r.def.short),datasets:[{label:'Modulação intrínseca (%)',data:results.map(r=>Number.isFinite(r.modulationIndex)?r.modulationIndex:null),backgroundColor:results.map(r=>r.def.color+'cc'),borderColor:results.map(r=>r.def.color),borderWidth:1,borderRadius:4,maxBarThickness:42}]},options:{...chartDefaults(),scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,beginAtZero:true,title:{display:true,text:'Modulação intrínseca (%)',color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...chartDefaults().scales.x,title:{display:true,text:'Banda',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
    const individualDetails=el('individualCurvesDetails');
    if(individualDetails?.open) renderLightcurves(results); else el('lightcurveGrid').innerHTML='';
    renderOverlayLightcurve(results);
  } else {
    el('lightcurveGrid').innerHTML='';
    for(const id of ['entropyChart','modulationChart','lightcurveOverlayChart','sampenMatchOverlayChart','temporalSampenOverlayChart']){const canvas=el(id);if(canvas)canvas.closest('.chart-container')?.insertAdjacentHTML('beforebegin','<p class="dependency-inline-warning">Biblioteca de gráficos indisponível. Os valores numéricos e a tabela continuam acessíveis.</p>');}
  }
  const cadence=results.map(r=>r.cadence.cv).filter(Number.isFinite); const irregular=cadence.some(v=>v>0.1);
  el('methodNoteText').textContent=`SampEn calculada pelo núcleo ${an.algorithmVersion||'científico'} com H_SE = −ln(A/B), distância de Chebyshev e r = ${String(an.r).replace('.',',')} × σ populacional de cada banda. ${irregular?'Os intervalos temporais variam entre observações; SampEn usa a ordem dos pontos, não pondera os intervalos reais. ':'SampEn usa a sequência de pontos e não pondera diretamente os intervalos reais. '}A modulação intrínseca segue m_int = 100 × √(S² − média(erro²)) / fluxo médio e usa apenas pares fluxo–incerteza válidos. Resultados indefinidos permanecem indisponíveis, não zero.`;
  el('generatedAt').textContent=`Processado em ${new Date().toLocaleString('pt-BR')}`;
}
function renderLightcurves(results){
  const grid=el('lightcurveGrid');const normalize=el('normalizeCurves').checked;
  grid.innerHTML=results.map((r,i)=>`<article class="lightcurve-card"><div class="lightcurve-card-head"><strong><span class="band-dot" style="background:${r.def.color}"></span>${r.def.name}</strong><span>SampEn ${formatNum(r.value,3)} · m ${Number.isFinite(r.modulationIndex)?formatNum(r.modulationIndex,2)+'%':'—'}</span></div><div class="lightcurve-canvas"><canvas id="lc-${i}" aria-label="Curva de luz ${r.def.name}"></canvas></div><div class="curve-meta"><span>N <b>${formatInt(r.n)}</b></span><span>média <b>${formatNum(r.mean,3)}</b></span><span>σ <b>${formatNum(r.std,3)}</b></span></div></article>`).join('');
  results.forEach((r,i)=>{
    const vals=r.points.map(p=>p.y);const mu=mean(vals)||0;const sd=std(vals)||1;
    const data=r.points.map(p=>({x:p.x,y:normalize?(p.y-mu)/sd:p.y}));
    const options={...chartDefaults(),parsing:false,scales:{...chartDefaults().scales,x:{...chartDefaults().scales.x,type:'linear',title:{display:true,text:state.latestAnalysis.timeLabel,color:'#8797b3',font:{family:'DM Mono',size:9}}},y:{...chartDefaults().scales.y,title:{display:true,text:normalize?'Fluxo normalizado (z-score)':'Taxa / fluxo',color:'#8797b3',font:{family:'DM Mono',size:9}}}},plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${c.parsed.y.toLocaleString('pt-BR',{maximumFractionDigits:5})}`}}}};
    makeChart(el(`lc-${i}`).getContext('2d'),{type:'line',data:{datasets:[{data,borderColor:r.def.color,backgroundColor:r.def.color+'22',borderWidth:1.5,pointRadius:0,pointHoverRadius:3,tension:0,spanGaps:false}]},options});
  });
}
function rgbaFromHex(hex, alpha) {
  const clean=String(hex||'').replace('#','');
  if(!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(92,222,194,${alpha})`;
  const number=parseInt(clean,16);
  return `rgba(${(number>>16)&255},${(number>>8)&255},${number&255},${alpha})`;
}

// Draw match connectors directly on the multiband canvas so they do not become
// dozens of Chart.js datasets or slow down hover/legend interactions.
const sampenMatchOverlayPlugin = {
  id: 'sampenMatchOverlay',
  afterDatasetsDraw(chart) {
    const view=chart.$melSampenMatchOverlay;
    if(!view?.enabled || !view.result?.matchPairs || !chart.chartArea) return;
    const band=view.result;
    const points=band.points||[];
    const xScale=chart.scales.x, yScale=chart.scales.y;
    if(!xScale||!yScale||!points.length) return;
    const datasetIndex=chart.data.datasets.findIndex(d=>d._melBandIndex===view.bandIndex);
    if(datasetIndex<0 || !chart.isDatasetVisible(datasetIndex)) return;
    const chartArea=chart.chartArea, ctx=chart.ctx;
    const values=points.map(p=>p.y), mu=mean(values)||0, sd=std(values)||1;
    const plotY=index=>{
      const p=points[index];
      if(!p || !Number.isFinite(p.y)) return null;
      return view.normalize?(p.y-mu)/sd:p.y;
    };
    const drawPairs=(pairs, dimension, dash, alpha, width)=>{
      if(!Array.isArray(pairs)||!pairs.length) return;
      ctx.save();ctx.beginPath();ctx.rect(chartArea.left,chartArea.top,chartArea.right-chartArea.left,chartArea.bottom-chartArea.top);ctx.clip();
      ctx.strokeStyle=rgbaFromHex(band.def.color,alpha);ctx.lineWidth=width;ctx.setLineDash(dash);
      for(const pair of pairs){
        if(!Array.isArray(pair)||pair.length!==2) continue;
        const [i,j]=pair;
        for(let k=0;k<dimension;k++){
          const leftIndex=i+k,rightIndex=j+k;
          const left=points[leftIndex],right=points[rightIndex];
          const y1=plotY(leftIndex),y2=plotY(rightIndex);
          if(!left||!right||y1===null||y2===null) continue;
          const x1=xScale.getPixelForValue(left.x),x2=xScale.getPixelForValue(right.x);
          const py1=yScale.getPixelForValue(y1),py2=yScale.getPixelForValue(y2);
          if(![x1,x2,py1,py2].every(Number.isFinite)) continue;
          ctx.beginPath();ctx.moveTo(x1,py1);ctx.lineTo(x2,py2);ctx.stroke();
        }
      }
      ctx.restore();
    };
    // Dashed connectors = B pairs at dimension m; solid = A pairs at m+1.
    drawPairs(band.matchPairs.m,view.m,[4,3],0.55,1.05);
    drawPairs(band.matchPairs.mPlus1,view.m+1,[],0.88,1.45);
  }
};

function updateSampenMatchOverlay(results=state.results){
  const canvas=el('lightcurveOverlayChart');
  const chart=state.charts.find(c=>c?.canvas?.id==='lightcurveOverlayChart');
  const checkbox=el('showSampenMatches'), select=el('sampenMatchBandSelect'), status=el('sampenMatchStatus');
  if(!canvas||!chart||!checkbox||!select||!status) return;
  const bandIndex=Math.max(0,Math.min(results.length-1,Number(select.value)||0));
  const result=results[bandIndex];
  // Match-pair collection is intentionally deferred until the user asks to see
  // it. The normal SampEn path therefore keeps its original speed and memory use.
  if(checkbox.checked && result && !result.matchPairs){
    chart.$melSampenMatchOverlay={enabled:true,bandIndex,result,normalize:el('normalizeCurves').checked,m:state.latestAnalysis?.m||2};
    chart.update('none');
    if(!result.matchPairsLoading){
      result.matchPairsLoading=true;
      status.textContent=`Calculando uma amostra de correspondências para ${result.def.name} em segundo plano…`;
      runScienceTask({type:'match-pairs',series:(result.points||[]).map(point=>point.y),m:state.latestAnalysis?.m||2,tolerance:state.latestAnalysis?.r||0.2}).then(matchPairs=>{
        result.matchPairs=matchPairs||{m:[],mPlus1:[],maxStoredPerDimension:12};
        result.matchPairsLoading=false;
        updateSampenMatchOverlay(results);
      }).catch(error=>{
        result.matchPairsLoading=false;
        status.textContent=`Não foi possível calcular as correspondências: ${error.message||error}`;
      });
    }
    return;
  }
  chart.$melSampenMatchOverlay={enabled:checkbox.checked,bandIndex,result,normalize:el('normalizeCurves').checked,m:state.latestAnalysis?.m||2};
  chart.update('none');
  if(!checkbox.checked){
    status.textContent='Desligado: ative para destacar uma amostra dos padrões semelhantes encontrados pela SampEn na banda selecionada.';
    return;
  }
  if(!result){status.textContent='Nenhuma banda disponível para mostrar correspondências.';return;}
  const pairs=result.matchPairs||{m:[],mPlus1:[]};
  const mCount=Array.isArray(pairs.m)?pairs.m.length:0;
  const m1Count=Array.isArray(pairs.mPlus1)?pairs.mPlus1.length:0;
  const hasSampen=Number.isFinite(result.value);
  const prefix=`${result.def.name}: B=${formatInt(result.B||0)} pares de dimensão m=${state.latestAnalysis?.m||2}; A=${formatInt(result.A||0)} pares de dimensão m+1.`;
  const legend=`Linhas tracejadas representam padrões semelhantes em m; linhas contínuas representam os pares que também correspondem em m+1.`;
  if(!hasSampen && !mCount && !m1Count){status.textContent=`${prefix} Não há correspondências suficientes para desenhar linhas. ${result.reason||''}`;return;}
  status.textContent=`${prefix} Desenhando até ${mCount} pares de m e ${m1Count} pares de m+1 como amostra visual. ${legend} A seleção de pares é limitada para manter a visualização legível; os valores completos de A e B não são reduzidos.`;
}

function renderOverlayLightcurve(results){
  const canvas=el('lightcurveOverlayChart'); if(!canvas)return;
  const normalize=el('normalizeCurves').checked;
  const select=el('sampenMatchBandSelect');
  if(select){
    const previous=Number(select.value);
    select.innerHTML=results.map((r,i)=>`<option value="${i}">${escapeHtml(r.def.name)}</option>`).join('');
    select.value=String(Number.isInteger(previous)&&previous>=0&&previous<results.length?previous:Math.max(0,results.findIndex(r=>Number.isFinite(r.value))));
  }
  const datasets=results.map((r,index)=>{
    const vals=r.points.map(p=>p.y), mu=mean(vals)||0, sd=std(vals)||1;
    const data=r.points.map(p=>({x:p.x,y:normalize?(p.y-mu)/sd:p.y}));
    return {label:r.def.name,data,borderColor:r.def.color,backgroundColor:r.def.color+'22',borderWidth:1.45,pointRadius:0,pointHoverRadius:2.5,tension:0,spanGaps:false,_melBandIndex:index};
  }).filter(d=>d.data.length);
  const chart=makeChart(canvas.getContext('2d'),{type:'line',data:{datasets},plugins:[sampenMatchOverlayPlugin],options:{...chartDefaults(),parsing:false,interaction:{mode:'nearest',intersect:false},plugins:{...chartDefaults().plugins,legend:{display:true,position:'bottom',labels:{color:'#9cabc7',boxWidth:8,boxHeight:8,font:{size:9}}}},scales:{...chartDefaults().scales,x:{...chartDefaults().scales.x,type:'linear',title:{display:true,text:state.latestAnalysis?.timeLabel||'Tempo',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...chartDefaults().scales.y,title:{display:true,text:normalize?'Fluxo normalizado (z-score)':'Taxa / fluxo',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
  chart.$melSampenMatchOverlay={enabled:!!el('showSampenMatches')?.checked,bandIndex:Math.max(0,Number(select?.value)||0),result:results[Math.max(0,Number(select?.value)||0)],normalize,m:state.latestAnalysis?.m||2};
  updateSampenMatchOverlay(results);
}

async function calculateTemporalSampen(){
  if(!state.results.length||!state.latestAnalysis){el('temporalSampenStatus').textContent='Primeiro importe uma curva e calcule a SampEn por banda.';return;}
  const windowSize=Number(el('sampenWindowPoints').value), step=Number(el('sampenWindowStep').value), m=state.latestAnalysis.m, r=state.latestAnalysis.r;
  if(!Number.isInteger(windowSize)||windowSize<=m+1||!Number.isInteger(step)||step<1){el('temporalSampenStatus').textContent='Confira o tamanho e o passo das janelas.';return;}
  state.temporalSampenRunId=(state.temporalSampenRunId||0)+1;
  const runId=state.temporalSampenRunId;
  state.temporalSampenCancelRequested=false;
  const btn=el('calculateTemporalSampenBtn'), cancelBtn=el('cancelTemporalSampenBtn');
  btn.disabled=true;btn.textContent='Calculando…';if(cancelBtn){cancelBtn.hidden=false;cancelBtn.disabled=false;cancelBtn.textContent='Cancelar cálculo';}
  el('temporalSampenStatus').textContent=`Preparando janelas de ${windowSize} pontos com passo ${step}…`;
  let cancelled=false;
  try{
    const datasets=[];let totalWindows=0,validEntropy=0,processed=0;
    outer: for(const band of state.results){
      const points=band.points||[];const data=[];
      for(let start=0;start+windowSize<=points.length;start+=step){
        if(state.temporalSampenCancelRequested||state.temporalSampenRunId!==runId){cancelled=true;break outer;}
        const slice=points.slice(start,start+windowSize);const value=sampleEntropy(slice.map(p=>p.y),m,r);
        const center=slice[Math.floor(slice.length/2)];
        data.push({x:center?center.x:start+windowSize/2,y:Number.isFinite(value.value)?value.value:null});
        totalWindows++;processed++;if(Number.isFinite(value.value))validEntropy++;
        // Yield after every window for large N, so progress and cancel remain responsive.
        const yieldEvery=windowSize>=500?1:8;
        if(processed%yieldEvery===0){el('temporalSampenStatus').textContent=`Calculando ${windowSize} pontos/janela… ${processed.toLocaleString('pt-BR')} janelas avaliadas; ${validEntropy.toLocaleString('pt-BR')} SampEn finitas.`;await new Promise(resolve=>setTimeout(resolve,0));}
      }
      if(data.length)datasets.push({label:band.def.name,data,borderColor:band.def.color,backgroundColor:band.def.color+'22',borderWidth:1.4,pointRadius:windowSize>=500?1.2:2.1,pointHoverRadius:4,tension:0,spanGaps:false});
    }
    if(state.temporalSampenChart){try{removeChartToolbar(state.temporalSampenChart.canvas);state.temporalSampenChart.destroy()}catch(_){}state.temporalSampenChart=null;}
    const canvas=el('temporalSampenOverlayChart');
    if(datasets.length){
      state.temporalSampenChart=new Chart(canvas.getContext('2d'),{type:'line',data:{datasets},options:{...chartDefaults(),parsing:false,interaction:{mode:'nearest',intersect:false},plugins:{...chartDefaults().plugins,legend:{display:true,position:'bottom',labels:{color:'#9cabc7',boxWidth:8,boxHeight:8,font:{size:9}}},tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${c.dataset.label}: SampEn ${Number.isFinite(c.parsed.y)?c.parsed.y.toFixed(4):'indisponível'}`}}},scales:{...chartDefaults().scales,x:{...chartDefaults().scales.x,type:'linear',title:{display:true,text:state.latestAnalysis.timeLabel,color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...chartDefaults().scales.y,beginAtZero:true,title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
      installChartToolbar(state.temporalSampenChart);
    }
    const prefix=cancelled?'Cancelado parcialmente. ':'Concluído. ';
    el('temporalSampenStatus').textContent=`${prefix}${validEntropy.toLocaleString('pt-BR')} SampEn finitas de ${totalWindows.toLocaleString('pt-BR')} janelas processadas; ${windowSize} pontos/janela, passo ${step}, m=${m}, r=${String(r).replace('.',',')}σ.${cancelled?' Você pode alterar os parâmetros e executar novamente.':''}`;
  }catch(err){el('temporalSampenStatus').textContent=`Falha no cálculo: ${err.message||err}`;}
  finally{btn.disabled=false;btn.textContent='Calcular SampEn temporal';if(cancelBtn){cancelBtn.hidden=true;cancelBtn.disabled=false;}}
}

el('individualCurvesDetails')?.addEventListener('toggle',()=>{
  const details=el('individualCurvesDetails');
  if(details?.open && state.results.length) renderLightcurves(state.results);
  else destroyIndividualLightcurveCharts();
});
function destroyIndividualLightcurveCharts(){
  const removed=new Set();
  for(const chart of state.charts){
    if(/^lc-\d+$/.test(chart?.canvas?.id||'')){
      removed.add(chart);
      try{removeChartToolbar(chart.canvas);chart.destroy();}catch(_){}
    }
  }
  state.charts=state.charts.filter(chart=>!removed.has(chart));
  const grid=el('lightcurveGrid');if(grid && !el('individualCurvesDetails')?.open)grid.innerHTML='';
}
el('normalizeCurves').addEventListener('change',()=>{if(state.results.length)renderResults(state.results,state.results.filter(r=>Number.isFinite(r.value)));});
el('showSampenMatches')?.addEventListener('change',()=>updateSampenMatchOverlay());
el('sampenMatchBandSelect')?.addEventListener('change',()=>updateSampenMatchOverlay());
el('calculateTemporalSampenBtn')?.addEventListener('click',calculateTemporalSampen);
el('cancelTemporalSampenBtn')?.addEventListener('click',()=>{state.temporalSampenCancelRequested=true;const b=el('cancelTemporalSampenBtn');if(b){b.disabled=true;b.textContent='Cancelando…';}el('temporalSampenStatus').textContent='Cancelamento solicitado; a janela atual será concluída antes de parar.';});

function downloadBlob(blob, filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function downloadRemoteUrl(rawUrl, fallbackFilename='curva-de-luz.lc.gz'){
  const url=safeHttpUrl(rawUrl);
  if(!url) throw new Error('O endereço não é uma URL HTTP(S) válida.');
  const response=await fetch(url.href,{method:'GET',mode:'cors',redirect:'follow'});
  if(!response.ok) throw new Error(`O servidor respondeu HTTP ${response.status}.`);
  const blob=await response.blob();
  if(!blob.size) throw new Error('O servidor retornou um arquivo vazio.');
  let filename=filenameFromUrl(new URL(response.url||url.href),response)||fallbackFilename;
  if(!filename || filename==='curva-remota.lc') filename=fallbackFilename;
  downloadBlob(blob,filename);
  return {filename,size:blob.size};
}
function downloadFailureText(error){
  if(error instanceof TypeError) return 'Este servidor não permite importar o arquivo diretamente pelo navegador (CORS) ou a conexão falhou. Baixe o arquivo e use Arquivo local.';
  return error?.message||'Não foi possível iniciar o download automático.';
}
el('downloadCsvBtn').addEventListener('click',()=>{
  if(!state.results.length)return;
  const an=state.latestAnalysis;
  const rows=[['dataset_type',state.demoMode?'SYNTHETIC_DEMO':'USER_DATA'],['dataset_hash',state.fileHash||''],['source',an.source],['instrument',an.instrument],['algorithm_version',an.algorithmVersion||''],['embedding_m',an.m],['tolerance_multiplier_sigma',an.r],['sampen_formula','-ln(A/B)'],['modulation_formula','100*sqrt(observed_variance-mean(error^2))/mean_flux'],[],['band_keV','N_rate_valid','N_modulation_used','N_excluded_missing_invalid_error','mean_rate','sampen_sigma','A_matches','B_matches','SampEn','modulation_intrinsic_percent','observed_variance','noise_variance','intrinsic_variance','r_modulation_status','sampen_status']];
  for(const r of state.results){const mod=r.modulationResult||{};rows.push([r.def.name,r.n,mod.nUsed??'',mod.nErrorExcluded??'',r.mean??'',r.sigma??'',r.A??'',r.B??'',r.value??'',r.modulationIndex??'',mod.observedVariance??'',mod.noiseVariance??'',mod.intrinsicVariance??'',mod.status||'',r.reason||'OK']);}
  const csv='\uFEFF'+rows.map(row=>row.map(v=>{const s=String(v??'');return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}).join(';')).join('\r\n');
  downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`${state.demoMode?'SINTETICO_':''}multiband_entropy_${slug(an.source)}.csv`);
});
function downloadChartPng(canvasId, filename){
  const canvas=el(canvasId);if(!canvas)return;
  if(!state.demoMode){canvas.toBlob(blob=>{if(blob)downloadBlob(blob,filename);});return;}
  const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height+34;const ctx=out.getContext('2d');if(!ctx)return;
  ctx.fillStyle='#0b1020';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,34);ctx.fillStyle='#ffbd78';ctx.font='bold 13px system-ui';ctx.fillText('SINTÉTICO · DADOS DEMONSTRATIVOS',12,22);out.toBlob(blob=>{if(blob)downloadBlob(blob,`SINTETICO_${filename}`);});
}
el('downloadPngBtn').addEventListener('click',()=>downloadChartPng('entropyChart',`sampen_por_banda_${slug(state.latestAnalysis?.source||'fonte')}.png`));
el('downloadModulationPngBtn').addEventListener('click',()=>downloadChartPng('modulationChart',`modulacao_intrinseca_por_banda_${slug(state.latestAnalysis?.source||'fonte')}.png`));
el('downloadSessionJsonBtn')?.addEventListener('click',exportAnalysisSessionJson);
function slug(s){return String(s||'fonte').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'fonte';}

el('analyzeBtn').addEventListener('click',async()=>{
  const btn=el('analyzeBtn'), mobileBtn=el('mobileAnalyzeBtn');btn.disabled=true;btn.innerHTML='<span class="loading-spinner"></span><span>Calculando…</span>';
  if(mobileBtn){mobileBtn.dataset.busy='true';mobileBtn.disabled=true;}
  syncMobileCalculateDock();
  try {
    const completed=await analyze();
    if(!completed) el('analysisProgress')?.classList.add('hidden');
  } catch(error) {
    setAnalysisProgress(0,'A análise não foi concluída',error.message||'Falha inesperada no cálculo.');
    message(error.message||'Falha inesperada na análise.','error');
  } finally {
    btn.disabled=!state.parsed;
    btn.innerHTML='<span>Calcular SampEn + modulação</span><span aria-hidden="true">→</span>';
    if(mobileBtn){mobileBtn.dataset.busy='false';}
    syncMobileCalculateDock();
  }
});
for(const number of [1,2,3]) el(`workflowStep${number}`)?.addEventListener('click',()=>navigateWorkflowStep(number));
el('recommendedParamsBtn')?.addEventListener('click',()=>{el('embedding').value='2';el('tolerance').value='0.2';updateToleranceControls();saveUiConfig();message('Parâmetros de referência restaurados: m = 2 e r = 0,2σ. Confira se são adequados à sua série e ao objetivo científico.');});
const dz=el('dropzone');dz.addEventListener('click',()=>el('fileInput').click());dz.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el('fileInput').click();}});el('fileInput').addEventListener('change',e=>handleFile(e.target.files?.[0]));
for(const eventName of ['dragenter','dragover'])dz.addEventListener(eventName,e=>{e.preventDefault();dz.classList.add('dragover');});for(const eventName of ['dragleave','drop'])dz.addEventListener(eventName,e=>{e.preventDefault();dz.classList.remove('dragover');});dz.addEventListener('drop',e=>handleFile(e.dataTransfer?.files?.[0]));

function makeDemo({autoCalculate=false}={}){
  state.demoMode=true; state.fileHash='SYNTHETIC:demo-seed-20261011-190x8'; state.results=[]; state.latestAnalysis=null;
  destroyCharts();
  el('individualCurvesDetails')?.removeAttribute('open');
  el('resultsSection')?.classList.add('hidden');
  el('analysisProgress')?.classList.add('hidden');
  const header=['MJD','RATE_14_20','RATE_20_24','RATE_24_35','RATE_35_50','RATE_50_75','RATE_75_100','RATE_100_150','RATE_150_195','ERR_14_20','ERR_20_24','ERR_24_35','ERR_35_50','ERR_50_75','ERR_75_100','ERR_100_150','ERR_150_195'];
  const rows=[];let seed=20261011;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<190;i++){const t=56500+i*2.3+(rand()-.5)*.35;const row=[t];const rates=[];for(let b=0;b<8;b++){const trend=0.1+0.015*b;const val=trend+(.3/(1+b*.3))*Math.sin(i*(.11+b*.018))+(.09/(1+b*.1))*(rand()-.5)+.045*Math.sin(i*.037+b);rates.push(val);}row.push(...rates);row.push(...rates.map((v,b)=>.04+.007*b+rand()*.02));rows.push(row);}
  const parsed={filename:'demonstracao_swift_bat_8band.lc',header,rows,delimiter:'whitespace',time:0,rates:Array.from({length:8},(_,i)=>i+1),errors:Array.from({length:8},(_,i)=>i+9)};
  populateMapping(parsed);state.parsed=true;
  el('sourceName').value='Fonte demonstrativa';el('instrumentName').value='Swift-BAT (simulado)';
  fileStatus('Dados demonstrativos gerados no navegador · 190 épocas × 8 bandas','success');
  if(autoCalculate){
    message('Demonstração carregada. A análise será calculada com os parâmetros iniciais. Os dados são sintéticos, não observacionais.');
    setWorkflowStage(2);
    requestAnimationFrame(()=>el('analyzeBtn').click());
  }else message('Série sintética carregada para explorar o laboratório. Confira o mapeamento e clique em calcular; nenhum resultado é apresentado como observação real.');
}
el('demoBtn')?.addEventListener('click',()=>makeDemo());
el('heroDemoBtn')?.addEventListener('click',()=>makeDemo({autoCalculate:true}));
el('heroLocalBtn')?.addEventListener('click',()=>{setWorkflowStage(1);el('inputStep')?.scrollIntoView({behavior:'smooth',block:'start'});el('fileInput').click();});

function exportAnalysisSessionJson(){
  if(!state.latestAnalysis||!state.results.length){message('Execute uma análise antes de exportar a sessão.','error');return;}
  const payload={
    app:'Multiband Entropy Lab',version:'0.18',exportedAt:new Date().toISOString(),datasetKind:state.demoMode?'SINTÉTICO':'DADOS DO USUÁRIO',datasetHash:state.fileHash||'',inputFileName:state.fileName||'',parameters:{m:Number(el('embedding').value),toleranceMultiplier:Number(el('tolerance').value)},mapping:{timeColumn:state.table?.header?.[Number(el('timeColumn')?.value)]||null,bands:Array.from({length:8},(_,i)=>({label:el(`label-${i}`)?.value||state.bandDefs[i]?.name,rateColumn:state.table?.header?.[Number(el(`rate-${i}`)?.value)]||null,errorColumn:state.table?.header?.[Number(el(`err-${i}`)?.value)]||null}))},notice:'Esta sessão guarda parâmetros, mapeamento e resultados, mas não inclui as observações originais. Recarregue o mesmo arquivo para recalcular.',
    analysis:{...state.latestAnalysis,timestamp:state.latestAnalysis.timestamp instanceof Date?state.latestAnalysis.timestamp.toISOString():state.latestAnalysis.timestamp},
    demoData:Boolean(state.demoMode),
    method:{sampleEntropy:'H_SE = -ln(A/B)',distance:'Chebyshev',tolerance:'r × desvio-padrão populacional de cada banda',intrinsicModulation:'100 × sqrt(variância observada − média(erro²)) / fluxo médio'},
    results:state.results.map(result=>({
      band:result.def?.name,shortLabel:result.def?.short,points:result.n,mean:result.mean,std:result.std,sigma:result.sigma,
      sampleEntropy:result.value,reason:result.reason,A:result.A,B:result.B,
      modulationPercent:result.modulationIndex,modulation:result.modulationResult,
      cadenceMedian:result.cadence?.median,cadenceCoefficientOfVariation:result.cadence?.cv
    }))
  };
  downloadTextFile(JSON.stringify(payload,null,2),`${state.demoMode?'SINTETICO_':''}${slug(state.latestAnalysis.source)}_sessao_sampen.json`,'application/json;charset=utf-8');
}
function applyPendingSessionMapping() {
  const session=state.pendingSession; if(!session||!state.table||!Array.isArray(session.mapping?.bands))return;
  const headers=state.table.header.map(value=>String(value));
  const indexOfHeader=name=>name==null?-1:headers.findIndex(value=>value===String(name));
  const timeIdx=indexOfHeader(session.mapping.timeColumn);
  if(timeIdx>=0&&el('timeColumn'))el('timeColumn').value=String(timeIdx);
  for(let i=0;i<Math.min(8,session.mapping.bands.length);i++){
    const band=session.mapping.bands[i]||{}; const rate=indexOfHeader(band.rateColumn), error=indexOfHeader(band.errorColumn);
    if(rate>=0&&el(`rate-${i}`))el(`rate-${i}`).value=String(rate);
    else if(band.rateColumn==null&&el(`rate-${i}`))el(`rate-${i}`).value='-1';
    if(error>=0&&el(`err-${i}`))el(`err-${i}`).value=String(error);
    else if(band.errorColumn==null&&el(`err-${i}`))el(`err-${i}`).value='-1';
    if(band.label&&el(`label-${i}`)){const label=String(band.label).slice(0,60);el(`label-${i}`).value=label;state.bandDefs[i].name=label;state.bandDefs[i].short=label;}
  }
  if(session.parameters?.m&&el('embedding'))el('embedding').value=String(session.parameters.m);
  if(Number.isFinite(Number(session.parameters?.toleranceMultiplier))&&el('tolerance'))el('tolerance').value=String(session.parameters.toleranceMultiplier);
  if(session.analysis?.source&&el('sourceName'))el('sourceName').value=String(session.analysis.source).slice(0,160);
  if(session.analysis?.instrument&&el('instrumentName'))el('instrumentName').value=String(session.analysis.instrument).slice(0,100);
  state.timeIndex=Number(el('timeColumn')?.value ?? state.timeIndex);
  state.bandIndices=Array.from({length:8},(_,i)=>Number(el(`rate-${i}`)?.value ?? -1)>=0?Number(el(`rate-${i}`).value):null);
  state.errorIndices=Array.from({length:8},(_,i)=>Number(el(`err-${i}`)?.value ?? -1)>=0?Number(el(`err-${i}`).value):null);
  state.pendingSession=null; updateToleranceControls(); renderDataPreview(); saveUiConfig();
}
function importAnalysisSession(file) {
  if(!file)return;
  file.text().then(text=>{
    const session=JSON.parse(text);
    if(session?.app!=='Multiband Entropy Lab')throw new Error('Este JSON não parece uma sessão do Multiband Entropy Lab.');
    state.pendingSession=session;
    if(session.parameters?.m&&el('embedding'))el('embedding').value=String(session.parameters.m);
    if(Number.isFinite(Number(session.parameters?.toleranceMultiplier))&&el('tolerance'))el('tolerance').value=String(session.parameters.toleranceMultiplier);
    if(session.analysis?.source)el('sourceName').value=String(session.analysis.source).slice(0,160);
    if(session.analysis?.instrument)el('instrumentName').value=String(session.analysis.instrument).slice(0,100);
    if(state.table)applyPendingSessionMapping(); else message('Configurações importadas. Agora carregue o arquivo original para restaurar o mapeamento e recalcular; o JSON não contém os dados brutos.');
    updateToleranceControls(); saveUiConfig();
    message(state.table?'Sessão importada. Confira o mapeamento e recalcule para reproduzir os resultados.':'Sessão importada. Carregue o arquivo original para reaplicar o mapeamento e recalcular. O JSON não inclui os dados brutos.');
  }).catch(error=>message(error.message||'Não foi possível ler esta sessão JSON.','error'));
}
function updateReproducibilityPanel() {
  const analysis=state.latestAnalysis; if(!analysis)return;
  const values={
    reproSource:analysis.source||state.fileName||'—',
    reproInstrument:analysis.instrument||'Não informado',
    reproDatasetType:state.demoMode?'SINTÉTICO':'Arquivo do usuário',
    reproHash:state.fileHash||'Hash indisponível',
    reproParams:`m = ${analysis.m}; r = ${Number(analysis.r).toLocaleString('pt-BR',{maximumFractionDigits:4})} × σ`,
    reproAlgorithm:analysis.algorithmVersion||'—',
    reproTimestamp:(analysis.timestamp instanceof Date?analysis.timestamp:new Date(analysis.timestamp||Date.now())).toLocaleString('pt-BR'),
    reproVersion:'V0.18'
  };
  for(const [id,value] of Object.entries(values)){const node=el(id);if(node)node.textContent=value;}
}

function runLocalSelfTest() {
  const output=el('selfTestResult'); if(!output)return;
  output.textContent='Executando testes locais…';
  const checks=[]; const add=(name,passed,detail='')=>checks.push({name,passed:Boolean(passed),detail});
  try {
    const known=window.EntropyCore.sampleEntropy([0,1,0,1],1,1.4);
    add('Contagens e fórmula H = −ln(A/B)',known.A===1&&known.B===2&&Math.abs(known.value-Math.log(2))<1e-12,`A=${known.A}, B=${known.B}`);
    const constant=window.EntropyCore.sampleEntropy([4,4,4,4,4],2,0.2);
    add('Série constante é sinalizada como indefinida',constant.value===null&&/constante/i.test(constant.reason),constant.reason);
    const mod=window.EntropyCore.intrinsicModulation([{y:8,error:1},{y:10,error:1},{y:12,error:1}]);
    add('Modulação intrínseca com variância conhecida',mod.status==='OK'&&Math.abs(mod.value-100*Math.sqrt(3)/10)<1e-10,`módulo=${formatNum(mod.value,4)}%`);
    const first=window.EntropyCore.sampleEntropy([0,1,0,1,0,1,0,1,0],2,2,{maxMatchPairs:3});
    const plain=window.EntropyCore.sampleEntropy([0,1,0,1,0,1,0,1,0],2,2);
    add('Correspondências visuais não alteram A/B',first.A===plain.A&&first.B===plain.B&&first.value===plain.value,`A=${first.A}, B=${first.B}`);
  } catch(error) { add('Execução do núcleo científico',false,error.message||String(error)); }
  const passed=checks.filter(item=>item.passed).length;
  output.innerHTML=`<strong class="self-test-summary ${passed===checks.length?'passed':'failed'}">${passed}/${checks.length} testes locais passaram</strong><ul>${checks.map(item=>`<li class="${item.passed?'test-ok':'test-failed'}"><span>${item.passed?'✓':'✕'}</span><div><strong>${escapeHtml(item.name)}</strong>${item.detail?`<small>${escapeHtml(item.detail)}</small>`:''}</div></li>`).join('')}</ul><p>Este auto-teste verifica invariantes simples do código; não substitui a comparação independente com EntropyHub nem a validação observacional.</p>`;
}
async function runSensitivityAnalysis() {
  const select=el('sensitivityBandSelect'), button=el('runSensitivityBtn'), status=el('sensitivityStatus'), grid=el('sensitivityGrid');
  if(!state.latestAnalysis||!state.parsed)return;
  const index=Number(select?.value), band=state.results[index];
  if(!band||!Array.isArray(band.points)||band.points.length<8||band.points.length>3000){status.textContent='Escolha uma banda da análise atual com 8 a 3.000 pontos válidos para limitar o tempo de cálculo.';return;}
  button.disabled=true;grid.innerHTML='';status.textContent=`Calculando ${band.points.length.toLocaleString('pt-BR')} pontos para quatro dimensões e seis tolerâncias…`;
  try {
    const rValues=[0.10,0.15,0.20,0.25,0.30,0.40], mValues=[1,2,3,4];
    const cells=await runScienceTask({type:'sensitivity',series:band.points.map(p=>p.y),mValues,rValues},progress=>{if(progress.phase==='cell')status.textContent=`Mapa de sensibilidade: ${progress.completed}/${progress.total} combinações · m=${progress.m}, r=${progress.r.toFixed(2)}σ`;});
    const byCell=new Map(cells.map(cell=>[`${cell.m}:${cell.r}`,cell]));
    const valid=cells.filter(cell=>Number.isFinite(cell.value)).map(cell=>cell.value); const lo=valid.length?Math.min(...valid):0,hi=valid.length?Math.max(...valid):0,span=hi-lo||1;
    grid.innerHTML=`<table class="sensitivity-table"><thead><tr><th>m \ r</th>${rValues.map(r=>`<th>${r.toLocaleString('pt-BR',{minimumFractionDigits:2})}σ</th>`).join('')}</tr></thead><tbody>${mValues.map(m=>`<tr><th>${m}</th>${rValues.map(r=>{const cell=byCell.get(`${m}:${r}`);const ok=Number.isFinite(cell?.value);const shade=ok?Math.round(12+55*(cell.value-lo)/span):0;return `<td class="sensitivity-cell ${ok?'':'undefined'}" style="${ok?`--cell-alpha:${shade/100}`:''}" title="m=${m}, r=${r.toFixed(2)}σ; A=${cell?.A??0}; B=${cell?.B??0}">${ok?formatNum(cell.value,3):'—'}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
    status.textContent=`Concluído: ${valid.length}/${cells.length} valores finitos. A comparação é válida para esta banda e esta grade; não seleciona automaticamente o melhor parâmetro.`;
  } catch(error) { status.textContent=error.message||'Não foi possível gerar o mapa de sensibilidade.'; status.classList.add('error'); }
  finally { button.disabled=false; }
}

// Import tabs and direct-URL loading. Browser cross-origin (CORS) policies can block some hosts.
function setupImportTabs() {
  const tabs = [...document.querySelectorAll('.import-tab[data-tab]')];
  const panels = [...document.querySelectorAll('.import-tab-panel')];
  function activate(tab) {
    const target = tab.dataset.tab;
    for (const button of tabs) {
      const active = button === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.classList.toggle('hidden', panel.id !== target);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next]); tabs[next].focus();
    });
  });
  if (tabs.length) activate(tabs[0]);
}
function safeHttpUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch (_) { return null; }
}
function updateDirectLink() {
  const input = el('directUrlInput'), link = el('openDirectLink');
  const url = safeHttpUrl(input.value);
  if (url) {
    link.href = url.href;
    link.classList.remove('disabled-link');
    link.setAttribute('aria-disabled', 'false');
  } else {
    link.href = '#';
    link.classList.add('disabled-link');
    link.setAttribute('aria-disabled', 'true');
  }
}
function filenameFromUrl(url, response) {
  const disposition = response?.headers?.get('content-disposition') || '';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  const candidate = utf8 ? decodeURIComponent(utf8[1]) : (plain ? plain[1].trim() : decodeURIComponent(url.pathname.split('/').pop() || 'curva-remota.lc'));
  return (candidate || 'curva-remota.lc').replace(/[\\/:*?"<>|]+/g, '_');
}
async function importFromDirectUrl() {
  const input = el('directUrlInput'), button = el('loadUrlBtn'), help = el('urlHelp');
  const url = safeHttpUrl(input.value);
  if (!url) {
    help.textContent = 'Cole um endereço completo começando com https:// ou http://.';
    help.classList.add('error'); input.focus(); return;
  }
  help.classList.remove('error');
  button.disabled = true;
  button.innerHTML = '<span class="loading-spinner"></span> Baixando…';
  fileStatus('Buscando o arquivo remoto… a análise e a leitura continuarão no navegador.', 'loading');
  try {
    const response = await fetch(url.href, { method: 'GET', mode: 'cors', redirect: 'follow' });
    if (!response.ok) throw new Error(`O servidor respondeu HTTP ${response.status}.`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('O servidor retornou um arquivo vazio.');
    const filename = filenameFromUrl(new URL(response.url || url.href), response);
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream', lastModified: Date.now() });
    help.textContent = `Download recebido (${(blob.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB). O laboratório está lendo o arquivo.`;
    await handleFile(file);
  } catch (error) {
    const detail = error instanceof TypeError
      ? 'O servidor pode não permitir a importação direta pelo navegador (CORS), ou a conexão pode ter falhado.'
      : (error.message || 'Falha ao baixar o arquivo.');
    fileStatus(`Não foi possível importar pela URL: ${detail}`, 'error');
    message('Abra o link para baixar o arquivo e, depois, carregue-o pela aba “Arquivo local”.', 'error');
    help.textContent = `${detail} Isso é uma restrição do servidor/navegador, não necessariamente um problema no arquivo. Use “Abrir / baixar link” e depois selecione o arquivo baixado em “Arquivo local”.`;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Tentar importar';
  }
}
setupImportTabs();
setWorkflowStage(1);
el('directUrlInput').addEventListener('input', updateDirectLink);
el('loadUrlBtn').addEventListener('click', importFromDirectUrl);
el('openDirectLink').addEventListener('click', async event => {
  event.preventDefault();
  const link=el('openDirectLink'),help=el('urlHelp');
  if (link.getAttribute('aria-disabled') === 'true') {
    help.textContent = 'Cole primeiro um link completo começando com https:// ou http://.';
    help.classList.add('error');
    return;
  }
  if(link.dataset.downloading==='true') return;
  link.dataset.downloading='true';help.classList.remove('error');
  help.textContent='Tentando baixar o arquivo diretamente…';
  try{
    const result=await downloadRemoteUrl(link.href,'curva-de-luz.lc.gz');
    help.textContent=`Download iniciado: ${result.filename} (${(result.size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:2})} MB).`;
  }catch(error){
    help.classList.add('error');
    help.textContent=`O navegador não conseguiu forçar o download. ${downloadFailureText(error)} Para salvar mesmo assim, clique com o botão direito neste link e escolha “Salvar link como…”.`;
  }finally{link.dataset.downloading='false';}
});

// NASA Swift-BAT library helper: construct the official per-source snapshot URL.
function prepareNasaLink(){
  const input=el('nasaSourceName');
  let source=input.value.trim().replace(/^BAT_157m_eight_band_snapshot_/i,'').replace(/\.lc(?:\.gz)?$/i,'').replace(/\.gz$/i,'').trim();
  source=source.replace(/^SWIFT[_ ]+/i,'SWIFT_').replace(/[\s]+/g,'_');
  if(!source || !/^SWIFT_[A-Za-z0-9.+-]+$/i.test(source)){
    message('Digite o nome Swift como aparece no catálogo, por exemplo: SWIFT J0010.5+1057.','error');
    input.focus();return;
  }
  const url='https://swift.gsfc.nasa.gov/bat_survey/bs157mon/8band_snapshot_lc/'+encodeURIComponent('BAT_157m_eight_band_snapshot_'+source+'.lc.gz');
  const link=el('nasaDownloadLink');
  link.href=url;link.classList.remove('hidden');
  el('nasaDownloadLabel').textContent=source.replace(/^SWIFT_/,'SWIFT ')+' · arquivo oficial .lc.gz';
  el('sourceName').value=source.replace(/^SWIFT_/,'SWIFT ').replaceAll('_',' ');
  el('instrumentName').value='Swift-BAT';
  el('nasaDownloadHelp').textContent='Clique em “Baixar curva .lc.gz” para tentar salvar diretamente. Se o servidor bloquear, use o botão direito → “Salvar link como…”.';
  message('Link oficial preparado. Clique em “Baixar curva .lc.gz” para salvar o arquivo.');
}
el('nasaDownloadLink').addEventListener('click',async event=>{
  event.preventDefault();
  const link=el('nasaDownloadLink'),help=el('nasaDownloadHelp');
  if(!link.href||link.href.endsWith('#')) return;
  if(link.dataset.downloading==='true') return;
  link.dataset.downloading='true';help.classList.remove('error');help.textContent='Baixando a curva oficial da NASA…';
  try{
    const result=await downloadRemoteUrl(link.href,'curva-swift-bat.lc.gz');
    help.textContent=`Download iniciado: ${result.filename} (${(result.size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:2})} MB).`;
    message('Download da curva NASA iniciado.');
  }catch(error){
    help.classList.add('error');
    help.textContent=`O navegador não conseguiu salvar automaticamente. ${downloadFailureText(error)} Para tentar salvar sem abrir o arquivo, clique com o botão direito em “Baixar curva .lc.gz” e escolha “Salvar link como…”.`;
    message('O servidor NASA pode bloquear downloads iniciados por outro site; veja a orientação abaixo do link.','error');
  }finally{link.dataset.downloading='false';}
});

el('nasaPrepareBtn').addEventListener('click',prepareNasaLink);
el('nasaSourceName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();prepareNasaLink();}});

// Keep the eight-band mapping specific to the Swift-BAT 157-month products, while supporting arbitrary column names via selectors.


// ==============================================================
// Catalog plot builder: creates figures from individual-source
// CSV. All catalog graphs are calculated from the imported rows;
// are explicitly labeled as summary statistics, not raw records.
// ============================================================== 
state.articleCharts = [];
state.articleTable = null;
state.articleCleanRows = [];
state.articleHeader = [];
state.articleRawRows = [];

const ARTICLE_PALETTE = ['#8a8dff','#5cdec2','#ffbd78','#f285a3','#71b7ff','#d0a1ff','#b1d765','#ff9e6d','#c4d2ec','#d68aff'];

function destroyArticleCharts(){
  for(const chart of (state.articleCharts || [])){try{removeChartToolbar(chart.canvas);chart.destroy();}catch(_){}}
  state.articleCharts=[];
}
function makeArticleChart(id, config){
  if(!window.Chart) throw new Error('A biblioteca de gráficos não carregou. Confira a conexão à internet e recarregue a página.');
  const canvas=el(id);
  if(!canvas) throw new Error(`Canvas ausente: ${id}`);
  const chart=new Chart(canvas.getContext('2d'),config);
  state.articleCharts.push(chart);
  installChartToolbar(chart);
  return chart;
}
const ARTICLE_ERROR_BARS = {
  id:'articleErrorBars',
  afterDatasetsDraw(chart, args, opts){
    if(!opts || !Array.isArray(opts.errors)) return;
    const meta=chart.getDatasetMeta(0), y=chart.scales.y, ctx=chart.ctx;
    if(!meta || !y) return;
    ctx.save(); ctx.strokeStyle=opts.color || '#d6e1f8'; ctx.lineWidth=1.5;
    meta.data.forEach((element,i)=>{
      const mean=chart.data.datasets[0].data[i], err=opts.errors[i];
      if(!Number.isFinite(mean)||!Number.isFinite(err)) return;
      const top=y.getPixelForValue(mean+err), bottom=y.getPixelForValue(Math.max(0,mean-err));
      const x=element.x, cap=6;
      ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,bottom);
      ctx.moveTo(x-cap,top); ctx.lineTo(x+cap,top);
      ctx.moveTo(x-cap,bottom); ctx.lineTo(x+cap,bottom); ctx.stroke();
    });
    ctx.restore();
  }
};

function parseDelimitedLine(line, delimiter){
  const out=[]; let token='', quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(quoted && line[i+1]==='"'){token+='"';i++;}
      else quoted=!quoted;
    } else if(c===delimiter && !quoted){out.push(token.trim());token='';}
    else token+=c;
  }
  out.push(token.trim());
  return out.map(v=>v.replace(/^\uFEFF/,'').trim());
}
function parseArticleCatalog(text, filename='catalogo.csv'){
  const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim() && !line.trim().startsWith('#'));
  if(lines.length<2) throw new Error('A tabela precisa ter um cabeçalho e pelo menos uma linha de dados.');
  // Detect separator from the header only, so decimal commas in pt-BR
  // numeric cells do not overwhelm a semicolon-delimited CSV.
  const sample=lines[0];
  const counts={',':(sample.match(/,/g)||[]).length,';':(sample.match(/;/g)||[]).length,'\t':(sample.match(/\t/g)||[]).length};
  const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  if(!delimiter || counts[delimiter]===0) throw new Error('Não identifiquei separadores. Use CSV com vírgulas, CSV com ponto e vírgula ou TSV.');
  const header=parseDelimitedLine(lines[0],delimiter);
  if(header.length<2) throw new Error('Não encontrei colunas no cabeçalho.');
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const row=parseDelimitedLine(lines[i],delimiter);
    if(!row.some(v=>v!=='')) continue;
    while(row.length<header.length) row.push('');
    rows.push(row.slice(0,header.length));
  }
  if(!rows.length) throw new Error('Não encontrei registros individuais.');
  return {filename,header,rows,delimiter};
}
function findArticleColumn(header, patterns){
  const normalized=header.map(h=>normName(h));
  for(const p of patterns){const i=normalized.findIndex(n=>p.test(n));if(i>=0)return String(i);}
  return '-1';
}
function populateArticleSelect(id, header, allowBlank, autoValue='-1'){
  const select=el(id); if(!select)return;
  select.innerHTML='';
  const blank=document.createElement('option'); blank.value='-1'; blank.textContent=allowBlank?'Não disponível':'Selecione uma coluna'; select.appendChild(blank);
  header.forEach((h,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${i+1}. ${h}`;select.appendChild(option);});
  select.value=autoValue;
}
function articleNumber(value, delimiter){
  if(value==null) return null;
  let s=String(value).trim().replace(/[\s\u00a0]/g,'');
  if(!s || /^(na|n\/a|nan|null|none|—|-|inf|infinity)$/i.test(s))return null;
  // For semicolon-delimited CSV, comma decimals are common in pt-BR.
  if(delimiter===';' && s.includes(',') && !s.includes('.')) s=s.replace(',','.');
  else if(s.includes(',') && !s.includes('.')) s=s.replace(',','.');
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function downloadTextFile(content, filename, mime='text/csv;charset=utf-8'){
  const blob=new Blob(['\uFEFF',content],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function downloadArticleTemplate(){
  const template='source,class,sampen,modulation_index_percent,bubble_size\n';
  downloadTextFile(template,'modelo_catalogo_sampen_modulacao.csv');
}
function setupArticleMapping(parsed){
  state.articleTable=parsed;
  state.articleHeader=parsed.header;
  state.articleRawRows=parsed.rows;
  populateArticleSelect('articleSourceColumn',parsed.header,true,findArticleColumn(parsed.header,[/^source$/, /^fonte$/, /object name/, /^object$/, /^target$/, /^name$/]));
  populateArticleSelect('articleClassColumn',parsed.header,true,findArticleColumn(parsed.header,[/^class$/, /^classe$/, /optical class/, /classification/, /^tipo$/]));
  populateArticleSelect('articleSampenColumn',parsed.header,false,findArticleColumn(parsed.header,[/^sampen$/, /sample entropy/, /^hse$/, /^h se$/, /^entropy$/]));
  populateArticleSelect('articleModulationColumn',parsed.header,true,findArticleColumn(parsed.header,[/modulation index/, /intrinsic modulation/, /modulation percent/, /^mi$/, /^m percent$/, /^m pct$/]));
  populateArticleSelect('articleBubbleSizeColumn',parsed.header,true,findArticleColumn(parsed.header,[/^n pontos$/, /^n points$/, /number of epochs/, /^epochs$/, /snr/, /signal.to.noise/, /exposure/, /variability/, /variabilidade/]));
  el('articleFileLabel').textContent=`${parsed.filename} · ${parsed.rows.length.toLocaleString('pt-BR')} linhas`;
  el('articleMappingPanel').classList.remove('hidden');
  el('articleUploadEmpty').classList.add('hidden');
  el('analyzeArticleDataBtn').disabled=(el('articleSampenColumn').value==='-1');
  el('articleDataStatus').textContent='Mapeie as colunas e clique em “Gerar gráficos”. Se o índice de modulação não estiver na tabela, o histograma e o resumo de SampEn ainda poderão ser criados.';
}
function collectArticleRows(){
  if(!state.articleTable) throw new Error('Carregue um catálogo CSV/TSV antes de gerar os gráficos.');
  const ix={source:Number(el('articleSourceColumn').value),cls:Number(el('articleClassColumn').value),sampen:Number(el('articleSampenColumn').value),mod:Number(el('articleModulationColumn').value),size:Number(el('articleBubbleSizeColumn').value)};
  if(ix.sampen<0 || !Number.isFinite(ix.sampen)) throw new Error('Selecione a coluna de Sample Entropy.');
  const records=state.articleRawRows.map((row,index)=>({
    source:ix.source>=0?(row[ix.source]||`Fonte ${index+1}`):`Fonte ${index+1}`,
    className:ix.cls>=0?(row[ix.cls]||'Sem classe'):'Sem classe',
    sampen:articleNumber(row[ix.sampen],state.articleTable.delimiter),
    modulation:ix.mod>=0?articleNumber(row[ix.mod],state.articleTable.delimiter):null,
    bubbleSize:ix.size>=0?articleNumber(row[ix.size],state.articleTable.delimiter):null,
    rowNumber:index+2
  }));
  const clean=records.filter(r=>Number.isFinite(r.sampen));
  if(!clean.length) throw new Error('Nenhum valor numérico válido encontrado na coluna de Sample Entropy.');
  state.articleCleanRows=clean;
  return clean;
}
function pearsonCoefficient(rows){
  const pairs=rows.filter(r=>Number.isFinite(r.sampen)&&Number.isFinite(r.modulation));
  if(pairs.length<3)return null;
  const xs=pairs.map(r=>r.modulation), ys=pairs.map(r=>r.sampen); const mx=mean(xs),my=mean(ys);
  const num=pairs.reduce((s,r)=>s+(r.modulation-mx)*(r.sampen-my),0);
  const den=Math.sqrt(pairs.reduce((s,r)=>s+(r.modulation-mx)**2,0)*pairs.reduce((s,r)=>s+(r.sampen-my)**2,0));
  return den>0?num/den:null;
}
function spearmanCoefficient(rows){
  const pairs=rows.filter(r=>Number.isFinite(r.sampen)&&Number.isFinite(r.modulation));
  if(pairs.length<3)return null;
  function rank(values){const sorted=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v), ranks=Array(values.length);let p=0;while(p<sorted.length){let q=p+1;while(q<sorted.length&&sorted[q].v===sorted[p].v)q++;const avg=(p+1+q)/2;for(let k=p;k<q;k++)ranks[sorted[k].i]=avg;p=q;}return ranks;}
  const rx=rank(pairs.map(r=>r.modulation)), ry=rank(pairs.map(r=>r.sampen));
  const mx=mean(rx), my=mean(ry); let num=0,dx=0,dy=0;
  for(let i=0;i<rx.length;i++){const x=rx[i]-mx,y=ry[i]-my;num+=x*y;dx+=x*x;dy+=y*y;}
  return dx>0&&dy>0?num/Math.sqrt(dx*dy):null;
}
function regressionLogLog(rows){
  const pairs=rows.filter(r=>Number.isFinite(r.sampen)&&r.sampen>0&&Number.isFinite(r.modulation)&&r.modulation>0);
  if(pairs.length<3)return {slope:null, intercept:null, n:pairs.length};
  const x=pairs.map(r=>Math.log(r.modulation)), y=pairs.map(r=>Math.log(r.sampen));
  const mx=mean(x), my=mean(y); let num=0,den=0;
  for(let i=0;i<x.length;i++){num+=(x[i]-mx)*(y[i]-my);den+=(x[i]-mx)**2;}
  if(den===0)return {slope:null,intercept:null,n:pairs.length};
  const slope=num/den; return {slope,intercept:my-slope*mx,n:pairs.length};
}
function summarizeByClass(rows,key){
  const groups=new Map();
  for(const row of rows){const val=row[key];if(!Number.isFinite(val))continue;const name=row.className||'Sem classe';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(val);}
  return [...groups.entries()].map(([name,values])=>({name,n:values.length,mean:mean(values),sd:values.length>1?stdSample(values):0})).filter(g=>g.n>0).sort((a,b)=>b.n-a.n);
}
function stdSample(values){if(values.length<2)return 0;const avg=mean(values);return Math.sqrt(values.reduce((s,v)=>s+(v-avg)**2,0)/(values.length-1));}
function renderArticleBars(canvasId, groups, fieldLabel, colorA='#8a8dff'){
  if(!groups.length){return;}
  const base=chartDefaults();
  makeArticleChart(canvasId,{
    type:'bar',
    data:{labels:groups.map(g=>`${g.name} · N=${g.n}`),datasets:[{label:fieldLabel,data:groups.map(g=>g.mean),backgroundColor:groups.map((_,i)=>ARTICLE_PALETTE[i%ARTICLE_PALETTE.length]+'cc'),borderColor:groups.map((_,i)=>ARTICLE_PALETTE[i%ARTICLE_PALETTE.length]),borderWidth:1,borderRadius:4,maxBarThickness:55}]},
    plugins:[ARTICLE_ERROR_BARS],
    options:{...base,plugins:{...base.plugins,legend:{display:false},articleErrorBars:{errors:groups.map(g=>g.sd),color:'#e4eaff'},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>{const g=groups[c.dataIndex];return [`Média: ${g.mean.toLocaleString('pt-BR',{maximumFractionDigits:4})}`,`DP: ${g.sd.toLocaleString('pt-BR',{maximumFractionDigits:4})}`,`N: ${g.n}`];}}}},scales:{...base.scales,y:{...base.scales.y,beginAtZero:true,title:{display:true,text:fieldLabel,color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...base.scales.x,ticks:{...base.scales.x.ticks,maxRotation:25,minRotation:0}}}}
  });
}
function uniqueFiniteCount(values){
  const found=new Set();
  for(const value of values){if(Number.isFinite(value))found.add(Object.is(value,-0)?0:value);}
  return found.size;
}
function finiteMinMax(values){
  let min=Infinity,max=-Infinity;
  for(const value of values){if(!Number.isFinite(value))continue;if(value<min)min=value;if(value>max)max=value;}
  return min===Infinity?{min:null,max:null}:{min,max};
}
function limitPointsForDisplay(items,maxPoints=1800){
  if(items.length<=maxPoints)return items;
  if(maxPoints<=1)return items.length?[items[0]]:[];
  const stride=(items.length-1)/(maxPoints-1),out=[];
  for(let i=0;i<maxPoints;i++)out.push(items[Math.round(i*stride)]);
  return out;
}
function groupRowsForChart(rows,maxGroups=8){
  const grouped=new Map();
  for(const row of rows){const name=row.className||'Sem classe';if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(row);}
  if(grouped.size>maxGroups)return [{name:'Todas as classes',rows}];
  return [...grouped.entries()].map(([name,items])=>({name,rows:items}));
}
function setChartPanelVisibility(id, visible){
  const node=el(id);if(!node)return;
  const panel=node.matches?.('.chart-panel')?node:node.closest?.('.chart-panel');
  if(!panel)return;
  panel.classList.toggle('hidden',!visible);
  const layout=panel.parentElement?.classList.contains('chart-layout')?panel.parentElement:null;
  if(layout){
    const cards=[...layout.children].filter(child=>child.classList.contains('chart-panel'));
    if(cards.length)layout.classList.toggle('hidden',cards.every(card=>card.classList.contains('hidden')));
  }
}
function destroyArticleChartById(id){
  const canvas=el(id);if(!canvas)return;
  const chart=window.Chart?.getChart?.(canvas);
  if(chart){try{removeChartToolbar(chart.canvas);chart.destroy();}catch(_){}state.articleCharts=(state.articleCharts||[]).filter(item=>item!==chart);}
}
function articleHistogramBins(values,maxBins=24){
  const vals=values.filter(Number.isFinite);if(vals.length<1)return [];
  const range=finiteMinMax(vals);let lo=range.min,hi=range.max;if(lo==null||hi==null||lo===hi)return [];
  const nBins=Math.min(maxBins,Math.max(5,Math.ceil(Math.sqrt(vals.length))));
  const width=(hi-lo)/nBins;const bins=Array.from({length:nBins},(_,i)=>({i,low:lo+i*width,high:i===nBins-1?hi:lo+(i+1)*width,count:0}));
  for(const value of vals){let i=Math.floor((value-lo)/width);i=Math.max(0,Math.min(nBins-1,i));bins[i].count++;}
  return bins;
}
function histogramIsUseful(values,minN=15,minDistinct=5){return values.filter(Number.isFinite).length>=minN&&uniqueFiniteCount(values)>=minDistinct;}
function classGroupsCanCompare(groups,minN=3,maxGroups=30){return groups.length>=2&&groups.length<=maxGroups&&groups.every(group=>group.n>=minN);}
function classGroupsCanPlot(groups){return groups.length>=3&&groups.length<=8&&groups.every(group=>group.n>=8);}
function renderArticleResults(rows){
  destroyArticleCharts();
  const advanced=el('articleAdvancedVisuals');if(advanced)advanced.open=false;
  state.articleAdvancedRenderedRows=null;
  const validPairs=rows.filter(r=>Number.isFinite(r.sampen)&&r.sampen>0&&Number.isFinite(r.modulation)&&r.modulation>0);
  const corrPairs=rows.filter(r=>Number.isFinite(r.sampen)&&Number.isFinite(r.modulation)&&r.modulation>=0);
  const r=pearsonCoefficient(corrPairs);let rho=null,fit={slope:null,intercept:null,n:0};
  el('articleDynamicResults').classList.remove('hidden');
  el('articleMetricRows').textContent=rows.length.toLocaleString('pt-BR');
  el('articleMetricSampen').textContent=rows.filter(x=>Number.isFinite(x.sampen)).length.toLocaleString('pt-BR');
  el('articleMetricPairs').textContent=validPairs.length.toLocaleString('pt-BR');
  el('articleMetricPearson').textContent=r==null?'—':r.toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3});

  const notes=[];
  const vals=rows.map(x=>x.sampen).filter(Number.isFinite);
  const base=chartDefaults();
  const globalHistogramOK=histogramIsUseful(vals);
  setChartPanelVisibility('articleSampenHistogram',globalHistogramOK);
  if(globalHistogramOK){
    const bins=articleHistogramBins(vals);
    makeArticleChart('articleSampenHistogram',{type:'bar',data:{labels:bins.map(b=>`${b.low.toFixed(2)}–${b.high.toFixed(2)}`),datasets:[{label:'Número de registros',data:bins.map(b=>b.count),backgroundColor:'#8a8dffbb',borderColor:'#8a8dff',borderWidth:1,borderRadius:2}]},options:{...base,plugins:{...base.plugins,legend:{display:false},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>`${c.parsed.y} registro(s)`}}},scales:{...base.scales,y:{...base.scales.y,beginAtZero:true,title:{display:true,text:'Contagem',color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...base.scales.x,ticks:{...base.scales.x.ticks,maxTicksLimit:9,maxRotation:45,minRotation:0},title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
  }else notes.push(`histograma global ocultado (${vals.length} observações; são necessárias pelo menos 15 observações e 5 valores distintos)`);

  const scatterSourceCount=new Set(validPairs.map(row=>row.source)).size;
  const sourceColumnMapped=Number(el('articleSourceColumn').value)>=0;
  const xDistinct=uniqueFiniteCount(validPairs.map(x=>x.modulation));
  const yDistinct=uniqueFiniteCount(validPairs.map(x=>x.sampen));
  const scatterOK=validPairs.length>=8&&xDistinct>=4&&yDistinct>=4&&(!sourceColumnMapped||scatterSourceCount>=5);
  setChartPanelVisibility('articleSampenModulationScatter',scatterOK);
  if(scatterOK){
    const displayGroups=groupRowsForChart(validPairs,8);
    const spearmanPairs=corrPairs.length>20000?limitPointsForDisplay(corrPairs,20000):corrPairs;
    rho=spearmanCoefficient(spearmanPairs);fit=regressionLogLog(rows);
    const perGroupPointCap=Math.max(1,Math.floor(1800/Math.max(displayGroups.length,1)));
    const datasets=displayGroups.map((group,i)=>({label:group.name,data:limitPointsForDisplay(group.rows,perGroupPointCap).map(x=>({x:x.modulation,y:x.sampen,source:x.source})),backgroundColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],pointRadius:3.5,pointHoverRadius:5}));
    if(fit.slope!==null&&validPairs.length){
      const modulationRange=finiteMinMax(validPairs.map(x=>x.modulation));const minM=modulationRange.min,maxM=modulationRange.max;
      if(minM>0&&maxM>minM)datasets.push({label:`Ajuste log–log (expoente ${fit.slope.toFixed(3)})`,data:[{x:minM,y:Math.exp(fit.intercept+fit.slope*Math.log(minM))},{x:maxM,y:Math.exp(fit.intercept+fit.slope*Math.log(maxM))}],type:'line',showLine:true,pointRadius:0,borderColor:'#f1f4ff',borderDash:[6,5],borderWidth:1.5});
    }
    makeArticleChart('articleSampenModulationScatter',{type:'scatter',data:{datasets},options:{...base,plugins:{...base.plugins,legend:{display:displayGroups.length>1,labels:{color:'#9cabc7',font:{size:10}}},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>{const p=c.raw;return `${p.source||c.dataset.label}: m=${p.x.toLocaleString('pt-BR',{maximumFractionDigits:4})}%; SampEn=${p.y.toLocaleString('pt-BR',{maximumFractionDigits:4})}`;}}}},scales:{x:{type:'logarithmic',grid:{color:'rgba(128,149,190,.08)'},ticks:{color:'#7787a5',font:{family:'DM Mono',size:9}},title:{display:true,text:'Índice de modulação intrínseco (%) · log',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{type:'logarithmic',grid:{color:'rgba(128,149,190,.1)'},ticks:{color:'#7787a5',font:{family:'DM Mono',size:9}},title:{display:true,text:'Sample Entropy · log',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
    const displayedPairs=datasets.filter(dataset=>dataset.type!=='line').reduce((sum,dataset)=>sum+dataset.data.length,0);
    el('articleScatterNote').textContent=`${validPairs.length} pares válidos; ${displayedPairs<validPairs.length?`${displayedPairs} pontos amostrados para exibição; `:''}Pearson = ${r==null?'indisponível':r.toFixed(4)}; Spearman = ${rho==null?'indisponível':rho.toFixed(4)}${spearmanPairs.length<corrPairs.length?` (estimado em amostra de ${spearmanPairs.length})`:''}; expoente log–log = ${fit.slope==null?'indisponível':fit.slope.toFixed(4)} (N=${fit.n}). Pearson e ajuste usam os dados completos.`;
  }else notes.push(`dispersão SampEn × modulação ocultada (${validPairs.length} pares; exige 8 pares, 4 valores distintos em cada eixo e 5 fontes se a coluna fonte estiver mapeada)`);

  const classCountMap=new Map(),classValueSetMap=new Map();
  for(const row of rows){if(Number.isFinite(row.sampen)){const name=row.className||'Sem classe';classCountMap.set(name,(classCountMap.get(name)||0)+1);if(!classValueSetMap.has(name))classValueSetMap.set(name,new Set());classValueSetMap.get(name).add(row.sampen);}}
  const classHistogramCounts=[...new Set(rows.map(row=>row.className||'Sem classe'))].map(name=>({name,n:classCountMap.get(name)||0,distinct:classValueSetMap.get(name)?.size||0}));
  const classHistValuesDistinct=uniqueFiniteCount(vals);
  const classHistogramOK=vals.length>=16&&classHistValuesDistinct>=5&&classHistogramCounts.length>=2&&classHistogramCounts.length<=6&&classHistogramCounts.every(group=>group.n>=8&&group.distinct>=3);
  const bubblePairs=rows.filter(x=>Number.isFinite(x.sampen)&&x.sampen>0&&Number.isFinite(x.modulation)&&x.modulation>0&&Number.isFinite(x.bubbleSize)&&x.bubbleSize>0);
  const bubbleSourceCount=new Set(bubblePairs.map(row=>row.source)).size;
  const bubbleOK=bubblePairs.length>=12&&uniqueFiniteCount(bubblePairs.map(x=>x.modulation))>=4&&uniqueFiniteCount(bubblePairs.map(x=>x.sampen))>=4&&uniqueFiniteCount(bubblePairs.map(x=>x.bubbleSize))>=4&&(!sourceColumnMapped||bubbleSourceCount>=8);
  const sampleGroups=summarizeByClass(rows,'sampen'),modulationGroups=summarizeByClass(rows,'modulation');
  const classMetricOptions=[];
  if(classGroupsCanCompare(sampleGroups))classMetricOptions.push({value:'sampen',label:'Sample Entropy'});
  if(classGroupsCanCompare(modulationGroups))classMetricOptions.push({value:'modulation',label:'Índice de modulação'});
  const advancedOK=classHistogramOK||bubbleOK||classMetricOptions.length>0;
  if(advanced)advanced.classList.toggle('hidden',!advancedOK);
  state.articleChartEligibility={classHistogramOK,bubbleOK,classMetricOptions};
  const classSelect=el('articleClassMetricSelect');if(classSelect){const previous=classSelect.value;classSelect.innerHTML='';classMetricOptions.forEach(option=>{const item=document.createElement('option');item.value=option.value;item.textContent=option.label;classSelect.appendChild(item);});if(classMetricOptions.some(option=>option.value===previous))classSelect.value=previous;else if(classMetricOptions.length)classSelect.value=classMetricOptions[0].value;}
  if(!classHistogramOK)notes.push('histograma por classe exige pelo menos 8 registros válidos e 3 valores distintos em cada classe');
  if(!bubbleOK)notes.push('bolhas não exibidas: seriam poucos pontos ou a terceira variável não varia o suficiente');
  if(!classMetricOptions.length)notes.push('comparação por classe omitida: faltam pelo menos 2 classes com 3 valores válidos cada');
  const selectNote=el('articleChartSelectionNote');if(selectNote)selectNote.textContent=`Seleção automática: ${globalHistogramOK?'histograma global disponível':'sem histograma global'}; ${scatterOK?'dispersão disponível':'sem dispersão confiável'}. ${notes.join('; ')}. Os valores completos permanecem na tabela abaixo.`;
  const advNote=el('articleAdvancedStatus');if(advNote)advNote.textContent='As análises complementares são calculadas apenas ao abrir esta seção. Gráficos redundantes ou com amostra pequena são omitidos; comparações muito pequenas usam tabela.';
  el('articleScatterNote').textContent ||= 'Dispersão indisponível: amostra pequena ou sem variação suficiente nos dois eixos.';
  state.articleDisplayRows=rows;state.articleTablePage=0;renderArticleTablePage();
  el('articleValidRowsLabel').textContent=`${rows.length.toLocaleString('pt-BR')} linhas válidas`;
  el('downloadArticleCleanBtn').disabled=false;
}
function renderArticleClassComparison(rows){
  const select=el('articleClassMetricSelect');const key=select?.value||'sampen';
  const groups=summarizeByClass(rows,key);
  const eligible=classGroupsCanCompare(groups);
  setChartPanelVisibility('articleClassComparisonPanel',eligible);
  if(!eligible)return;
  destroyArticleChartById('articleClassComparison');
  const metricLabel=key==='sampen'?'SampEn média ± DP':'Índice de modulação médio (%) ± DP';
  const title=el('articleClassComparisonTitle');if(title)title.textContent=metricLabel;
  const canPlot=classGroupsCanPlot(groups);
  const chartWrap=el('articleClassComparisonChartWrap'),tableWrap=el('articleClassComparisonTableWrap');
  if(canPlot){
    chartWrap?.classList.remove('hidden');tableWrap?.classList.add('hidden');
    renderArticleBars('articleClassComparison',groups,metricLabel);
    el('articleClassComparisonNote').textContent='Três ou mais classes com amostras suficientes; as barras mostram médias e as barras de erro, o desvio-padrão.';
  }else{
    chartWrap?.classList.add('hidden');tableWrap?.classList.remove('hidden');
    const body=el('articleClassComparisonTable')?.querySelector('tbody');
    if(body)body.innerHTML=groups.map(group=>`<tr><td>${escapeHtml(group.name)}</td><td>${group.n}</td><td>${group.mean.toLocaleString('pt-BR',{maximumFractionDigits:5})}</td><td>${group.sd.toLocaleString('pt-BR',{maximumFractionDigits:5})}</td></tr>`).join('');
    el('articleClassComparisonNote').textContent='Com apenas duas classes ou com grupos pequenos/desiguais, a tabela evita dar destaque visual excessivo a duas ou três colunas.';
  }
}
function renderArticleAdvancedResults(rows){
  if(state.articleAdvancedRenderedRows===rows){requestAnimationFrame(()=>state.articleCharts.filter(chart=>el('articleAdvancedVisuals')?.contains(chart.canvas)).forEach(chart=>chart.resize()));return;}
  for(const id of ['articleSampenHistogramOverlay','articleSampenModulationBubble','articleClassComparison'])destroyArticleChartById(id);
  const eligible=state.articleChartEligibility||{};
  const vals=rows.map(row=>row.sampen).filter(Number.isFinite);
  const bins=articleHistogramBins(vals);
  setChartPanelVisibility('articleSampenHistogramOverlay',Boolean(eligible.classHistogramOK));
  if(eligible.classHistogramOK&&bins.length){
    const classes=[...new Set(rows.map(row=>row.className||'Sem classe'))];
    const sets=classes.map((cls,i)=>{const counts=Array(bins.length).fill(0);rows.filter(row=>(row.className||'Sem classe')===cls&&Number.isFinite(row.sampen)).forEach(row=>{let index=Math.floor((row.sampen-bins[0].low)/(bins[0].high-bins[0].low));index=Math.max(0,Math.min(bins.length-1,index));counts[index]++;});const color=ARTICLE_PALETTE[i%ARTICLE_PALETTE.length];return {label:cls,data:counts,backgroundColor:color+'55',borderColor:color,borderWidth:1,grouped:false,barPercentage:1,categoryPercentage:.92};});
    const base=chartDefaults();makeArticleChart('articleSampenHistogramOverlay',{type:'bar',data:{labels:bins.map(bin=>`${bin.low.toFixed(2)}–${bin.high.toFixed(2)}`),datasets:sets},options:{...base,plugins:{...base.plugins,legend:{display:classes.length>1,position:'bottom',labels:{color:'#9cabc7',font:{size:9},boxWidth:8}},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>`${c.dataset.label}: ${c.parsed.y} registro(s)`}}},scales:{...base.scales,y:{...base.scales.y,beginAtZero:true,title:{display:true,text:'Contagem',color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...base.scales.x,ticks:{...base.scales.x.ticks,maxTicksLimit:9,maxRotation:45,minRotation:0},title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
  }
  setChartPanelVisibility('articleSampenModulationBubble',Boolean(eligible.bubbleOK));
  const note=el('articleBubbleNote');
  if(eligible.bubbleOK){
    const pairs=rows.filter(row=>Number.isFinite(row.sampen)&&row.sampen>0&&Number.isFinite(row.modulation)&&row.modulation>0&&Number.isFinite(row.bubbleSize)&&row.bubbleSize>0);
    const bubbleGroups=groupRowsForChart(pairs,8);
    const sizes=pairs.map(row=>row.bubbleSize),sizeRange=finiteMinMax(sizes),minSize=sizeRange.min,maxSize=sizeRange.max;
    const perGroupBubbleCap=Math.max(1,Math.floor(1200/Math.max(bubbleGroups.length,1)));
    const bubbleSets=bubbleGroups.map((group,i)=>({label:group.name,data:limitPointsForDisplay(group.rows,perGroupBubbleCap).map(row=>({x:row.modulation,y:row.sampen,r:minSize===maxSize?7:4+10*Math.sqrt(Math.max(0,(row.bubbleSize-minSize)/(maxSize-minSize))),source:row.source,sizeValue:row.bubbleSize})),backgroundColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length]+'99',borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],borderWidth:1}));
    const base=chartDefaults();makeArticleChart('articleSampenModulationBubble',{type:'bubble',data:{datasets:bubbleSets},options:{...base,plugins:{...base.plugins,legend:{display:bubbleGroups.length>1,position:'bottom',labels:{color:'#9cabc7',font:{size:9}}},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>{const point=c.raw;return `${point.source||c.dataset.label}: m=${point.x.toLocaleString('pt-BR',{maximumFractionDigits:4})}%; SampEn=${point.y.toLocaleString('pt-BR',{maximumFractionDigits:4})}; tamanho=${point.sizeValue}`;}}}},scales:{x:{type:'logarithmic',grid:{color:'rgba(128,149,190,.08)'},ticks:{color:'#7787a5',font:{family:'DM Mono',size:9}},title:{display:true,text:'Índice de modulação intrínseco (%) · log',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{type:'logarithmic',grid:{color:'rgba(128,149,190,.1)'},ticks:{color:'#7787a5',font:{family:'DM Mono',size:9}},title:{display:true,text:'Sample Entropy · log',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
    const shown=bubbleSets.reduce((sum,set)=>sum+set.data.length,0);
    if(note)note.textContent=`${pairs.length} pares válidos; ${shown<pairs.length?`${shown} pontos amostrados para exibição; `:''}o raio representa “${el('articleBubbleSizeColumn').selectedOptions[0]?.text||'3ª variável'}”. Os dados completos continuam na tabela/exportação.`;
  }else if(note)note.textContent='Bolhas omitidas: precisa de pelo menos 12 pares positivos e de variação nas duas métricas e na terceira variável.';
  renderArticleClassComparison(rows);
  state.articleAdvancedRenderedRows=rows;
  requestAnimationFrame(()=>state.articleCharts.filter(chart=>el('articleAdvancedVisuals')?.contains(chart.canvas)).forEach(chart=>chart.resize()));
}
function renderPagedTable({rows,tableId,pageLabelId,prevButtonId,nextButtonId,page,size,renderRow,emptyColumns}){
  const tbody=el(tableId)?.querySelector('tbody');
  if(!tbody)return {page:0,pages:1};
  const selectId=tableId==='articleDataTable'?'articleRowsPerPage':'batchRowsPerPage';
  const select=el(selectId);
  const sizeValue=select?.value||String(size||100);
  const pageSize=sizeValue==='all'?Math.max(rows.length,1):Math.max(1,Number(sizeValue)||100);
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(Math.max(0,page||0),pages-1);
  const start=currentPage*pageSize,end=Math.min(rows.length,start+pageSize);
  tbody.innerHTML=rows.slice(start,end).map(renderRow).join('') || `<tr><td colspan="${emptyColumns}" class="empty-cell">Nenhum registro para mostrar.</td></tr>`;
  const label=el(pageLabelId);if(label)label.textContent=rows.length?`Linhas ${(start+1).toLocaleString('pt-BR')}–${end.toLocaleString('pt-BR')} de ${rows.length.toLocaleString('pt-BR')}`:'0 registros';
  const prev=el(prevButtonId),next=el(nextButtonId);if(prev)prev.disabled=currentPage<=0;if(next)next.disabled=currentPage>=pages-1;
  return {page:currentPage,pages,pageSize};
}
function renderArticleTablePage(){
  const rows=state.articleDisplayRows||[];
  const result=renderPagedTable({rows,tableId:'articleDataTable',pageLabelId:'articlePageLabel',prevButtonId:'articlePrevPage',nextButtonId:'articleNextPage',page:state.articleTablePage||0,renderRow:row=>`<tr><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.className)}</td><td>${Number.isFinite(row.sampen)?row.sampen.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td><td>${Number.isFinite(row.modulation)?row.modulation.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td></tr>`,emptyColumns:4});
  state.articleTablePage=result.page;
}
function renderBatchTablePage(){
  const rows=batchState.rows||[];
  const result=renderPagedTable({rows,tableId:'batchDataTable',pageLabelId:'batchPageLabel',prevButtonId:'batchPrevPage',nextButtonId:'batchNextPage',page:batchState.tablePage||0,renderRow:r=>`<tr><td>${escapeHtml(r.source)}</td><td>${Number.isFinite(r.window)?r.window:'—'}</td><td>${escapeHtml(r.band)}</td><td>${escapeHtml(r.className)}</td><td>${Number.isFinite(r.time)?r.time.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td><td>${Number.isFinite(r.flux)?r.flux.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td><td>${Number.isFinite(r.sampen)?r.sampen.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td><td>${Number.isFinite(r.variability)?r.variability.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td><td>${Number.isFinite(r.modulation)?r.modulation.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td><td>${Number.isFinite(r.sizeValue)?r.sizeValue.toLocaleString('pt-BR',{maximumFractionDigits:8}):'—'}</td></tr>`,emptyColumns:10});
  batchState.tablePage=result.page;
}
function handleArticleFile(file){
  if(!file)return;
  file.text().then(text=>{
    const parsed=parseArticleCatalog(text,file.name);
    setupArticleMapping(parsed);
    el('articleDataStatus').textContent=`Arquivo lido: ${parsed.rows.length.toLocaleString('pt-BR')} linhas e ${parsed.header.length} colunas. Confira o mapeamento.`;
  }).catch(err=>{
    el('articleMappingPanel').classList.add('hidden');el('articleUploadEmpty').classList.remove('hidden');
    el('articleUploadEmpty').textContent=err.message||'Não foi possível ler esse catálogo.';
  });
}
function exportArticleCleanRows(){
  if(!state.articleCleanRows.length)return;
  const q=v=>{const s=v==null?'':String(v);return '"'+s.replace(/"/g,'""')+'"';};
  const lines=[['source','class','sampen','modulation_index_percent','bubble_size'].join(',')];
  for(const r of state.articleCleanRows) lines.push([r.source,r.className,Number.isFinite(r.sampen)?r.sampen:'',Number.isFinite(r.modulation)?r.modulation:'',Number.isFinite(r.bubbleSize)?r.bubbleSize:''].map(q).join(','));
  downloadTextFile(lines.join('\n'),'catalogo_sampen_modulacao_limpo.csv');
}
function setupArticleLab(){
  el('downloadArticleTemplateBtn')?.addEventListener('click',downloadArticleTemplate);
  el('articleDataFile')?.addEventListener('change',event=>handleArticleFile(event.target.files&&event.target.files[0]));
  el('analyzeArticleDataBtn')?.addEventListener('click',()=>{
    try{
      const rows=collectArticleRows();
      renderArticleResults(rows);
      el('articleDataStatus').textContent=`Gráficos gerados. ${rows.length.toLocaleString('pt-BR')} linhas com SampEn numérica; todos os cálculos permanecem no navegador.`;
      el('articleDynamicResults').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){el('articleDataStatus').textContent=err.message||'Não foi possível gerar os gráficos.';el('articleDataStatus').classList.add('error');}
  });
  el('downloadArticleCleanBtn')?.addEventListener('click',exportArticleCleanRows);
  el('articleRowsPerPage')?.addEventListener('change',()=>{state.articleTablePage=0;renderArticleTablePage();});
  el('articlePrevPage')?.addEventListener('click',()=>{state.articleTablePage=Math.max(0,(state.articleTablePage||0)-1);renderArticleTablePage();});
  el('articleNextPage')?.addEventListener('click',()=>{state.articleTablePage=(state.articleTablePage||0)+1;renderArticleTablePage();});
  el('articleAdvancedVisuals')?.addEventListener('toggle',()=>{const detail=el('articleAdvancedVisuals');if(detail?.open&&state.articleCleanRows?.length)renderArticleAdvancedResults(state.articleCleanRows);});
  el('articleClassMetricSelect')?.addEventListener('change',()=>{if(el('articleAdvancedVisuals')?.open&&state.articleCleanRows?.length)renderArticleClassComparison(state.articleCleanRows);});
  for(const id of ['articleSampenColumn','articleModulationColumn','articleClassColumn','articleSourceColumn','articleBubbleSizeColumn']) el(id)?.addEventListener('change',()=>{el('analyzeArticleDataBtn').disabled=!state.articleTable||el('articleSampenColumn').value==='-1';});
}
setupArticleLab();

// ==============================================================
// Multisource chart gallery: compatible with Python CSV exports.
// ==============================================================
const batchState = { table: null, rawRows: [], rows: [], charts: [], tablePage: 0, advancedChartsRenderedForRows: null, mapped: {source:false, className:false, window:false, band:false, variability:false, modulation:false, size:false, sigma:false, rAbsolute:false, nPoints:false} };
function destroyBatchCharts(){for(const c of batchState.charts){try{removeChartToolbar(c.canvas);c.destroy()}catch(_){}}batchState.charts=[];}
function destroyBatchAdvancedCharts(){const details=el('batchAdvancedVisuals'),keep=[];for(const chart of batchState.charts){if(details?.contains(chart.canvas)){try{removeChartToolbar(chart.canvas);chart.destroy()}catch(_){}}else keep.push(chart);}batchState.charts=keep;}
function setHeatmapZoom(factor){
  const wrap=el('batchHeatmap');if(!wrap)return;
  const current=Number(wrap.dataset.zoomScale||1);
  const next=Math.max(0.6,Math.min(2.5,current*factor));
  wrap.dataset.zoomScale=String(next);wrap.style.setProperty('--heatmap-scale',String(next));
  const label=el('batchHeatmapZoomValue');if(label)label.textContent=`${Math.round(next*100)}%`;
}

function makeBatchChart(id, config){const canvas=el(id);if(!canvas)return null;try{if(window.Chart&&typeof window.Chart.getChart==='function'){const prior=window.Chart.getChart(canvas);if(prior){removeChartToolbar(prior.canvas);prior.destroy();batchState.charts=batchState.charts.filter(chart=>chart!==prior);}}}catch(_){}const c=new Chart(canvas.getContext('2d'),config);batchState.charts.push(c);installChartToolbar(c);return c;}
function clearCanvasMessage(id, text){const canvas=el(id);if(!canvas)return;removeChartToolbar(canvas);const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#8190ad';ctx.textAlign='center';ctx.font='12px sans-serif';ctx.fillText(text,canvas.width/2,Math.max(24,canvas.height/2));}
function downloadBatchTemplate(){
  const template='fonte,janela,banda,tempo,fluxo,sampen,classe_fonte,variabilidade_robusta,modulation_index_percent,sigma,r_absoluto,n_pontos,snr_media\n';
  downloadTextFile(template,'modelo_resultados_python_multifonte.csv');
}
function setupBatchMapping(parsed){
  batchState.table=parsed;batchState.rawRows=parsed.rows;
  const headers=parsed.header;
  populateArticleSelect('batchSourceColumn',headers,true,findArticleColumn(headers,[/^fonte$/, /^source$/, /object name/, /^object$/, /^target$/, /^name$/]));
  populateArticleSelect('batchClassColumn',headers,true,findArticleColumn(headers,[/classe fonte/, /classe_fonte/, /^class$/, /^classe$/, /optical class/, /classification/, /^tipo$/]));
  populateArticleSelect('batchWindowColumn',headers,true,findArticleColumn(headers,[/^janela$/, /^window$/, /window index/, /indice temporal/, /segmento/]));
  populateArticleSelect('batchBandColumn',headers,true,findArticleColumn(headers,[/^banda$/, /^band$/, /energy band/]));
  populateArticleSelect('batchTimeColumn',headers,true,findArticleColumn(headers,[/^tempo$/, /^time$/, /^mjd$/, /timestamp/, /^date$/]));
  populateArticleSelect('batchFluxColumn',headers,true,findArticleColumn(headers,[/^fluxo$/, /^flux$/, /^rate$/, /^taxa$/, /flux value/, /count per second/]));
  populateArticleSelect('batchSampenColumn',headers,true,findArticleColumn(headers,[/^sampen$/, /sample entropy/, /^hse$/, /^h se$/, /^entropy$/]));
  populateArticleSelect('batchVariabilityColumn',headers,true,findArticleColumn(headers,[/variabilidade robusta/, /variabilidade_robusta/, /robust variability/, /^variability$/, /variabilidade/]));
  populateArticleSelect('batchModulationColumn',headers,true,findArticleColumn(headers,[/modulation index/, /intrinsic modulation/, /modulation percent/, /modulation_index_percent/, /indice de modulacao/, /índice de modulação/, /^mi$/, /^m pct$/]));
  populateArticleSelect('batchBubbleSizeColumn',headers,true,findArticleColumn(headers,[/^n pontos$/, /^n validos$/, /n points/, /epochs/, /signal.to.noise/, /^snr/, /exposure/, /numero de pontos/, /number of observations/]));
  populateArticleSelect('batchSigmaColumn',headers,true,findArticleColumn(headers,[/^sigma$/, /^σ$/, /desvio padrao/, /standard deviation/, /\bsigma\b/]));
  populateArticleSelect('batchRAbsoluteColumn',headers,true,findArticleColumn(headers,[/^r absoluto$/, /^r_absoluto$/, /absolute r/, /r absolute/, /tolerancia absoluta/]));
  populateArticleSelect('batchNPointsColumn',headers,true,findArticleColumn(headers,[/^n_pontos$/, /^n pontos$/, /^n points$/, /number of points/, /numero de pontos/, /valid points/]));
  el('batchFileLabel').textContent=`${parsed.filename} · ${parsed.rows.length.toLocaleString('pt-BR')} linhas`;
  el('batchMappingPanel').classList.remove('hidden');el('batchUploadEmpty').classList.add('hidden');
  el('buildBatchGalleryBtn').disabled=(el('batchSampenColumn').value==='-1'&&!(el('batchTimeColumn').value!=='-1'&&el('batchFluxColumn').value!=='-1'));
  el('batchDataStatus').textContent='Confira o mapeamento. Para resultados, selecione SampEn; para curvas brutas, selecione tempo e fluxo/RATE. Fonte e banda habilitam a comparação de curvas entre objetos.';
}
function collectBatchRows(){
  if(!batchState.table)throw new Error('Carregue primeiro um CSV/TSV de resultados Python.');
  const ix={source:Number(el('batchSourceColumn').value),cls:Number(el('batchClassColumn').value),window:Number(el('batchWindowColumn').value),band:Number(el('batchBandColumn').value),time:Number(el('batchTimeColumn').value),flux:Number(el('batchFluxColumn').value),sampen:Number(el('batchSampenColumn').value),variability:Number(el('batchVariabilityColumn').value),modulation:Number(el('batchModulationColumn').value),size:Number(el('batchBubbleSizeColumn').value),sigma:Number(el('batchSigmaColumn').value),rAbsolute:Number(el('batchRAbsoluteColumn').value),nPoints:Number(el('batchNPointsColumn').value)};
  batchState.mapped={source:ix.source>=0,className:ix.cls>=0,window:ix.window>=0,band:ix.band>=0,time:ix.time>=0,flux:ix.flux>=0,sampen:ix.sampen>=0,variability:ix.variability>=0,modulation:ix.modulation>=0,size:ix.size>=0,sigma:ix.sigma>=0,rAbsolute:ix.rAbsolute>=0,nPoints:ix.nPoints>=0};
  const rawCurveMapped=ix.time>=0&&ix.flux>=0;
  if(ix.sampen<0&&!rawCurveMapped)throw new Error('Mapeie Sample Entropy ou, para curvas brutas, mapeie tempo e fluxo/RATE.');
  const rows=batchState.rawRows.map((row,i)=>({
    source:ix.source>=0?(row[ix.source]||`Registro ${i+1}`):`Registro ${i+1}`,
    className:ix.cls>=0?(row[ix.cls]||'Sem classe'):'Sem classe',
    window:ix.window>=0?articleNumber(row[ix.window],batchState.table.delimiter):null,
    band:ix.band>=0?(row[ix.band]||'Sem banda'):'Sem banda',
    time:ix.time>=0?articleNumber(row[ix.time],batchState.table.delimiter):null,
    flux:ix.flux>=0?articleNumber(row[ix.flux],batchState.table.delimiter):null,
    sampen:ix.sampen>=0?articleNumber(row[ix.sampen],batchState.table.delimiter):null,
    variability:ix.variability>=0?articleNumber(row[ix.variability],batchState.table.delimiter):null,
    modulation:ix.modulation>=0?articleNumber(row[ix.modulation],batchState.table.delimiter):null,
    sizeValue:ix.size>=0?articleNumber(row[ix.size],batchState.table.delimiter):null,
    sigma:ix.sigma>=0?articleNumber(row[ix.sigma],batchState.table.delimiter):null,
    rAbsolute:ix.rAbsolute>=0?articleNumber(row[ix.rAbsolute],batchState.table.delimiter):null,
    nPoints:ix.nPoints>=0?articleNumber(row[ix.nPoints],batchState.table.delimiter):null,
    rowNumber:i+2
  })).filter(r=>Number.isFinite(r.sampen)||(Number.isFinite(r.time)&&Number.isFinite(r.flux)));
  if(!rows.length)throw new Error('Não encontrei valores válidos de SampEn nem pares tempo/fluxo. Confira o mapeamento.');
  batchState.rows=rows;batchState.tablePage=0;
  return rows;
}
function batchGroupMean(rows, keys, valueKey='sampen'){
  const map=new Map();
  for(const r of rows){if(!Number.isFinite(r[valueKey]))continue;const key=keys.map(k=>String(r[k]??'')).join('\u001f');if(!map.has(key))map.set(key,{...Object.fromEntries(keys.map(k=>[k,r[k]])),className:r.className,values:[]});map.get(key).values.push(r[valueKey]);}
  return [...map.values()].map(g=>({...g,mean:mean(g.values),sd:stdSample(g.values),n:g.values.length}));
}
function batchDistributionRows(rows){
  if(el('batchDistributionMode').value==='records'||!batchState.mapped.source)return rows.filter(r=>Number.isFinite(r.sampen));
  return batchGroupMean(rows,['source'],'sampen').map(g=>({source:g.source,className:g.className||'Sem classe',sampen:g.mean,n:g.n}));
}
function batchBuildBins(values,maxBins=30){
  const vals=values.filter(Number.isFinite);if(!vals.length)return [];
  const range=finiteMinMax(vals);let lo=range.min,hi=range.max;if(lo==null||hi==null)return [];
  const n=Math.min(maxBins,Math.max(1,Math.ceil(Math.sqrt(vals.length))));
  if(lo===hi){lo-=0.5;hi+=0.5;}
  const w=(hi-lo)/n;const bins=Array.from({length:n},(_,i)=>({low:lo+i*w,high:i===n-1?hi:lo+(i+1)*w,count:0}));
  vals.forEach(v=>{let i=Math.floor((v-lo)/w);i=Math.max(0,Math.min(n-1,i));bins[i].count++;});return bins;
}
function batchMedian(values){
  const sorted=values.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
function batchDensity(values,bins){
  const valid=values.filter(Number.isFinite);
  if(!bins.length||!valid.length)return bins.map(()=>0);
  const width=bins[0].high-bins[0].low;
  if(!(width>0))return bins.map(()=>0);
  const counts=Array(bins.length).fill(0);
  for(const value of valid){
    let index=Math.floor((value-bins[0].low)/width);
    index=Math.max(0,Math.min(bins.length-1,index));
    counts[index]++;
  }
  return counts.map(count=>count/(valid.length*width));
}
function batchBuildBandProfile(sourceBandMeans,bands){
  return bands.map(band=>{
    const values=sourceBandMeans.filter(row=>row.band===band&&Number.isFinite(row.mean)).map(row=>row.mean);
    return {band,n:values.length,mean:mean(values),sd:values.length>1?stdSample(values):0};
  }).filter(row=>Number.isFinite(row.mean));
}
function batchSortBands(values){
  return [...values].sort((a,b)=>{
    const na=Number(String(a).match(/\d+(?:\.\d+)?/)?.[0]);
    const nb=Number(String(b).match(/\d+(?:\.\d+)?/)?.[0]);
    if(Number.isFinite(na)&&Number.isFinite(nb)&&na!==nb)return na-nb;
    return String(a).localeCompare(String(b));
  });
}
const BATCH_HISTOGRAM_MARKERS={
  id:'batchHistogramMarkers',
  afterDatasetsDraw(chart,args,options){
    const area=chart.chartArea,ctx=chart.ctx,markers=options?.markers||[];
    const min=options?.min,max=options?.max;
    if(!area||!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return;
    ctx.save();
    markers.forEach(marker=>{
      if(!Number.isFinite(marker.value)||marker.value<min||marker.value>max)return;
      const x=area.left+((marker.value-min)/(max-min))*(area.right-area.left);
      ctx.beginPath();ctx.setLineDash(marker.kind==='mean'?[5,4]:[2,3]);ctx.lineWidth=1.6;ctx.strokeStyle=marker.color;
      ctx.moveTo(x,area.top);ctx.lineTo(x,area.bottom);ctx.stroke();
    });
    ctx.restore();
  }
};
function groupBatchRowsForScatter(rows,maxSources=10){
  if(batchState.mapped.source){
    const sources=[...new Set(rows.map(row=>row.source))].sort((a,b)=>String(a).localeCompare(String(b)));
    if(sources.length<=maxSources)return sources.map(source=>({name:source,rows:rows.filter(row=>row.source===source)}));
  }
  return groupRowsForChart(rows,8);
}
function batchCorrelation(rows, xKey, yKey){
  const pairs=rows.filter(r=>Number.isFinite(r[xKey])&&Number.isFinite(r[yKey]));if(pairs.length<3)return {pearson:null,spearman:null,n:pairs.length,spearmanN:pairs.length,spearmanApprox:false};
  const xs=pairs.map(r=>r[xKey]),ys=pairs.map(r=>r[yKey]);
  const pearson=(a,b)=>{const ma=mean(a),mb=mean(b);let num=0,da=0,db=0;for(let i=0;i<a.length;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}return da>0&&db>0?num/Math.sqrt(da*db):null;};
  const rank=a=>{const s=a.map((v,i)=>({v,i})).sort((p,q)=>p.v-q.v),out=Array(a.length);let i=0;while(i<s.length){let j=i+1;while(j<s.length&&s[j].v===s[i].v)j++;const av=(i+1+j)/2;for(let k=i;k<j;k++)out[s[k].i]=av;i=j;}return out;};
  const rankPairs=pairs.length>20000?limitPointsForDisplay(pairs,20000):pairs;
  return {pearson:pearson(xs,ys),spearman:pearson(rank(rankPairs.map(r=>r[xKey])),rank(rankPairs.map(r=>r[yKey]))),n:pairs.length,spearmanN:rankPairs.length,spearmanApprox:rankPairs.length<pairs.length};
}
function batchColor(i,alpha='cc'){return (ARTICLE_PALETTE[i%ARTICLE_PALETTE.length]||'#8a8dff')+alpha;}
function batchViridisColor(value){
  const stops=['#440154','#46327e','#365c8d','#277f8e','#1fa187','#4ac16d','#a0da39','#fde725'];
  const t=Math.max(0,Math.min(1,Number.isFinite(value)?value:0.5));
  const position=t*(stops.length-1),index=Math.min(stops.length-2,Math.floor(position)),fraction=position-index;
  const a=stops[index].slice(1),b=stops[index+1].slice(1);
  const channel=(hex,offset)=>parseInt(hex.slice(offset,offset+2),16);
  const mix=(offset)=>Math.round(channel(a,offset)+(channel(b,offset)-channel(a,offset))*fraction).toString(16).padStart(2,'0');
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}
function renderRawSourceOverlay(rows){
  const hasRaw=batchState.mapped.source&&batchState.mapped.band&&batchState.mapped.time&&batchState.mapped.flux;
  if(!hasRaw){setChartPanelVisibility('batchLightcurveSourceOverlay',false);el('batchRawOverlayNote').textContent='Este gráfico precisa de uma tabela ponto a ponto com fonte, banda, tempo e fluxo/RATE.';return;}
  const canvas=el('batchLightcurveSourceOverlay');const chosenBand=el('batchRawBand').value, sourceA=el('batchRawSourceA').value, sourceB=el('batchRawSourceB').value;
  if(!chosenBand||!sourceA){clearCanvasMessage('batchLightcurveSourceOverlay','Selecione a banda e a fonte A');el('batchRawOverlayNote').textContent='Escolha uma banda e pelo menos uma fonte para desenhar a curva.';return;}
  if(!el('batchAdvancedVisuals')?.open){setChartPanelVisibility('batchLightcurveSourceOverlay',true);el('batchRawOverlayNote').textContent='Há dados para sobrepor as curvas. Abra “Exploração avançada” para desenhar apenas quando necessário.';return;}
  const selected=[sourceA,...(sourceB&&sourceB!==sourceA?[sourceB]:[])];
  const colors=['#8a8dff','#5cdec2'];
  const datasets=selected.map((source,i)=>{const allPoints=rows.filter(r=>r.source===source&&r.band===chosenBand&&Number.isFinite(r.time)&&Number.isFinite(r.flux)).map(r=>({x:r.time,y:r.flux})).sort((a,b)=>a.x-b.x);return {label:source,data:limitPointsForDisplay(allPoints,4000),totalPoints:allPoints.length,borderColor:colors[i%colors.length],backgroundColor:colors[i%colors.length]+'22',borderWidth:1.4,pointRadius:0,pointHoverRadius:3,tension:0,spanGaps:false};}).filter(d=>d.data.length);
  if(!datasets.some(dataset=>dataset.data.length>=3)){setChartPanelVisibility('batchLightcurveSourceOverlay',false);el('batchRawOverlayNote').textContent='A seleção não tem pelo menos três pares tempo/fluxo válidos.';return;}
  setChartPanelVisibility('batchLightcurveSourceOverlay',true);
  makeBatchChart('batchLightcurveSourceOverlay',{type:'line',data:{datasets},options:{...chartDefaults(),parsing:false,interaction:{mode:'nearest',intersect:false},plugins:{...chartDefaults().plugins,legend:{display:true,position:'bottom',labels:{color:'#9cabc7',font:{size:9},boxWidth:8}},tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${c.dataset.label}: ${c.parsed.y.toLocaleString('pt-BR',{maximumFractionDigits:7})}`}}},scales:{...chartDefaults().scales,x:{...chartDefaults().scales.x,type:'linear',title:{display:true,text:'Tempo (unidade da tabela importada)',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...chartDefaults().scales.y,title:{display:true,text:'Fluxo / RATE (unidade da tabela importada)',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
  el('batchRawOverlayNote').textContent=`Banda ${chosenBand}: ${datasets.map(d=>`${d.label} (${d.data.length.toLocaleString('pt-BR')}${d.totalPoints>d.data.length?` de ${d.totalPoints.toLocaleString('pt-BR')} pontos exibidos`:''})`).join(' · ')}. A tabela original não é alterada; confirme se tempo, taxa e instrumentos são comparáveis antes de interpretar diferenças.`;
}
function populateRawOverlayControls(rows){
  const bandSel=el('batchRawBand'), aSel=el('batchRawSourceA'), bSel=el('batchRawSourceB');
  const oldBand=bandSel.value,oldA=aSel.value,oldB=bSel.value;
  const ready=batchState.mapped.source&&batchState.mapped.band&&batchState.mapped.time&&batchState.mapped.flux;
  const sources=ready?[...new Set(rows.filter(r=>Number.isFinite(r.time)&&Number.isFinite(r.flux)).map(r=>r.source))].sort((a,b)=>a.localeCompare(b)):[];
  const bands=ready?[...new Set(rows.filter(r=>Number.isFinite(r.time)&&Number.isFinite(r.flux)).map(r=>r.band))].sort((a,b)=>{const na=Number(String(a).match(/\d+/)?.[0]),nb=Number(String(b).match(/\d+/)?.[0]);return Number.isFinite(na)&&Number.isFinite(nb)?na-nb:String(a).localeCompare(String(b));}):[];
  bandSel.innerHTML='';const bo=document.createElement('option');bo.value='';bo.textContent=ready?'Selecione a banda':'Mapeie os campos';bandSel.appendChild(bo);bands.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;bandSel.appendChild(o);});
  aSel.innerHTML='';const ao=document.createElement('option');ao.value='';ao.textContent=ready?'Selecione a fonte':'Mapeie os campos';aSel.appendChild(ao);sources.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;aSel.appendChild(o);});
  bSel.innerHTML='';const none=document.createElement('option');none.value='';none.textContent='Não sobrepor segunda fonte';bSel.appendChild(none);sources.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;bSel.appendChild(o);});
  if(bands.includes(oldBand))bandSel.value=oldBand;else if(bands.length)bandSel.value=bands[0];
  if(sources.includes(oldA))aSel.value=oldA;else if(sources.length)aSel.value=sources[0];
  if(sources.includes(oldB)&&oldB!==aSel.value)bSel.value=oldB;else if(sources.length>1)bSel.value=sources[1];
  if(!ready)el('batchRawOverlayNote').textContent='Para sobrepor curvas brutas, mapeie fonte, banda, tempo e fluxo/RATE no arquivo importado.';
}

function renderBatchGallery(rows,{advancedOnly=false}={}){
  if(advancedOnly)destroyBatchAdvancedCharts();else destroyBatchCharts();
  const renderAdvanced=advancedOnly||Boolean(el('batchAdvancedVisuals')?.open);
  batchState.advancedChartsRenderedForRows=null;
  el('batchGalleryResults').classList.remove('hidden');
  const sources=batchState.mapped.source?[...new Set(rows.map(r=>r.source))].sort((a,b)=>a.localeCompare(b)):[];
  const bands=[...new Set(rows.map(r=>r.band))].sort((a,b)=>{
    const na=Number(String(a).match(/\d+/)?.[0]),nb=Number(String(b).match(/\d+/)?.[0]);return Number.isFinite(na)&&Number.isFinite(nb)?na-nb:String(a).localeCompare(String(b));
  });
  const chartReasons=[];
  const validVar=rows.filter(r=>Number.isFinite(r.variability)&&Number.isFinite(r.sampen));
  const validMod=rows.filter(r=>Number.isFinite(r.modulation)&&Number.isFinite(r.sampen)&&r.modulation>0&&r.sampen>0);
  const dist=batchDistributionRows(rows);
  el('batchMetricRows').textContent=rows.length.toLocaleString('pt-BR');
  el('batchMetricSources').textContent=batchState.mapped.source?sources.length.toLocaleString('pt-BR'):'—';
  el('batchMetricBands').textContent=batchState.mapped.band?bands.length.toLocaleString('pt-BR'):'—';
  el('batchMetricPairs').textContent=validVar.length.toLocaleString('pt-BR');
  if(el('batchDistributionMode').value==='source'&&!batchState.mapped.source)el('batchDataStatus').textContent='Aviso: não há coluna fonte mapeada; o histograma usará cada registro, sem agregação por objeto.';
  const timeSource=el('batchTemporalSource');const oldSource=timeSource.value;timeSource.innerHTML='';
  const optAll=document.createElement('option');optAll.value='';optAll.textContent=batchState.mapped.source?'Selecione uma fonte':'Mapeie uma coluna de fonte';timeSource.appendChild(optAll);
  sources.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;timeSource.appendChild(o);});
  if(sources.includes(oldSource))timeSource.value=oldSource;else if(sources.length===1)timeSource.value=sources[0];
  const base=chartDefaults();
  // Global histogram is withheld when a small/flat sample would create an empty-looking figure.
  const distValues=dist.map(row=>row.sampen).filter(Number.isFinite);
  const bins=batchBuildBins(distValues);
  const globalHistogramOK=histogramIsUseful(distValues);
  if(!advancedOnly){
  setChartPanelVisibility('batchGlobalHistogram',globalHistogramOK);
  if(globalHistogramOK&&bins.length){
    makeBatchChart('batchGlobalHistogram',{type:'bar',data:{labels:bins.map(b=>`${b.low.toFixed(2)}–${b.high.toFixed(2)}`),datasets:[{label:'Registros',data:bins.map(b=>b.count),backgroundColor:'#8a8dffbb',borderColor:'#8a8dff',borderWidth:1,borderRadius:2}]},options:{...base,plugins:{...base.plugins,legend:{display:false},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>`${c.parsed.y} registro(s)`}}},scales:{...base.scales,y:{...base.scales.y,beginAtZero:true,title:{display:true,text:'Contagem',color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...base.scales.x,ticks:{...base.scales.x.ticks,maxTicksLimit:8,maxRotation:45,minRotation:0},title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
  }else{clearCanvasMessage('batchGlobalHistogram','Poucos valores distintos para um histograma informativo');chartReasons.push(`histograma global omitido (N=${distValues.length}; exigidos ≥15 e ≥5 valores distintos)`);}
  }
  // Class histograms: shared edges and probability density (area = 1 per class).
  const clsNames=[...new Set(dist.map(r=>r.className||'Sem classe'))];
  const classRows=new Map(clsNames.map(name=>[name,dist.filter(r=>(r.className||'Sem classe')===name&&Number.isFinite(r.sampen))]));
  const classCounts=clsNames.map(name=>({name,n:classRows.get(name).length,distinct:uniqueFiniteCount(classRows.get(name).map(r=>r.sampen))}));
  const classHistogramOK=globalHistogramOK&&distValues.length>=16&&clsNames.length>=2&&clsNames.length<=6&&classCounts.every(group=>group.n>=8&&group.distinct>=3);
  setChartPanelVisibility('batchClassHistogram',classHistogramOK);
  if(classHistogramOK){
    if(renderAdvanced){
      const binWidth=bins.length?bins[0].high-bins[0].low:0;
      const markers=[];
      const stats=[];
      const sets=clsNames.map((cls,i)=>{
        const rowsForClass=classRows.get(cls),values=rowsForClass.map(r=>r.sampen);
        const density=batchDensity(values,bins);
        const color=ARTICLE_PALETTE[i%ARTICLE_PALETTE.length];
        const avg=mean(values),med=batchMedian(values);
        markers.push({className:cls,kind:'mean',value:avg,color},{className:cls,kind:'median',value:med,color});
        stats.push(`${cls} (N=${values.length}): média ${avg.toFixed(3)} · mediana ${med.toFixed(3)}`);
        return {label:`${cls} (N=${values.length})`,data:density,backgroundColor:color+'66',borderColor:color,borderWidth:1,grouped:false,barPercentage:1,categoryPercentage:1};
      });
      makeBatchChart('batchClassHistogram',{type:'bar',plugins:[BATCH_HISTOGRAM_MARKERS],data:{labels:bins.map(b=>`${b.low.toFixed(2)}–${b.high.toFixed(2)}`),datasets:sets},options:{...base,plugins:{...base.plugins,batchHistogramMarkers:{min:bins[0].low,max:bins[bins.length-1].high,markers},legend:{display:true,position:'bottom',labels:{color:'#c2cde3',font:{size:9},boxWidth:9}},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>`${c.dataset.label}: densidade ${c.parsed.y.toFixed(4)}`,afterBody:items=>{const idx=items[0]?.dataIndex;if(idx==null)return '';const b=bins[idx];return [`Intervalo: ${b.low.toFixed(5)}–${b.high.toFixed(5)}`];}}}},scales:{...base.scales,y:{...base.scales.y,beginAtZero:true,title:{display:true,text:'Densidade de probabilidade',color:'#93a3c0',font:{family:'DM Mono',size:10}}},x:{...base.scales.x,ticks:{...base.scales.x.ticks,maxTicksLimit:8,maxRotation:30,minRotation:0},title:{display:true,text:'Sample Entropy (SampEn)',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
      const note=el('batchClassHistogramNote');if(note)note.textContent=`Bordas compartilhadas; cada classe foi normalizada como densidade (área = 1). Linhas tracejadas = média; pontilhadas = mediana. ${stats.join(' | ')}.`;
    }else{const note=el('batchClassHistogramNote');if(note)note.textContent='Distribuições elegíveis. Abra “Exploração avançada” para desenhar o histograma normalizado e as linhas de média/mediana.';}
  }else{
    clearCanvasMessage('batchClassHistogram','Amostra por classe pequena ou desequilibrada');
    const note=el('batchClassHistogramNote');if(note)note.textContent='Requer pelo menos duas classes, 8 observações e 3 valores distintos por classe; as bordas dos bins são compartilhadas.';
    chartReasons.push('histograma por classe omitido: alguma classe tem poucos registros ou menos de 3 valores distintos');
  }
  // Source-band summary: reduce windows within each source-band before cross-source statistics.
  const sourceBandMeans=(batchState.mapped.source&&batchState.mapped.band)?batchGroupMean(rows.filter(r=>r.band!=='Sem banda'),['source','band']):[];
  const profileBands=batchSortBands(bands.filter(b=>b!=='Sem banda'));
  const profile=batchBuildBandProfile(sourceBandMeans,profileBands);
  const bandProfileOK=profile.length>=3&&profile.every(point=>point.n>=1);
  const showBandSd=bandProfileOK&&profile.every(point=>point.n>=4);
  if(!advancedOnly){
    setChartPanelVisibility('batchBandProfile',bandProfileOK);
    if(bandProfileOK){
      const allSources=[...new Set(sourceBandMeans.map(r=>r.source))].sort((a,b)=>String(a).localeCompare(String(b)));
      const plottedSources=allSources.slice(0,12);
      const perSourceByBand=new Map(sourceBandMeans.map(row=>[`${row.source}\u001f${row.band}`,row.mean]));
      const bandMean=profile.map(p=>p.mean),bandSd=profile.map(p=>p.sd);
      const lower=profile.map((p,i)=>p.mean-p.sd),upper=profile.map((p,i)=>p.mean+p.sd);
      const datasets=[];
      if(showBandSd)datasets.push(
        {label:'__faixa_inferior',data:lower,borderColor:'rgba(0,0,0,0)',backgroundColor:'rgba(138,141,255,0)',pointRadius:0,pointHoverRadius:0,borderWidth:0,fill:false,order:5},
        {label:'__faixa_superior',data:upper,borderColor:'rgba(0,0,0,0)',backgroundColor:'rgba(138,141,255,0.17)',pointRadius:0,pointHoverRadius:0,borderWidth:0,fill:{target:0,above:'rgba(138,141,255,0.17)',below:'rgba(138,141,255,0.17)'},order:5}
      );
      plottedSources.forEach((source,i)=>datasets.push({label:source,data:profile.map(p=>perSourceByBand.get(`${source}\u001f${p.band}`)??null),borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],backgroundColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length]+'33',borderWidth:1.25,pointRadius:2.5,pointHoverRadius:4,tension:0,spanGaps:false,order:2}));
      datasets.push({label:'Média entre fontes',data:bandMean,borderColor:'#f4f7ff',backgroundColor:'#f4f7ff',borderWidth:3.5,pointRadius:4,pointHoverRadius:6,pointBackgroundColor:'#5cdec2',pointBorderColor:'#f4f7ff',tension:0,spanGaps:false,order:1});
      if(showBandSd)datasets.push({label:'±1 DP entre fontes',data:profile.map(()=>null),borderColor:'rgba(138,141,255,.2)',backgroundColor:'rgba(138,141,255,.24)',pointStyle:'rect',pointRadius:6,showLine:false,order:0});
      const finiteBandValues=(showBandSd?[...lower,...upper]:bandMean).filter(Number.isFinite);const yRange=finiteMinMax(finiteBandValues);const pad=(yRange.max-yRange.min)*0.05||0.02;
      makeBatchChart('batchBandProfile', {
        type: 'line',
        data: { labels: profile.map(p => p.band), datasets },
        options: {
          ...base,
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            ...base.plugins,
            legend: {
              display: true, position: 'bottom',
              labels: { color: '#c2cde3', font: { size: 9 }, boxWidth: 9, filter: item => !String(item.text).startsWith('__') }
            },
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                label: context => {
                  const point = profile[context.dataIndex];
                  if (context.dataset.label === 'Média entre fontes') return [`Média: ${point.mean.toFixed(4)}`, `DP amostral: ${point.sd.toFixed(4)}${point.n<4?' (faixa omitida para N < 4)':''}`, `N de fontes: ${point.n}`];
                  if (context.dataset.label === '±1 DP entre fontes') return `Faixa: ${(point.mean-point.sd).toFixed(4)}–${(point.mean+point.sd).toFixed(4)}`;
                  if (String(context.dataset.label).startsWith('__')) return '';
                  return `${context.dataset.label}: ${Number.isFinite(context.parsed.y) ? context.parsed.y.toFixed(4) : 'sem dado'}`;
                }
              }
            }
          },
          scales: {
            ...base.scales,
            y: { ...base.scales.y, min: yRange.min-pad, max: yRange.max+pad, title: { display: true, text: 'Sample Entropy (SampEn)', color: '#93a3c0', font: { family: 'DM Mono', size: 10 } } },
            x: { ...base.scales.x, title: { display: true, text: 'Banda posicional', color: '#93a3c0', font: { family: 'DM Mono', size: 10 } }, ticks: { ...base.scales.x.ticks, maxRotation: 0 } }
          }
        }
      });
      const note=el('batchBandProfileNote');if(note)note.textContent=`Cada linha fina é a média de uma fonte por banda; linha clara espessa = média das fontes; ${showBandSd?'faixa = ±1 DP entre fontes (N ≥ 4 em cada banda).':'faixa de ±1 DP omitida porque alguma banda tem menos de 4 fontes; a média continua visível.'} Cada fonte recebe peso igual após média por fonte × banda.${allSources.length>plottedSources.length?` Para legibilidade, são exibidas ${plottedSources.length} de ${allSources.length} curvas individuais; estatísticas usam todas as fontes.`:''}`;
    }else{clearCanvasMessage('batchBandProfile','Perfil requer pelo menos 3 bandas e 3 fontes por banda');chartReasons.push('perfil por banda omitido: menos de 3 bandas úteis ou poucos objetos por banda');}
  }
  // Source ranking: first average by source and band, then equally weight bands.
  const bySourceBand=batchGroupMean(rows.filter(r=>r.band!=='Sem banda'),['source','band']);
  const bySourceMap=new Map();
  if(batchState.mapped.source&&bySourceBand.length){for(const x of bySourceBand){if(!bySourceMap.has(x.source))bySourceMap.set(x.source,[]);bySourceMap.get(x.source).push(x.mean);}}
  else if(batchState.mapped.source){for(const x of batchGroupMean(rows,['source'])){if(!bySourceMap.has(x.source))bySourceMap.set(x.source,[]);bySourceMap.get(x.source).push(x.mean);}}
  const ranking=[...bySourceMap.entries()].map(([source,values])=>({source,mean:mean(values)})).filter(x=>Number.isFinite(x.mean)).sort((a,b)=>a.mean-b.mean);
  const rankingOK=batchState.mapped.source&&ranking.length>=5&&ranking.length<=40&&uniqueFiniteCount(ranking.map(point=>point.mean))>=4;
  setChartPanelVisibility('batchSourceRanking',rankingOK);
  if(rankingOK){if(renderAdvanced)makeBatchChart('batchSourceRanking',{type:'bar',data:{labels:ranking.map(x=>x.source),datasets:[{label:'SampEn média',data:ranking.map(x=>x.mean),backgroundColor:ranking.map((_,i)=>batchColor(i)),borderColor:ranking.map((_,i)=>ARTICLE_PALETTE[i%ARTICLE_PALETTE.length]),borderWidth:1,borderRadius:3}]},options:{...base,indexAxis:'y',plugins:{...base.plugins,legend:{display:false},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>`SampEn média: ${c.parsed.x.toFixed(4)}`}}},scales:{x:{...base.scales.x,beginAtZero:true,title:{display:true,text:'SampEn média com peso igual por fonte/banda',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...base.scales.y,ticks:{...base.scales.y.ticks,font:{size:8}}}}}});}else{clearCanvasMessage('batchSourceRanking','Ranking omitido em catálogos pequenos ou sem variação');chartReasons.push('ranking por fonte omitido por amostra pequena, pouca variação ou excesso de fontes (mais de 40)');}
  // Heatmap source × band, cells show mean over windows. The table is capped to avoid huge DOM grids.
  const heatEl=el('batchHeatmap');
  const heatValues=sourceBandMeans.map(r=>r.mean).filter(Number.isFinite);const heatRange=finiteMinMax(heatValues);const hmin=heatRange.min??0,hmax=heatRange.max??1;
  const realBands=bands.filter(b=>b!=='Sem banda');
  const heatmapOK=batchState.mapped.source&&batchState.mapped.band&&sourceBandMeans.length>=6&&sources.length>=3&&sources.length<=80&&realBands.length>=2&&realBands.length<=12;
  if(!advancedOnly){
  heatEl.innerHTML='';
  setChartPanelVisibility('batchHeatmap',heatmapOK);
  el('batchHeatmapRange').textContent=heatValues.length?`${hmin.toFixed(3)} — ${hmax.toFixed(3)}`:'Sem dados';
  if(heatmapOK){
    const table=document.createElement('table');table.className='batch-heatmap-table';
    const thead=document.createElement('thead'),headRow=document.createElement('tr');const first=document.createElement('th');first.textContent='Fonte';headRow.appendChild(first);
    bands.filter(b=>b!=='Sem banda').forEach(b=>{const th=document.createElement('th');th.textContent=b;headRow.appendChild(th);});thead.appendChild(headRow);table.appendChild(thead);
    const tbody=document.createElement('tbody');
    const sourceBandMap=new Map(sourceBandMeans.map(row=>[`${row.source}\u001f${row.band}`,row]));
    sources.forEach(source=>{const tr=document.createElement('tr');const th=document.createElement('th');th.textContent=source;tr.appendChild(th);realBands.forEach(b=>{const td=document.createElement('td');const cell=sourceBandMap.get(`${source}\u001f${b}`);if(cell){const t=hmax===hmin?0.5:(cell.mean-hmin)/(hmax-hmin);td.style.backgroundColor=batchViridisColor(t);td.style.color=t>.58?'#10202a':'#f4f7ff';td.textContent=cell.mean.toFixed(3);td.title=`${source} · ${b}: média ${cell.mean.toFixed(6)}; N=${cell.n}`;}else{td.textContent='—';td.className='heatmap-missing';td.title='Sem valor disponível';}tr.appendChild(td);});tbody.appendChild(tr);});table.appendChild(tbody);heatEl.appendChild(table);
  }else{heatEl.textContent=sources.length>80||bands.filter(b=>b!=='Sem banda').length>12?'Matriz omitida para evitar uma grade muito grande; os dados completos continuam na tabela/exportação.':'Matriz omitida: precisa de pelo menos três fontes, duas bandas e seis células válidas.';chartReasons.push('heatmap omitido: poucos dados ou grade excessivamente grande');}
  }
  // Scatter SampEn × robust variability. Heavy chart data/correlations are created only when the advanced section is open.
  const variabilitySourceCount=new Set(validVar.map(row=>row.source)).size;
  const variabilityScatterOK=validVar.length>=8&&uniqueFiniteCount(validVar.map(row=>row.variability))>=4&&uniqueFiniteCount(validVar.map(row=>row.sampen))>=4&&Number(el('batchVariabilityColumn').value)>=0&&(!batchState.mapped.source||variabilitySourceCount>=5);
  setChartPanelVisibility('batchSampenVariability',variabilityScatterOK);
  if(variabilityScatterOK){
    if(renderAdvanced){
      const varGroups=groupBatchRowsForScatter(validVar,10),perGroupPointCap=Math.max(1,Math.floor(1800/Math.max(varGroups.length,1)));
      const sets=varGroups.map((group,i)=>({label:group.name,data:limitPointsForDisplay(group.rows,perGroupPointCap).map(r=>({x:r.variability,y:r.sampen,source:r.source,className:r.className,window:r.window,band:r.band,sigma:r.sigma,rAbsolute:r.rAbsolute,nPoints:Number.isFinite(r.nPoints)?r.nPoints:r.sizeValue})),backgroundColor:batchColor(i,'bb'),borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],pointRadius:3.5,pointHoverRadius:5}));
      makeBatchChart('batchSampenVariability',{type:'scatter',data:{datasets:sets},options:{...base,plugins:{...base.plugins,legend:{display:varGroups.length>1,position:'bottom',labels:{color:'#c2cde3',font:{size:9},boxWidth:9}},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>{const p=c.raw;return `${p.source||c.dataset.label}: variabilidade=${p.x.toPrecision(5)}; SampEn=${p.y.toFixed(4)}`;},afterLabel:c=>{const p=c.raw;return [`Classe: ${p.className||'não informada'}`,`Janela: ${Number.isFinite(p.window)?p.window:'não informada'}`,`Banda: ${p.band||'não informada'}`,`σ: ${Number.isFinite(p.sigma)?p.sigma:'não informado'}`,`r absoluto: ${Number.isFinite(p.rAbsolute)?p.rAbsolute:'não informado'}`,`N pontos: ${Number.isFinite(p.nPoints)?p.nPoints:'não informado'}`];}}}},scales:{...base.scales,x:{...base.scales.x,title:{display:true,text:'Variabilidade robusta (unidade do CSV)',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...base.scales.y,title:{display:true,text:'Sample Entropy (SampEn)',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
      const cr=batchCorrelation(validVar,'variability','sampen');
      const shown=sets.reduce((sum,set)=>sum+set.data.length,0);
      el('batchVariabilityNote').textContent=`N=${validVar.length} pares${shown<validVar.length?`; ${shown} pontos amostrados no gráfico`:''}. Pearson=${cr.pearson==null?'indisponível':cr.pearson.toFixed(4)}; Spearman=${cr.spearman==null?'indisponível':cr.spearman.toFixed(4)}${cr.spearmanApprox?` (estimado em amostra de ${cr.spearmanN})`:''}. Pearson usa os pares válidos completos; Spearman usa todos até 20 mil pares. Janelas da mesma fonte não são amostras independentes.`;
    }else el('batchVariabilityNote').textContent=`${validVar.length} pares elegíveis. O gráfico e as correlações serão calculados somente ao abrir “Exploração avançada”.`;
  }else{clearCanvasMessage('batchSampenVariability','Amostra pequena ou sem variação suficiente');el('batchVariabilityNote').textContent='Dispersão omitida: exige 8 pares, 4 valores distintos por eixo e 5 fontes diferentes quando a fonte está mapeada.';chartReasons.push('dispersão SampEn × variabilidade omitida: poucos pares/fontes ou pouca variação');}

  // Scatter SampEn × intrinsic modulation: use the true modulation column, never a proxy.
  const modulationSourceCount=new Set(validMod.map(row=>row.source)).size;
  const modulationScatterOK=validMod.length>=8&&uniqueFiniteCount(validMod.map(row=>row.modulation))>=4&&uniqueFiniteCount(validMod.map(row=>row.sampen))>=4&&Number(el('batchModulationColumn').value)>=0&&(!batchState.mapped.source||modulationSourceCount>=5);
  setChartPanelVisibility('batchSampenModulation',modulationScatterOK);
  if(modulationScatterOK){
    if(renderAdvanced){
      const modGroups=groupRowsForChart(validMod,8),perGroupPointCap=Math.max(1,Math.floor(1800/Math.max(modGroups.length,1)));
      const sets=modGroups.map((group,i)=>({label:group.name,data:limitPointsForDisplay(group.rows,perGroupPointCap).map(r=>({x:r.modulation,y:r.sampen,source:r.source,window:r.window,band:r.band})),backgroundColor:batchColor(i,'bb'),borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],pointRadius:3.5,pointHoverRadius:5}));
      makeBatchChart('batchSampenModulation',{type:'scatter',data:{datasets:sets},options:{...base,plugins:{...base.plugins,legend:{display:modGroups.length>1,position:'bottom',labels:{color:'#9cabc7',font:{size:9}}}},scales:{x:{type:'logarithmic',grid:{color:'rgba(128,149,190,.08)'},ticks:{color:'#7787a5',font:{family:'DM Mono',size:9}},title:{display:true,text:'Índice de modulação (%) · log',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{type:'logarithmic',grid:{color:'rgba(128,149,190,.08)'},ticks:{color:'#7787a5',font:{family:'DM Mono',size:9}},title:{display:true,text:'Sample Entropy · log',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
      const shown=sets.reduce((sum,set)=>sum+set.data.length,0);
      el('batchModulationNote').textContent=`${validMod.length} pares positivos${shown<validMod.length?`; ${shown} pontos amostrados no gráfico`:''}. A escala log exclui valores não positivos; a coluna mostrada é o índice de modulação real. A tabela mantém todos os registros.`;
    }else el('batchModulationNote').textContent=`${validMod.length} pares positivos elegíveis. O gráfico será desenhado ao abrir “Exploração avançada”.`;
  }else{clearCanvasMessage('batchSampenModulation','Amostra pequena ou sem variação suficiente');el('batchModulationNote').textContent='Dispersão omitida: exige 8 pares positivos, 4 valores distintos por eixo e 5 fontes quando mapeadas.';chartReasons.push('dispersão SampEn × modulação omitida: poucos pares/fontes ou pouca variação');}

  // Bubble plot only when the third dimension varies and enough independent sources are represented.
  const bubbleIdx=Number(el('batchBubbleSizeColumn').value);
  const bubbleRows=rows.filter(r=>Number.isFinite(r.variability)&&Number.isFinite(r.sampen)&&Number.isFinite(r.sizeValue)&&r.sizeValue>0);
  const bubbleSourceCount=new Set(bubbleRows.map(row=>row.source)).size;
  const bubbleOK=bubbleRows.length>=12&&uniqueFiniteCount(bubbleRows.map(row=>row.variability))>=4&&uniqueFiniteCount(bubbleRows.map(row=>row.sampen))>=4&&uniqueFiniteCount(bubbleRows.map(row=>row.sizeValue))>=4&&Number(el('batchVariabilityColumn').value)>=0&&bubbleIdx>=0&&(!batchState.mapped.source||bubbleSourceCount>=8);
  setChartPanelVisibility('batchBubblePlot',bubbleOK);
  if(bubbleOK){
    if(renderAdvanced){
      const sizeRange=finiteMinMax(bubbleRows.map(r=>r.sizeValue)),minS=sizeRange.min,maxS=sizeRange.max;
      const bubbleGroups=groupRowsForChart(bubbleRows,8),perGroupPointCap=Math.max(1,Math.floor(1200/Math.max(bubbleGroups.length,1)));
      const sets=bubbleGroups.map((group,i)=>({label:group.name,data:limitPointsForDisplay(group.rows,perGroupPointCap).map(r=>({x:r.variability,y:r.sampen,r:minS===maxS?7:4+11*Math.sqrt(Math.max(0,(r.sizeValue-minS)/(maxS-minS))),source:r.source,band:r.band,window:r.window,sizeValue:r.sizeValue})),backgroundColor:batchColor(i,'88'),borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],borderWidth:1}));
      makeBatchChart('batchBubblePlot',{type:'bubble',data:{datasets:sets},options:{...base,plugins:{...base.plugins,legend:{display:bubbleGroups.length>1,position:'bottom',labels:{color:'#9cabc7',font:{size:9}}},tooltip:{...base.plugins.tooltip,callbacks:{label:c=>{const p=c.raw;return `${p.source}${p.band?` · ${p.band}`:''}: variabilidade=${p.x.toPrecision(5)}; SampEn=${p.y.toFixed(4)}; tamanho=${p.sizeValue}`;}}}},scales:{...base.scales,x:{...base.scales.x,title:{display:true,text:'Variabilidade robusta (unidade do CSV)',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...base.scales.y,title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
      const shown=sets.reduce((sum,set)=>sum+set.data.length,0);
      el('batchBubbleNote').textContent=`${bubbleRows.length} pares elegíveis${shown<bubbleRows.length?`; ${shown} bolhas amostradas para exibição`:''}. O raio representa “${el('batchBubbleSizeColumn').selectedOptions[0]?.text||'3ª variável'}”; todos os dados permanecem na tabela/exportação.`;
    }else el('batchBubbleNote').textContent=`${bubbleRows.length} pares elegíveis. As bolhas só serão criadas ao abrir “Exploração avançada”.`;
  }else{clearCanvasMessage('batchBubblePlot','Amostra ou variação insuficiente');el('batchBubbleNote').textContent='Bolhas omitidas: exigem 12 pares, 4 valores distintos nas três dimensões e 8 fontes quando mapeadas.';chartReasons.push('bolhas omitidas: amostra pequena, fontes insuficientes ou terceira dimensão pouco informativa');}
  // Temporal overlay for selected source and the 3×3 multi-source panel.
  renderBatchTemporal(rows);
  renderBatchTemporalGrid(rows);
  // Audit table and download button.
  el('batchValidRowsLabel').textContent=`${rows.length.toLocaleString('pt-BR')} linhas válidas`;
  renderBatchTablePage();
  el('downloadBatchCleanBtn').disabled=false;
  if(!advancedOnly)populateRawOverlayControls(rows);
  renderRawSourceOverlay(rows);
  const temporalCandidates=new Map();
  if(batchState.mapped.source&&batchState.mapped.window&&batchState.mapped.band){for(const row of rows){if(!Number.isFinite(row.window)||row.band==='Sem banda'||!Number.isFinite(row.sampen))continue;if(!temporalCandidates.has(row.source))temporalCandidates.set(row.source,{windows:new Set(),bands:new Set()});const group=temporalCandidates.get(row.source);group.windows.add(row.window);group.bands.add(row.band);}}
  const temporalCandidate=[...temporalCandidates.values()].some(group=>group.windows.size>=4&&group.bands.size>=2);
  const rawPointCounts=new Map();
  if(batchState.mapped.source&&batchState.mapped.band&&batchState.mapped.time&&batchState.mapped.flux){for(const row of rows){if(!Number.isFinite(row.time)||!Number.isFinite(row.flux)||row.band==='Sem banda')continue;const key=`${row.source}\u001f${row.band}`;rawPointCounts.set(key,(rawPointCounts.get(key)||0)+1);}}
  const rawOverlayCandidate=[...rawPointCounts.values()].some(count=>count>=3);
  const advancedEligible=classHistogramOK||rankingOK||variabilityScatterOK||modulationScatterOK||bubbleOK||rawOverlayCandidate||temporalCandidate;
  const advancedDetails=el('batchAdvancedVisuals');if(advancedDetails){advancedDetails.classList.toggle('hidden',!advancedEligible);if(!advancedEligible)advancedDetails.open=false;}
  const note=el('batchChartSelectionNote');if(note){const visibleMain=['batchGlobalHistogram','batchBandProfile','batchHeatmap'].filter(id=>{const node=el(id);const panel=node?.matches?.('.chart-panel')?node:node?.closest?.('.chart-panel');return panel&&!panel.classList.contains('hidden');}).length;note.textContent=`Seleção automática: ${visibleMain} visualizações principais adequadas aos dados. ${chartReasons.length?`Algumas alternativas foram omitidas para evitar gráficos vazios ou redundantes: ${chartReasons.join('; ')}.`:'Os gráficos complementares estão recolhidos em “Exploração avançada”.'} ${renderAdvanced?'As análises complementares elegíveis foram desenhadas.':'As análises complementares só serão desenhadas ao abrir “Exploração avançada”.'}`; }
  batchState.advancedChartsRenderedForRows=renderAdvanced?rows:null;
}
function renderBatchTemporal(rows){
  const source=el('batchTemporalSource').value;
  if(!batchState.mapped.source||!batchState.mapped.window||!batchState.mapped.band||!source){setChartPanelVisibility('batchTemporalOverlay',false);el('batchTemporalNote').textContent='A evolução temporal só aparece quando fonte, janela e banda estiverem mapeadas e uma fonte selecionada.';return;}
  const chosen=rows.filter(r=>r.source===source&&Number.isFinite(r.window)&&r.band!=='Sem banda');
  const bands=batchSortBands([...new Set(chosen.map(r=>r.band))]);
  const windows=[...new Set(chosen.map(r=>r.window))];
  const useful=windows.length>=4&&bands.length>=2&&chosen.some(r=>Number.isFinite(r.sampen));
  setChartPanelVisibility('batchTemporalOverlay',useful);
  if(!useful){el('batchTemporalNote').textContent=`Evolução omitida: ${windows.length} janelas e ${bands.length} bandas; são necessárias pelo menos 4 janelas e 2 bandas.`;return;}
  if(!el('batchAdvancedVisuals')?.open){el('batchTemporalNote').textContent=`${source}: há dados em ${windows.length} janelas e ${bands.length} bandas. Abra “Exploração avançada” para desenhar a evolução temporal.`;return;}
  const grouped=batchGroupMean(chosen,['band','window']);
  const perBandCap=Math.max(1,Math.floor(4000/Math.max(bands.length,1)));const datasets=bands.map((band,i)=>{const allPoints=grouped.filter(r=>r.band===band).sort((a,b)=>a.window-b.window).map(r=>({x:r.window,y:r.mean}));return {label:band,data:limitPointsForDisplay(allPoints,perBandCap),totalPoints:allPoints.length,borderColor:ARTICLE_PALETTE[i%ARTICLE_PALETTE.length],backgroundColor:batchColor(i,'22'),borderWidth:1.5,pointRadius:2,pointHoverRadius:4,tension:0,spanGaps:false};});
  makeBatchChart('batchTemporalOverlay',{type:'line',data:{datasets},options:{...chartDefaults(),parsing:false,interaction:{mode:'nearest',intersect:false},plugins:{...chartDefaults().plugins,legend:{display:true,position:'bottom',labels:{color:'#9cabc7',font:{size:9},boxWidth:8}}},scales:{...chartDefaults().scales,x:{...chartDefaults().scales.x,type:'linear',title:{display:true,text:'Janela (índice importado)',color:'#93a3c0',font:{family:'DM Mono',size:10}}},y:{...chartDefaults().scales.y,beginAtZero:true,title:{display:true,text:'Sample Entropy',color:'#93a3c0',font:{family:'DM Mono',size:10}}}}}});
  const shown=datasets.reduce((sum,dataset)=>sum+dataset.data.length,0),total=datasets.reduce((sum,dataset)=>sum+dataset.totalPoints,0);el('batchTemporalNote').textContent=`${source}: ${chosen.length} registros selecionados; ${bands.length} bandas sobrepostas${shown<total?`; ${shown} de ${total} pontos amostrados para o gráfico`:''}. Os valores completos permanecem na tabela/exportação; ausências não são substituídas por zero.`;
}
function getBatchCoincidenceTolerance(){
  const input=el('batchCoincidenceTolerance');
  const value=Number(input?.value);
  return Number.isFinite(value)&&value>0&&value<=10?value:0.001;
}
function formatBatchTolerance(value){
  return Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6,useGrouping:false});
}
function batchTemporalCoincidences(points,tolerance=0.001){
  const byWindow=new Map();
  for(const point of points){if(!Number.isFinite(point.y)||!Number.isFinite(point.x))continue;if(!byWindow.has(point.x))byWindow.set(point.x,[]);byWindow.get(point.x).push(point);}
  const matches=[];
  for(const [window,items] of byWindow){
    const sorted=items.slice().sort((a,b)=>a.y-b.y);
    let start=0;
    while(start<sorted.length){
      let end=start+1;
      while(end<sorted.length&&sorted[end].y-sorted[start].y<=tolerance)end++;
      if(end-start>=2){
        const cluster=sorted.slice(start,end);
        matches.push({x:window,y:mean(cluster.map(item=>item.y)),source:cluster[0].source,bands:cluster.map(item=>item.band),nBands:cluster.length,min:cluster[0].y,max:cluster[cluster.length-1].y,kind:'coincidence'});
        start=end;
      }else start++;
    }
  }
  return matches.sort((a,b)=>a.x-b.x);
}
function renderBatchTemporalGrid(rows){
  const grid=el('batchTemporalGrid'),legend=el('batchTemporalLegend');
  if(!grid||!legend)return;
  const panelId='batchTemporalGrid';
  if(!batchState.mapped.source||!batchState.mapped.window||!batchState.mapped.band){
    setChartPanelVisibility(panelId,false);grid.innerHTML='';legend.innerHTML='';
    el('batchTemporalGridCount').textContent='Sem dados';
    el('batchTemporalGridNote').textContent='Mapeie fonte, janela e banda para construir o painel 3 × 3.';
    return;
  }
  const temporalRows=rows.filter(r=>Number.isFinite(r.window)&&Number.isFinite(r.sampen)&&r.band!=='Sem banda');
  const grouped=batchGroupMean(temporalRows,['source','band','window']);
  const bySource=new Map();
  for(const row of grouped){if(!bySource.has(row.source))bySource.set(row.source,[]);bySource.get(row.source).push({x:row.window,y:row.mean,source:row.source,band:row.band,className:row.className,kind:'band'});}
  const eligibleSources=[...bySource.entries()].filter(([source,points])=>new Set(points.map(p=>p.x)).size>=4&&new Set(points.map(p=>p.band)).size>=2).map(([source,points])=>({source,points:points.sort((a,b)=>a.x-b.x)})).sort((a,b)=>String(a.source).localeCompare(String(b.source)));
  const useful=eligibleSources.length>0;
  setChartPanelVisibility(panelId,useful);
  if(!useful){grid.innerHTML='';legend.innerHTML='';el('batchTemporalGridCount').textContent='Sem dados';el('batchTemporalGridNote').textContent='O painel requer pelo menos uma fonte com quatro janelas válidas em duas ou mais bandas.';return;}
  if(!el('batchAdvancedVisuals')?.open){grid.innerHTML='';legend.innerHTML='';el('batchTemporalGridCount').textContent=`${Math.min(9,eligibleSources.length)} de ${eligibleSources.length} fontes`;el('batchTemporalGridNote').textContent=`Há ${eligibleSources.length} fontes com dados temporais suficientes. Abra “Exploração avançada” para desenhar o painel 3 × 3.`;return;}
  const selected=eligibleSources.slice(0,9);
  const selectedPoints=selected.flatMap(item=>item.points);
  const allBands=batchSortBands([...new Set(selectedPoints.map(point=>point.band))]);
  const bandsForPlot=allBands.slice(0,8);
  const palette=bandsForPlot.map((band,index)=>({band,color:ARTICLE_PALETTE[index%ARTICLE_PALETTE.length]}));
  const range=finiteMinMax(selectedPoints.filter(point=>bandsForPlot.includes(point.band)).map(point=>point.y));
  const span=(range.max??1)-(range.min??0),padding=span*0.04||0.025;
  const ymin=(range.min??0)-padding,ymax=(range.max??1)+padding;
  const coincidenceTolerance=getBatchCoincidenceTolerance();
  const coincidences=selected.flatMap(item=>batchTemporalCoincidences(item.points.filter(point=>bandsForPlot.includes(point.band)),coincidenceTolerance));
  legend.innerHTML='';
  palette.forEach(({band,color})=>{const item=document.createElement('span');item.className='batch-temporal-legend-item';const swatch=document.createElement('i');swatch.style.backgroundColor=color;const label=document.createElement('span');label.textContent=band;item.append(swatch,label);legend.appendChild(item);});
  const diamond=document.createElement('span');diamond.className='batch-temporal-legend-item';const diamondIcon=document.createElement('i');diamondIcon.className='batch-temporal-diamond';const diamondLabel=document.createElement('span');diamondLabel.textContent=`Média do grupo · coincidência (Δ ≤ ${formatBatchTolerance(coincidenceTolerance)})`;diamond.append(diamondIcon,diamondLabel);legend.appendChild(diamond);
  grid.innerHTML='';
  selected.forEach((item,index)=>{
    const card=document.createElement('section');card.className='lightcurve-card batch-temporal-card';
    const header=document.createElement('div');header.className='lightcurve-card-head batch-temporal-card-head';
    const title=document.createElement('strong');title.textContent=item.source;
    const pointMeta=document.createElement('span');pointMeta.textContent=`${new Set(item.points.map(p=>p.x)).size} janelas`;
    header.append(title,pointMeta);
    const wrap=document.createElement('div');wrap.className='batch-temporal-canvas-wrap';
    const canvas=document.createElement('canvas');canvas.id=`batchTemporalGridChart${index}`;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Evolução temporal da Sample Entropy para ${item.source}, oito bandas`);canvas.tabIndex=0;
    wrap.appendChild(canvas);card.append(header,wrap);grid.appendChild(card);
    const perBandCap=Math.max(1,Math.floor(1050/Math.max(bandsForPlot.length,1)));
    const datasets=palette.map(({band,color})=>({label:band,type:'line',data:limitPointsForDisplay(item.points.filter(point=>point.band===band).map(point=>({x:point.x,y:point.y,source:point.source,band:point.band,className:point.className,kind:'band'})).sort((a,b)=>a.x-b.x),perBandCap),borderColor:color,backgroundColor:color+'22',borderWidth:1.35,pointRadius:1.8,pointHoverRadius:4,tension:0,spanGaps:false,showLine:true,order:2}));
    const sourceCoincidences=coincidences.filter(point=>point.source===item.source);
    datasets.push({label:'Coincidência',type:'scatter',data:sourceCoincidences.map(point=>({x:point.x,y:point.y,...point})),showLine:false,pointStyle:'rectRot',pointRadius:5.5,pointHoverRadius:7,pointBackgroundColor:'#080c14',pointBorderColor:'#f2f5ff',pointBorderWidth:1.1,backgroundColor:'#080c14',borderColor:'#f2f5ff',order:0});
    const base=chartDefaults();
    makeBatchChart(canvas.id, {
      type: 'line',
      data: { datasets },
      options: {
        ...base, parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          ...base.plugins,
          legend: { display: false },
          tooltip: {
            ...base.plugins.tooltip,
            callbacks: {
              title: items => items.length ? `Janela ${items[0].parsed.x}` : '',
              label: context => {
                const point = context.raw;
                if (point.kind === 'coincidence') return `Média do grupo de bandas: SampEn = ${point.y.toFixed(6)}`;
                return `${context.dataset.label}: SampEn = ${point.y.toFixed(6)}`;
              },
              afterLabel: context => {
                const point = context.raw;
                if (point.kind === 'coincidence') return [`Bandas envolvidas: ${point.bands.join(', ')}`, `Número de bandas: ${point.nBands}`, `Amplitude máxima: ${(point.max-point.min).toFixed(6)}`];
                return [`Fonte: ${point.source}`, `Classe: ${point.className || 'não informada'}`];
              }
            }
          }
        },
        scales: {
          x: { ...base.scales.x, type: 'linear', title: { display: index >= 6, text: 'Janela', color: '#93a3c0', font: { family: 'DM Mono', size: 9 } }, ticks: { ...base.scales.x.ticks, maxTicksLimit: 5 } },
          y: { ...base.scales.y, min: ymin, max: ymax, title: { display: index % 3 === 0, text: 'SampEn', color: '#93a3c0', font: { family: 'DM Mono', size: 9 } }, ticks: { ...base.scales.y.ticks, maxTicksLimit: 4 } }
        }
      }
    });
  });
  const displayedBandPoints=selected.reduce((sum,item)=>sum+item.points.filter(point=>bandsForPlot.includes(point.band)).length,0);
  const usedSources=selected.length,omittedSources=Math.max(0,eligibleSources.length-usedSources);
  el('batchTemporalGridCount').textContent=`${usedSources} fonte(s) · ${bandsForPlot.length} banda(s)`;
  el('batchTemporalGridNote').textContent=`Diamantes representam a média de agrupamentos na mesma fonte e janela com pelo menos duas bandas cuja amplitude máxima (máximo − mínimo) é ≤ ${formatBatchTolerance(coincidenceTolerance)} em SampEn. A posição do diamante não é uma nova medição. Eixo Y compartilhado: ${ymin.toFixed(3)}–${ymax.toFixed(3)}. ${omittedSources?`${omittedSources} fontes elegíveis adicionais não foram incluídas no painel para manter o formato 3 × 3. `:''}${displayedBandPoints>9500?'O painel pode amostrar pontos para manter a resposta da interface; tabela e exportação não são reduzidas.':''}`;
}
function exportBatchRows(){
  if(!batchState.rows.length)return;const quote=v=>{const s=v==null?'':String(v);return '"'+s.replace(/"/g,'""')+'"';};
  const header=['fonte','classe','janela','banda','tempo','fluxo','sampen','variabilidade_robusta','modulation_index_percent','bubble_size','sigma','r_absoluto','n_pontos'];
  const lines=[header.join(',')];for(const r of batchState.rows)lines.push([r.source,r.className,Number.isFinite(r.window)?r.window:'',r.band,Number.isFinite(r.time)?r.time:'',Number.isFinite(r.flux)?r.flux:'',Number.isFinite(r.sampen)?r.sampen:'',Number.isFinite(r.variability)?r.variability:'',Number.isFinite(r.modulation)?r.modulation:'',Number.isFinite(r.sizeValue)?r.sizeValue:'',Number.isFinite(r.sigma)?r.sigma:'',Number.isFinite(r.rAbsolute)?r.rAbsolute:'',Number.isFinite(r.nPoints)?r.nPoints:''].map(quote).join(','));
  downloadTextFile(lines.join('\n'),'resultados_multifonte_limpos.csv');
}
function handleBatchFile(file){if(!file)return;file.text().then(text=>{const parsed=parseArticleCatalog(text,file.name);setupBatchMapping(parsed);el('batchDataStatus').textContent=`Arquivo lido: ${parsed.rows.length.toLocaleString('pt-BR')} linhas e ${parsed.header.length} colunas. Confira o mapeamento.`;}).catch(err=>{el('batchMappingPanel').classList.add('hidden');el('batchUploadEmpty').classList.remove('hidden');el('batchUploadEmpty').textContent=err.message||'Não foi possível ler a tabela multifonte.';});}
function setupBatchGallery(){
  el('batchAdvancedVisuals')?.addEventListener('toggle',()=>{const details=el('batchAdvancedVisuals');if(!details?.open)return;if(batchState.rows.length&&batchState.advancedChartsRenderedForRows!==batchState.rows)renderBatchGallery(batchState.rows,{advancedOnly:true});requestAnimationFrame(()=>batchState.charts.filter(chart=>details.contains(chart.canvas)).forEach(chart=>chart.resize()));});
  el('batchHeatmapZoomIn')?.addEventListener('click',()=>setHeatmapZoom(1.2));
  el('batchHeatmapZoomOut')?.addEventListener('click',()=>setHeatmapZoom(1/1.2));
  el('batchHeatmapZoomReset')?.addEventListener('click',()=>{const wrap=el('batchHeatmap');if(wrap){wrap.dataset.zoomScale='1';wrap.style.setProperty('--heatmap-scale','1');}const label=el('batchHeatmapZoomValue');if(label)label.textContent='100%';});
  el('downloadBatchTemplateBtn')?.addEventListener('click',downloadBatchTemplate);
  el('batchDataFile')?.addEventListener('change',e=>handleBatchFile(e.target.files&&e.target.files[0]));
  el('buildBatchGalleryBtn')?.addEventListener('click',()=>{try{const rows=collectBatchRows();const advanced=el('batchAdvancedVisuals');if(advanced)advanced.open=false;renderBatchGallery(rows);el('batchDataStatus').textContent=`Galeria gerada com ${rows.length.toLocaleString('pt-BR')} registros. Todos os dados permanecem neste navegador.`;el('batchGalleryResults').scrollIntoView({behavior:'smooth',block:'start'});}catch(err){el('batchDataStatus').textContent=err.message||'Não foi possível gerar a galeria.';el('batchDataStatus').classList.add('error');}});
  el('downloadBatchCleanBtn')?.addEventListener('click',exportBatchRows);
  el('batchRowsPerPage')?.addEventListener('change',()=>{batchState.tablePage=0;renderBatchTablePage();});
  el('batchPrevPage')?.addEventListener('click',()=>{batchState.tablePage=Math.max(0,(batchState.tablePage||0)-1);renderBatchTablePage();});
  el('batchNextPage')?.addEventListener('click',()=>{batchState.tablePage=(batchState.tablePage||0)+1;renderBatchTablePage();});
  el('batchTemporalSource')?.addEventListener('change',()=>{if(batchState.rows.length&&el('batchAdvancedVisuals')?.open)renderBatchGallery(batchState.rows,{advancedOnly:true});});
  el('batchCoincidenceTolerance')?.addEventListener('change',()=>{const input=el('batchCoincidenceTolerance');const value=Number(input?.value);if(!Number.isFinite(value)||value<=0||value>10){input.value='0.001';el('batchCoincidenceHelp').textContent='Informe um valor maior que 0 e até 10. Foi restaurado 0,001.';}else{el('batchCoincidenceHelp').textContent=`O diamante representa a média do grupo de bandas cuja diferença máxima de SampEn é ≤ ${formatBatchTolerance(value)}.`;}if(batchState.rows.length&&el('batchAdvancedVisuals')?.open)renderBatchTemporalGrid(batchState.rows);});
  el('drawRawOverlayBtn')?.addEventListener('click',()=>{if(batchState.rows.length)renderRawSourceOverlay(batchState.rows);});
  for(const id of ['batchRawBand','batchRawSourceA','batchRawSourceB'])el(id)?.addEventListener('change',()=>{if(batchState.rows.length)renderRawSourceOverlay(batchState.rows);});
  for(const id of ['batchSourceColumn','batchClassColumn','batchWindowColumn','batchBandColumn','batchTimeColumn','batchFluxColumn','batchSampenColumn','batchVariabilityColumn','batchModulationColumn','batchBubbleSizeColumn','batchSigmaColumn','batchRAbsoluteColumn','batchNPointsColumn'])el(id)?.addEventListener('change',()=>{const hasSampen=el('batchSampenColumn').value!=='-1',hasRaw=el('batchTimeColumn').value!=='-1'&&el('batchFluxColumn').value!=='-1';el('buildBatchGalleryBtn').disabled=!batchState.table||!(hasSampen||hasRaw);});
}
setupBatchGallery();

function initializeV016UX() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('mel-v016-settings') || 'null'); } catch (_) { return null; } })();
  if(saved){
    if(['1','2','3','4'].includes(String(saved.m)))el('embedding').value=String(saved.m);
    if(Number.isFinite(Number(saved.r))&&Number(saved.r)>0&&Number(saved.r)<=2)el('tolerance').value=String(saved.r);
    if(saved.source)el('sourceName').value=String(saved.source).slice(0,160);
    if(saved.instrument)el('instrumentName').value=String(saved.instrument).slice(0,100);
  }
  updateToleranceControls();
  el('tolerance')?.addEventListener('input',()=>updateToleranceControls());
  el('toleranceSlider')?.addEventListener('input',()=>updateToleranceControls('slider'));
  for(const id of ['embedding','sourceName','instrumentName'])el(id)?.addEventListener('change',saveUiConfig);
  el('runSelfTestBtn')?.addEventListener('click',runLocalSelfTest);
  el('runSensitivityBtn')?.addEventListener('click',runSensitivityAnalysis);
  el('sensitivityBandSelect')?.addEventListener('change',()=>{const btn=el('runSensitivityBtn');if(btn&&state.latestAnalysis){const count=state.results[Number(el('sensitivityBandSelect').value)]?.points?.length||0;btn.disabled=count<8||count>3000;}});
  el('importSessionBtn')?.addEventListener('click',()=>el('importSessionFile')?.click());
  el('importSessionFile')?.addEventListener('change',event=>{importAnalysisSession(event.target.files?.[0]);event.target.value='';});
  el('printReportBtn')?.addEventListener('click',()=>window.print());
  el('mobileAnalyzeBtn')?.addEventListener('click',()=>el('analyzeBtn')?.click());
  el('backToTopBtn')?.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  const updateTopButton=()=>{const button=el('backToTopBtn');if(button)button.classList.toggle('is-visible',window.scrollY>600);};
  window.addEventListener('scroll',updateTopButton,{passive:true}); updateTopButton();
  const coarse=window.matchMedia?.('(pointer: coarse)').matches;
  if(coarse){if(el('dropzoneHeadline'))el('dropzoneHeadline').textContent='Toque para escolher um arquivo';if(el('dropzoneHelp'))el('dropzoneHelp').textContent='Abrir arquivos do dispositivo';}
  const demo=el('heroDemoBtn'); if(demo)demo.setAttribute('aria-describedby','demoResultsNotice');
  document.querySelectorAll('canvas[aria-label]').forEach(canvas=>{canvas.setAttribute('role','img');canvas.setAttribute('tabindex','0');});
  showDependencyHealth(); syncMobileCalculateDock();
  const query = new URLSearchParams(location.hash.slice(1));
  const mHash=query.get('m'), rHash=query.get('r');
  if(mHash&&['1','2','3','4'].includes(mHash))el('embedding').value=mHash;
  if(rHash&&Number.isFinite(Number(rHash))&&Number(rHash)>0&&Number(rHash)<=2)el('tolerance').value=rHash;
  updateToleranceControls();
}
initializeV016UX();

// Interface de navegação dos gráficos: zoom protegido para não capturar a rolagem da página.
(function setupChartNavigationUI(){
  const attached = new WeakSet();
  function chartFor(canvas){
    if (!window.Chart || !canvas) return null;
    return Object.values(Chart.instances || {}).find(chart => chart.canvas === canvas) || null;
  }
  function setPan(chart, enabled){
    if (!chart) return;
    chart.options.plugins = chart.options.plugins || {};
    chart.options.plugins.zoom = chart.options.plugins.zoom || {};
    chart.options.plugins.zoom.pan = {
      ...(chart.options.plugins.zoom.pan || {}),
      enabled, mode: 'xy', threshold: 4
    };
    chart.update('none');
  }
  function attach(panel){
    if (!panel || attached.has(panel) || !panel.querySelector('canvas')) return;
    const canvas = panel.querySelector('canvas');
    const heading = panel.querySelector('.chart-heading');
    if (!heading) return;
    attached.add(panel);
    panel.classList.add('chart-navigation-ready');
    const tools = document.createElement('div');
    tools.className = 'chart-navigation-tools';
    tools.setAttribute('aria-label','Controles de navegação do gráfico');
    const pan = document.createElement('span');
    pan.className='chart-pan-hint';
    pan.textContent='Ctrl + arraste para mover · Ctrl + roda para zoom';
    pan.setAttribute('aria-label','Navegação: mantenha Ctrl e arraste para mover; mantenha Ctrl e use a roda para ampliar');
    const full = document.createElement('button');
    full.type='button'; full.className='chart-tool-button chart-fullscreen-toggle';
    full.innerHTML='<span aria-hidden="true">⛶</span> Tela cheia';
    full.title='Abrir gráfico em tela cheia';
    const reset = document.createElement('button');
    reset.type='button'; reset.className='chart-tool-button chart-view-reset'; reset.textContent='Reset';
    reset.title='Restaurar os eixos e o zoom';
    tools.append(pan, reset, full);
    heading.appendChild(tools);
    const panEnabled=true;
    const syncPan=()=>{const chart=chartFor(canvas);if(chart)setPan(chart,true);};
    reset.addEventListener('click',()=>{
      const chart=chartFor(canvas);
      if(chart && typeof chart.resetZoom==='function') chart.resetZoom();
      else if(chart){ chart.options.scales && Object.values(chart.options.scales).forEach(axis=>{if(axis._originalMin!==undefined)axis.min=axis._originalMin;if(axis._originalMax!==undefined)axis.max=axis._originalMax;}); chart.update(); }
    });
    full.addEventListener('click',()=>{
      const isFull=panel.classList.contains('chart-panel-fullscreen');
      if(isFull){closeFull();return;}
      panel.classList.add('chart-panel-fullscreen');
      document.body.classList.add('chart-fullscreen-open');
      full.innerHTML='<span aria-hidden="true">×</span> Fechar tela cheia';
      full.setAttribute('aria-label','Fechar tela cheia');
      requestAnimationFrame(()=>{const chart=chartFor(canvas);if(chart)chart.resize();});
    });
    function closeFull(){
      panel.classList.remove('chart-panel-fullscreen');
      document.body.classList.remove('chart-fullscreen-open');
      full.innerHTML='<span aria-hidden="true">⛶</span> Tela cheia';
      full.setAttribute('aria-label','Abrir gráfico em tela cheia');
      requestAnimationFrame(()=>{const chart=chartFor(canvas);if(chart)chart.resize();});
    }
    panel.__closeChartFullscreen=closeFull;
    // Charts can be created after the canvas has been inserted into the page.
    let attempts=0; const waitForChart=()=>{const chart=chartFor(canvas);if(chart)setPan(chart,panEnabled);else if(++attempts<60 && canvas.isConnected)requestAnimationFrame(waitForChart);};
    requestAnimationFrame(waitForChart);
  }
  function scan(root=document){
    root.querySelectorAll?.('.chart-panel').forEach(attach);
    root.querySelectorAll?.('.chart-container').forEach(container=>attach(container.closest('.chart-panel')));
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape') document.querySelectorAll('.chart-panel-fullscreen').forEach(panel=>panel.__closeChartFullscreen?.());
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan());else scan();
  const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node.nodeType===1){if(node.matches?.('.chart-panel,.chart-container'))scan(node.parentElement||node);scan(node);}
  })));
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();

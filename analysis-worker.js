/* Multiband Entropy Lab V0.15 — worker de cálculos científicos no navegador. */
'use strict';

importScripts('./analysis-core.js');

function yieldToWorkerQueue() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

self.onmessage = async event => {
  const data = event.data || {};
  const requestId = data.requestId;
  try {
    if (!self.EntropyCore) throw new Error('O núcleo científico não carregou no worker.');

    if (data.type === 'analyze') {
      const { bands = [], m, tolerance } = data;
      const results = [];
      for (let index = 0; index < bands.length; index++) {
        const band = bands[index];
        const points = Array.isArray(band.points) ? band.points : [];
        const progress = {
          type: 'progress', requestId, index: index + 1, total: bands.length,
          label: band.label || `Banda ${index + 1}`, points: points.length
        };
        self.postMessage({ ...progress, phase: 'start' });
        // Give the UI a chance to display the current band before CPU work begins.
        await yieldToWorkerQueue();
        const sample = self.EntropyCore.sampleEntropy(points.map(point => point.y), m, tolerance);
        const modulation = self.EntropyCore.intrinsicModulation(
          points.map(point => ({ y: point.y, error: point.error })),
          Number.isInteger(band.errorIndex) && band.errorIndex >= 0
        );
        results.push({ sample, modulation });
        self.postMessage({ ...progress, phase: 'done' });
        // Permit the main thread to receive the progress event between bands.
        await yieldToWorkerQueue();
      }
      self.postMessage({ type: 'result', requestId, results });
      return;
    }

    if (data.type === 'match-pairs') {
      const result = self.EntropyCore.sampleEntropy(data.series || [], data.m, data.tolerance, { maxMatchPairs: 12 });
      self.postMessage({
        type: 'match-pairs', requestId,
        matchPairs: result.matchPairs || { m: [], mPlus1: [], maxStoredPerDimension: 12 }
      });
      return;
    }

    if (data.type === 'sensitivity') {
      const { series = [], mValues = [], rValues = [] } = data;
      const results = [];
      const total = mValues.length * rValues.length;
      let completed = 0;
      for (const m of mValues) {
        for (const r of rValues) {
          await yieldToWorkerQueue();
          const sample = self.EntropyCore.sampleEntropy(series, m, r);
          results.push({ m, r, value: sample.value, A: sample.A, B: sample.B, reason: sample.reason });
          completed++;
          self.postMessage({ type: 'progress', requestId, phase: 'cell', completed, total, m, r });
        }
      }
      self.postMessage({ type: 'result', requestId, results });
      return;
    }

    throw new Error(`Tarefa desconhecida: ${String(data.type || 'sem tipo')}`);
  } catch (error) {
    self.postMessage({ type: 'error', requestId, message: error?.message || String(error) });
  }
};

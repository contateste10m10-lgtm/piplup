/*
 * Multiband Entropy Lab — núcleo científico testável.
 * SampEn segue H_SE = -ln(A/B), distância de Chebyshev e exclusão de auto-pares.
 * O índice de modulação usa a definição intrínseca do artigo de referência.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EntropyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.5.0';

  function finiteSeries(values) {
    return Array.from(values ?? []).filter(Number.isFinite).map(Number);
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function populationStd(values) {
    if (!values.length) return null;
    const center = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
  }

  function getNeighborOffsets(dimensions) {
    const offsets = [];
    const current = Array(dimensions).fill(0);
    function build(depth) {
      if (depth === dimensions) {
        offsets.push(current.slice());
        return;
      }
      for (let step = -1; step <= 1; step++) {
        current[depth] = step;
        build(depth + 1);
      }
    }
    build(0);
    return offsets;
  }

  function createPairSampler(limit, seed) {
    return limit > 0 ? { limit, pairs: [], seen: 0, seed: seed >>> 0 } : null;
  }

  // Deterministic reservoir sampling keeps a representative, bounded set of
  // real matches for visualization without storing every pair in dense series.
  function rememberPair(sampler, i, j) {
    if (!sampler) return;
    sampler.seen++;
    if (sampler.pairs.length < sampler.limit) {
      sampler.pairs.push([i, j]);
      return;
    }
    sampler.seed = (Math.imul(sampler.seed, 1664525) + 1013904223) >>> 0;
    const slot = Math.floor((sampler.seed / 4294967296) * sampler.seen);
    if (slot < sampler.limit) sampler.pairs[slot] = [i, j];
  }

  function bruteForceMatches(z, dimension, radius, sampler = null) {
    const nTemplates = z.length - dimension + 1;
    let matches = 0;
    for (let i = 0; i < nTemplates; i++) {
      for (let j = i + 1; j < nTemplates; j++) {
        let match = true;
        for (let k = 0; k < dimension; k++) {
          if (Math.abs(z[i + k] - z[j + k]) > radius) {
            match = false;
            break;
          }
        }
        if (match) { matches++; rememberPair(sampler, i, j); }
      }
    }
    return matches;
  }

  // Uniform-grid search counts all pairs for a fixed embedding dimension. B
  // and A are counted separately for dimensions m and m+1, matching the
  // project's reference Python/cKDTree routine. Equivalence to EntropyHub v2.0
  // still requires a direct numerical comparison on identical series.
  function gridMatches(z, dimension, radius, sampler = null) {
    const nTemplates = z.length - dimension + 1;
    const offsets = getNeighborOffsets(dimension);
    const buckets = new Map();
    let matches = 0;

    for (let i = 0; i < nTemplates; i++) {
      const cell = Array.from({ length: dimension }, (_, k) => Math.floor(z[i + k] / radius));
      for (const offset of offsets) {
        const neighborKey = cell.map((value, k) => value + offset[k]).join(',');
        const candidates = buckets.get(neighborKey);
        if (!candidates) continue;
        for (const j of candidates) {
          let match = true;
          for (let k = 0; k < dimension; k++) {
            if (Math.abs(z[i + k] - z[j + k]) > radius) {
              match = false;
              break;
            }
          }
          if (match) { matches++; rememberPair(sampler, j, i); }
        }
      }
      const key = cell.join(',');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }
    return matches;
  }

  function countMatches(z, dimension, radius, sampler = null) {
    const nTemplates = z.length - dimension + 1;
    if (nTemplates < 2) return 0;
    return nTemplates < 700
      ? bruteForceMatches(z, dimension, radius, sampler)
      : gridMatches(z, dimension, radius, sampler);
  }

  /**
   * Sample Entropy H_SE = -ln(A/B), with independent pair counts at
   * embedding dimensions m (B) and m+1 (A), as defined in the paper.
   * r = toleranceMultiplier * population SD(series), following NumPy's default
   * convention used by the documented EntropyHub API. Auto-pairs are excluded;
   * each unordered pair is counted once, and equality at r is included.
   */
  function sampleEntropy(series, m = 2, toleranceMultiplier = 0.2, options = {}) {
    const x = finiteSeries(series);
    const requestedPairLimit = Number.isInteger(options?.maxMatchPairs) ? options.maxMatchPairs : 0;
    const pairLimit = Math.max(0, Math.min(100, requestedPairLimit));
    const emptyMatchPairs = pairLimit > 0 ? { m: [], mPlus1: [], maxStoredPerDimension: pairLimit } : undefined;
    if (!Number.isInteger(m) || m < 1) throw new RangeError('A dimensão m deve ser um inteiro positivo.');
    if (!Number.isFinite(toleranceMultiplier) || toleranceMultiplier <= 0) throw new RangeError('A tolerância deve ser maior que zero.');

    const n = x.length;
    if (n < m + 2) {
      return { value: null, reason: 'Poucos pontos para formar pares', sigma: null, r: null, A: 0, B: 0, n, ...(emptyMatchPairs ? { matchPairs: emptyMatchPairs } : {}) };
    }
    const center = mean(x);
    const sigma = populationStd(x);
    if (sigma === 0) {
      return { value: null, reason: 'Série constante (σ = 0)', sigma, r: 0, A: 0, B: 0, n, ...(emptyMatchPairs ? { matchPairs: emptyMatchPairs } : {}) };
    }
    if (!Number.isFinite(sigma) || !Number.isFinite(center)) {
      return { value: null, reason: 'Escala numérica não finita', sigma, r: null, A: 0, B: 0, n, ...(emptyMatchPairs ? { matchPairs: emptyMatchPairs } : {}) };
    }
    const r = toleranceMultiplier * sigma;
    const radius = toleranceMultiplier;
    const z = x.map(value => (value - center) / sigma);
    const mSampler = createPairSampler(pairLimit, 0x13579bdf);
    const mPlus1Sampler = createPairSampler(pairLimit, 0x2468ace0);

    // B counts pairs at dimension m; A independently counts pairs at m+1.
    // Optional pair sampling records only a bounded, representative subset for
    // the user-facing illustration; it never changes the scientific counts.
    const B = countMatches(z, m, radius, mSampler);
    const A = countMatches(z, m + 1, radius, mPlus1Sampler);
    const matchPairs = pairLimit > 0
      ? { m: mSampler.pairs, mPlus1: mPlus1Sampler.pairs, maxStoredPerDimension: pairLimit }
      : undefined;
    if (B === 0) return { value: null, reason: 'B = 0 (nenhum par semelhante)', sigma, r, A, B, n, ...(matchPairs ? { matchPairs } : {}) };
    if (A === 0) return { value: null, reason: 'A = 0 (nenhuma extensão semelhante)', sigma, r, A, B, n, ...(matchPairs ? { matchPairs } : {}) };
    const estimate = -Math.log(A / B);
    return { value: Object.is(estimate, -0) ? 0 : estimate, reason: 'OK', sigma, r, A, B, n, ...(matchPairs ? { matchPairs } : {}) };
  }

  /**
   * Intrinsic modulation index, in percent:
   * m = 100 * sqrt(S^2 - mean(error^2)) / mean(flux).
   * S^2 uses sample variance (N-1), matching the user's reference script;
   * the source article gives the formula but does not specify this divisor.
   * Only observations with finite flux and finite non-negative uncertainties
   * enter this estimate. Mean flux is not replaced by its absolute value.
   */
  function intrinsicModulation(points, hasErrorColumn = true) {
    const all = Array.from(points ?? []).filter(p => Number.isFinite(p?.y));
    if (!hasErrorColumn) {
      return {
        value: null, reason: 'Coluna de incerteza não selecionada', status: 'missing_error_column',
        nRate: all.length, nUsed: 0, nErrorExcluded: all.length, meanFlux: mean(all.map(p => p.y)),
        observedVariance: null, noiseVariance: null, intrinsicVariance: null, rmsIntrinsic: null
      };
    }
    const valid = all.filter(p => Number.isFinite(p?.error) && p.error >= 0);
    const nErrorExcluded = all.length - valid.length;
    const flux = valid.map(p => p.y);
    const errors = valid.map(p => p.error);
    const n = flux.length;
    const avg = mean(flux);
    const base = {
      value: null, reason: '', status: 'unavailable', nRate: all.length, nUsed: n,
      nErrorExcluded, meanFlux: avg, observedVariance: null, noiseVariance: null,
      intrinsicVariance: null, rmsIntrinsic: null
    };
    if (n < 2) {
      return { ...base, reason: 'Menos de 2 pontos com fluxo e incerteza válidos', status: 'insufficient_paired_data' };
    }
    const varianceObserved = flux.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (n - 1);
    const varianceNoise = mean(errors.map(error => error ** 2));
    let varianceIntrinsic = varianceObserved - varianceNoise;
    const varianceScale = Math.max(Number.MIN_VALUE, Math.abs(varianceObserved), Math.abs(varianceNoise));
    const numericalTolerance = 1e-12 * varianceScale;
    if (varianceIntrinsic < 0 && Math.abs(varianceIntrinsic) <= numericalTolerance) varianceIntrinsic = 0;
    const calculated = { ...base, observedVariance: varianceObserved, noiseVariance: varianceNoise, intrinsicVariance: varianceIntrinsic };

    if (!Number.isFinite(avg) || avg <= 0) {
      return { ...calculated, reason: 'Fluxo médio não positivo; a fórmula do artigo não define um índice percentual válido', status: 'nonpositive_mean' };
    }
    if (![varianceObserved, varianceNoise, varianceIntrinsic].every(Number.isFinite)) {
      return { ...calculated, reason: 'Variância observada/corrigida não finita', status: 'nonfinite_variance' };
    }
    if (varianceIntrinsic < 0) {
      return { ...calculated, reason: 'Variância corrigida pelo ruído negativa', status: 'negative_intrinsic_variance' };
    }
    const rmsIntrinsic = Math.sqrt(varianceIntrinsic);
    const value = 100 * rmsIntrinsic / avg;
    if (!Number.isFinite(value)) {
      return { ...calculated, rmsIntrinsic, reason: 'O índice percentual não é finito para esta média de fluxo', status: 'nonfinite_result' };
    }
    const partial = nErrorExcluded > 0;
    return {
      ...calculated, value, rmsIntrinsic,
      reason: partial ? 'Calculado com subconjunto: algumas incertezas faltam ou são inválidas' : (varianceIntrinsic === 0 ? 'Variância intrínseca estimada igual a zero' : 'OK'),
      status: partial ? 'partial_uncertainties' : (varianceIntrinsic === 0 ? 'zero_intrinsic_variance' : 'OK')
    };
  }

  return { VERSION, mean, populationStd, sampleEntropy, intrinsicModulation };
});

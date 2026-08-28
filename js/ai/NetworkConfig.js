'use strict';

/**
 * NetworkConfig — architecture dimensions and the REAL parameter-count math.
 * The hidden part of the network is user-editable (architecture editor);
 * input (8) and output (3) are fixed by the observation/action design.
 *
 * Nothing is hard-coded: given dims [8, h1, ..., hk, 3] the layout offsets and
 * parameter count are derived. Defaults stay [16, 15] -> 447 params.
 */

export const INPUT_SIZE = 18;
export const OUTPUT_SIZE = 3;
export const DEFAULT_HIDDEN = [16, 15];

/** Editor guard rails — keeps training fast and SVG inspection readable. */
export const ARCH_LIMITS = Object.freeze({
  minHiddenLayers: 0,     // 0 -> direct linear 8->3 map (allowed, discouraged)
  maxHiddenLayers: 4,
  minNodesPerLayer: 2,
  maxNodesPerLayer: 32,
  maxParams: 5000,        // population of 150 stays comfortably real-time
});

/** Validate + coerce a hidden-size array. Throws with a precise message. */
export function normalizeHidden(hidden = DEFAULT_HIDDEN) {
  if (!Array.isArray(hidden)) throw new Error('Hidden sizes must be an array');
  if (hidden.length < ARCH_LIMITS.minHiddenLayers) throw new Error('Too few hidden layers');
  if (hidden.length > ARCH_LIMITS.maxHiddenLayers) {
    throw new Error(`At most ${ARCH_LIMITS.maxHiddenLayers} hidden layers`);
  }
  return hidden.map((n) => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < ARCH_LIMITS.minNodesPerLayer || v > ARCH_LIMITS.maxNodesPerLayer) {
      throw new Error(`Layer size must be an integer ${ARCH_LIMITS.minNodesPerLayer}–${ARCH_LIMITS.maxNodesPerLayer}`);
    }
    return v;
  });
}

/** Full dimension vector [8, ...hidden, 3]. */
export function fullDims(hidden = DEFAULT_HIDDEN) {
  return [INPUT_SIZE, ...normalizeHidden(hidden), OUTPUT_SIZE];
}

/**
 * Parameter count for a full dims vector (hidden sizes validated):
 *   sum over adjacent pairs of (in*out weights + out biases)
 * Returns { total, weights, biases, layers:[{weights,biases}] }.
 */
export function calculateParameterCount(dims = fullDims()) {
  if (!Array.isArray(dims) || dims.length < 2 || dims.length > ARCH_LIMITS.maxHiddenLayers + 2) {
    throw new Error('Invalid dims vector');
  }
  const shape = [dims[0], ...normalizeHidden(dims.slice(1, -1)), dims[dims.length - 1]];
  let weights = 0, biases = 0;
  const layers = [];
  for (let l = 0; l < shape.length - 1; l++) {
    const w = shape[l] * shape[l + 1];
    const b = shape[l + 1];
    weights += w; biases += b;
    layers.push({ weights: w, biases: b });
  }
  return { total: weights + biases, weights, biases, layers };
}

/**
 * Flat Float32Array layout for a dims vector. Weight matrix for layer L is
 * row-major with rows = layer size, cols = next layer size (matches forward():
 * p[wOffset + i*outSize + j]); its bias vector follows immediately after.
 * Returns [{ w, b, inSize, outSize }, ..., { total }].
 */
export function buildLayout(dims = fullDims()) {
  const layers = [];
  let o = 0;
  for (let l = 0; l < dims.length - 1; l++) {
    const inSize = dims[l], outSize = dims[l + 1];
    layers.push({ w: o, b: o + inSize * outSize, inSize, outSize });
    o += inSize * outSize + outSize;
  }
  layers.total = o;
  return layers;
}

/** '8→16→15→3' style label. */
export function shapeLabel(dims = fullDims()) {
  return dims.join('→');
}

/* ---- Default-architecture derivations (kept for convenience/tests) ---- */
export const PARAM_COUNT = calculateParameterCount(fullDims(DEFAULT_HIDDEN)).total;

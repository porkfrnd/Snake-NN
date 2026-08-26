'use strict';

import { Random } from '../utils/Random.js';
import {
  fullDims, buildLayout, calculateParameterCount, normalizeHidden,
  DEFAULT_HIDDEN, ARCH_LIMITS,
} from './NetworkConfig.js';
import { activate, initStd, isActivation, DEFAULT_ACTIVATION } from './ActivationFunctions.js';

/**
 * NeuralNetwork — fully-connected MLP with a user-editable hidden shape
 * (default 8 → 16 → 15 → 3). Parameters live in one flat Float32Array whose
 * layout is derived from this network's own dimensions; forward() runs through
 * reusable per-layer scratch buffers — zero allocation per call.
 * Knows nothing about Snake.
 *
 * Numerical safety: sanitize() detects NaN/±Infinity parameters and repairs
 * them, so a poisoned genome can never silently spread through the population.
 */
export class NeuralNetwork {
  params;
  activation;
  dims;     // [8, ...hidden, 3]
  layout;   // [{w,b,inSize,outSize}, ..., total]

  #acts = []; // scratch activations per layer (hidden..output)

  constructor(opts = {}) {
    const activation = opts.activation ?? DEFAULT_ACTIVATION;
    if (!isActivation(activation)) throw new Error(`Unknown activation: ${activation}`);
    this.activation = activation;

    // Shape: explicit dims win; otherwise derive from hidden sizes or default.
    if (opts.dims) {
      if (!Array.isArray(opts.dims) || opts.dims.length < 2 || opts.dims.length > ARCH_LIMITS.maxHiddenLayers + 2) {
        throw new Error('Invalid dims vector');
      }
      this.dims = [opts.dims[0], ...normalizeHidden(opts.dims.slice(1, -1)), opts.dims[opts.dims.length - 1]];
    } else {
      this.dims = fullDims(opts.hidden ?? DEFAULT_HIDDEN);
    }
    this.layout = buildLayout(this.dims);
    const count = this.layout.total;

    for (let l = 1; l < this.dims.length; l++) this.#acts.push(new Float32Array(this.dims[l]));

    if (opts.params) {
      if (!(opts.params instanceof Float32Array) || opts.params.length !== count) {
        throw new Error(`params must be Float32Array(${count})`);
      }
      this.params = new Float32Array(opts.params); // own copy, always
    } else {
      this.params = new Float32Array(count);
      this.#randomInit(opts.rng);
    }
    this.sanitize();
  }

  get parameterCount() { return this.layout.total; }
  get shape() { return this.dims.slice(); }
  get hidden() { return this.dims.slice(1, -1); }

  #randomInit(rng) {
    const rand = rng ?? new Random();
    for (const L of this.layout) {
      const s = initStd(this.activation, L.inSize);
      const n = L.inSize * L.outSize;
      for (let i = 0; i < n; i++) this.params[L.w + i] = rand.gaussian() * s;
      // biases start at 0
    }
  }

  /** z = W·x + b, a = activation(z) on every layer except the raw-logit output. */
  forward(inputs) {
    const p = this.params;
    const act = this.activation;
    let prev = inputs;

    for (let l = 0; l < this.layout.length; l++) {
      const L = this.layout[l];
      const out = this.#acts[l];
      const last = l === this.layout.length - 1;
      const inSize = L.inSize, outSize = L.outSize;

      for (let j = 0; j < outSize; j++) {
        let sum = p[L.b + j];
        const col = L.w + j;
        for (let i = 0; i < inSize; i++) {
          const v = prev[i];
          if (Number.isFinite(v)) sum += v * p[col + i * outSize];
        }
        out[j] = last ? sum : activate(act, sum);
      }
      prev = out;
    }
    return prev; // the output buffer (Float32Array(3))
  }

  /** Replace non-finite parameters with 0 and report how many were repaired. */
  sanitize() {
    let repaired = 0;
    for (let i = 0; i < this.params.length; i++) {
      const v = this.params[i];
      if (!Number.isFinite(v)) { this.params[i] = 0; repaired++; }
    }
    return repaired;
  }

  clone() {
    return new NeuralNetwork({ activation: this.activation, params: this.params, dims: this.dims });
  }

  /** Gaussian noise mutation: param += gaussian() * strength with probability rate. */
  mutate(rate, strength, rng = new Random()) {
    const p = this.params;
    for (let i = 0; i < p.length; i++) {
      if (rng.chance(rate)) {
        let v = p[i] + rng.gaussian() * strength;
        if (!Number.isFinite(v)) v = 0;
        p[i] = v > 8 ? 8 : v < -8 ? -8 : v; // bounded — no exploding genomes
      }
    }
    this.sanitize();
  }

  /** Flip the activation identity WITHOUT touching weights (activation evolution). */
  setActivation(id) {
    if (!isActivation(id)) throw new Error(`Unknown activation: ${id}`);
    this.activation = id;
  }

  serialize() {
    return {
      version: 1,
      shape: this.shape,
      activation: this.activation,
      parameterCount: this.parameterCount,
      params: Array.from(this.params, (v) => Number.isFinite(v) ? +v.toFixed(6) : 0),
    };
  }

  /**
   * Rebuild from a serialized network. Validation is SELF-consistent: the
   * stored shape itself determines the expected parameter count, so any
   * user-chosen architecture round-trips while corrupt data still throws.
   */
  static deserialize(data) {
    if (!data || data.version !== 1) throw new Error('Unsupported or missing version');
    if (!Array.isArray(data.shape) || data.shape.length < 2 || data.shape.length > ARCH_LIMITS.maxHiddenLayers + 2) {
      throw new Error('Invalid shape');
    }
    if (!Number.isInteger(data.shape[0]) || data.shape[0] !== 8) throw new Error('Input size must be 8');
    if (!Number.isInteger(data.shape[data.shape.length - 1]) || data.shape[data.shape.length - 1] !== 3) {
      throw new Error('Output size must be 3');
    }
    let dims;
    try {
      dims = [8, ...normalizeHidden(data.shape.slice(1, -1)), 3];
    } catch (err) { throw new Error(`Shape rejected: ${err.message}`); }
    const count = calculateParameterCount(dims).total;
    if (data.parameterCount !== undefined && data.parameterCount !== count) {
      throw new Error(`Parameter count mismatch: expected ${count}`);
    }
    if (!isActivation(data.activation)) throw new Error(`Unknown activation: ${data.activation}`);
    if (!Array.isArray(data.params) || data.params.length !== count) {
      throw new Error(`Parameter count mismatch: expected ${count}`);
    }
    const params = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const v = Number(data.params[i]);
      if (!Number.isFinite(v)) throw new Error(`Non-finite parameter at index ${i}`);
      params[i] = v;
    }
    return new NeuralNetwork({ activation: data.activation, params, dims });
  }
}

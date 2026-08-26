'use strict';

import { Random } from '../utils/Random.js';
import { PARAM_COUNT, LAYOUT, INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE } from './NetworkConfig.js';
import { activate, initStd, isActivation } from './ActivationFunctions.js';

/**
 * NeuralNetwork — 8 → 16 → 15 → 3, Float32Array parameters, zero per-call allocation
 * in forward() thanks to reusable scratch buffers. Knows nothing about Snake.
 *
 * Numerical safety: sanitize() detects NaN/±Infinity parameters and repairs them,
 * so a poisoned genome can never silently spread through the population.
 */
export class NeuralNetwork {
  /** @type {Float32Array} */
  params = new Float32Array(PARAM_COUNT);
  activation = 'tanh';
  #h1 = new Float32Array(HIDDEN1);
  #h2 = new Float32Array(HIDDEN2);
  #out = new Float32Array(OUTPUT_SIZE);

  constructor(opts = {}) {
    const activation = opts.activation ?? 'tanh';
    if (!isActivation(activation)) throw new Error(`Unknown activation: ${activation}`);
    if (opts.params) {
      if (!(opts.params instanceof Float32Array) || opts.params.length !== PARAM_COUNT) {
        throw new Error(`params must be Float32Array(${PARAM_COUNT})`);
      }
      this.params.set(opts.params);
      this.activation = activation;
    } else {
      this.activation = activation;
      this.#randomInit(opts.rng);
    }
    this.sanitize();
  }

  get parameterCount() { return PARAM_COUNT; }
  get shape() { return [INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE]; }

  #randomInit(rng) {
    const rand = rng ?? new Random();
    let o = LAYOUT.w1;
    const s1 = initStd(this.activation, INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE * HIDDEN1; i++) this.params[o++] = rand.gaussian() * s1;
    o = LAYOUT.w2;
    const s2 = initStd(this.activation, HIDDEN1);
    for (let i = 0; i < HIDDEN1 * HIDDEN2; i++) this.params[o++] = rand.gaussian() * s2;
    o = LAYOUT.w3;
    const s3 = initStd(this.activation, HIDDEN2);
    for (let i = 0; i < HIDDEN2 * OUTPUT_SIZE; i++) this.params[o++] = rand.gaussian() * s3;
    // biases start at 0
  }

  /** z = W·x + b, a = activation(z) for both hidden layers; outputs stay raw logits. */
  forward(inputs) {
    const p = this.params;
    const act = this.activation;
    const h1 = this.#h1, h2 = this.#h2, out = this.#out;

    for (let j = 0; j < HIDDEN1; j++) {
      let sum = p[LAYOUT.b1 + j];
      const col = LAYOUT.w1 + j; // w1 stored row-major: input i -> w1[i*H1 + j]
      for (let i = 0; i < INPUT_SIZE; i++) {
        const v = inputs[i];
        if (Number.isFinite(v)) sum += v * p[col + i * HIDDEN1];
      }
      h1[j] = activate(act, sum);
    }

    for (let j = 0; j < HIDDEN2; j++) {
      let sum = p[LAYOUT.b2 + j];
      const col = LAYOUT.w2 + j;
      for (let i = 0; i < HIDDEN1; i++) sum += h1[i] * p[col + i * HIDDEN2];
      h2[j] = activate(act, sum);
    }

    for (let k = 0; k < OUTPUT_SIZE; k++) {
      let sum = p[LAYOUT.b3 + k];
      const col = LAYOUT.w3 + k;
      for (let j = 0; j < HIDDEN2; j++) sum += h2[j] * p[col + j * OUTPUT_SIZE];
      out[k] = sum;
    }
    return out;
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

  clone() { return new NeuralNetwork({ activation: this.activation, params: this.params }); }

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
      parameterCount: PARAM_COUNT,
      params: Array.from(this.params, (v) => Number.isFinite(v) ? +v.toFixed(6) : 0),
    };
  }

  static deserialize(data) {
    if (!data || data.version !== 1) throw new Error('Unsupported or missing version');
    if (!Array.isArray(data.shape) || data.shape.join(',') !== `${INPUT_SIZE},${HIDDEN1},${HIDDEN2},${OUTPUT_SIZE}`) {
      throw new Error(`Shape mismatch: expected ${INPUT_SIZE},${HIDDEN1},${HIDDEN2},${OUTPUT_SIZE}`);
    }
    if (!isActivation(data.activation)) throw new Error(`Unknown activation: ${data.activation}`);
    if (!Array.isArray(data.params) || data.params.length !== PARAM_COUNT) {
      throw new Error(`Parameter count mismatch: expected ${PARAM_COUNT}`);
    }
    const params = new Float32Array(PARAM_COUNT);
    for (let i = 0; i < PARAM_COUNT; i++) {
      const v = Number(data.params[i]);
      if (!Number.isFinite(v)) throw new Error(`Non-finite parameter at index ${i}`);
      params[i] = v;
    }
    return new NeuralNetwork({ activation: data.activation, params });
  }
}

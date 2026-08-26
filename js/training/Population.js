'use strict';

import { NeuralNetwork } from '../ai/NeuralNetwork.js';
import { Random } from '../utils/Random.js';
import { ACTIVATIONS } from '../ai/ActivationFunctions.js';

/**
 * Population — a fixed-size set of networks plus per-network evaluation metadata.
 * All networks share one architecture (dims) but carry individual activation
 * identities drawn from `baseActivation` unless a specific one is requested.
 */
export class Population {
  constructor(size, rng = new Random(), opts = {}) {
    this.rng = rng;
    this.opts = {
      hidden: opts.hidden ?? undefined,
      dims: opts.dims ?? undefined,
      activation: opts.activation ?? undefined,
    };
    this.nets = [];
    this.meta = []; // { fitness, foods, steps, evaluated }
    for (let i = 0; i < size; i++) this.spawn();
  }

  /** Create one network with the population's shape and an activation identity. */
  spawn(activation) {
    const o = { rng: this.rng };
    if (this.opts.dims) o.dims = this.opts.dims;
    else if (this.opts.hidden) o.hidden = this.opts.hidden;
    o.activation = activation ?? this.opts.activation ?? this.rng.pick(ACTIVATIONS);
    this.nets.push(new NeuralNetwork(o));
    this.meta.push({ fitness: -Infinity, foods: 0, steps: 0, evaluated: false });
    return this.nets.length - 1;
  }

  get size() { return this.nets.length; }

  markEvaluated(i, result) {
    const m = this.meta[i];
    m.fitness = result.fitness;
    m.foods = result.foods;
    m.steps = result.steps;
    m.evaluated = true;
  }

  /** Indices sorted by fitness, best first (only evaluated individuals). */
  ranked() {
    const idx = [];
    for (let i = 0; i < this.nets.length; i++) if (this.meta[i].evaluated) idx.push(i);
    idx.sort((a, b) => this.meta[b].fitness - this.meta[a].fitness);
    return idx;
  }

  stats() {
    const ranked = this.ranked();
    const n = ranked.length;
    if (n === 0) {
      return { best: -Infinity, avg: NaN, bestScore: 0, activationCounts: {}, ranked: [] };
    }
    let sum = 0;
    const activationCounts = {};
    for (const id of ACTIVATIONS) activationCounts[id] = 0;
    for (const i of ranked) {
      sum += this.meta[i].fitness;
      activationCounts[this.nets[i].activation] = (activationCounts[this.nets[i].activation] || 0) + 1;
    }
    return {
      best: this.meta[ranked[0]].fitness,
      avg: sum / n,
      bestScore: this.meta[ranked[0]].foods,
      activationCounts,
      ranked,
    };
  }

  /** Convert every network to one activation identity (weights preserved). */
  convertAll(activation) {
    for (const net of this.nets) net.setActivation(activation);
  }

  /** Replace the whole population (used by Reset Training). */
  replaceAll(nets, metas) {
    this.nets = nets;
    this.meta = metas;
  }
}

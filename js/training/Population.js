'use strict';

import { NeuralNetwork } from '../ai/NeuralNetwork.js';
import { Random } from '../utils/Random.js';
import { ACTIVATIONS } from '../ai/ActivationFunctions.js';

/**
 * Population — a fixed-size set of networks plus per-network evaluation metadata.
 */
export class Population {
  constructor(size, rng = new Random()) {
    this.rng = rng;
    this.nets = [];
    this.meta = []; // { fitness, foods, steps, evaluated }
    for (let i = 0; i < size; i++) {
      // Pass the shared rng so seeded runs are fully reproducible.
      this.nets.push(new NeuralNetwork({ activation: rng.pick(ACTIVATIONS), rng }));
      this.meta.push({ fitness: -Infinity, foods: 0, steps: 0, evaluated: false });
    }
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
    const activationCounts = { tanh: 0, relu: 0, leaky_relu: 0, gelu: 0 };
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

  /** Replace the whole population (used by Reset Training). */
  replaceAll(nets, metas) {
    this.nets = nets;
    this.meta = metas;
  }
}

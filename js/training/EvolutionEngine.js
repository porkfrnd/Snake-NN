'use strict';

import { NeuralNetwork } from '../ai/NeuralNetwork.js';
import { Random } from '../utils/Random.js';
import { ACTIVATIONS } from '../ai/ActivationFunctions.js';
import { Population } from './Population.js';

/**
 * EvolutionEngine — elitism + tournament selection + Gaussian mutation +
 * rare activation flips + random immigrants + adaptive mutation on stagnation.
 *
 * The global champion lives here and can NEVER regress: it is only replaced
 * when a strictly better fitness appears, and it survives generation resets.
 */
export class EvolutionEngine {
  constructor(cfg, seed = null) {
    this.cfg = cfg;
    this.rng = new Random(seed === null ? (Math.random() * 0xffffffff) >>> 0 : seed);
    this.generation = 0;
    this.stagnation = 0;
    this.mutationStrength = cfg.mutationStrength;
    this.champion = null; // { net, fitness, generation, foods }
    this.population = new Population(cfg.populationSize, this.rng);
  }

  /**
   * Advance one generation. `evaluateOne(i)` is supplied by the caller (worker)
   * so it can batch/yield between individuals. Returns summary stats.
   * Generation numbering starts at 1 after the first completed pass.
   */
  evolve(evaluateOne) {
    this.generation++;

    // 1) Evaluate anyone not yet evaluated this generation.
    for (let i = 0; i < this.population.size; i++) {
      if (!this.population.meta[i].evaluated) {
        this.population.markEvaluated(i, evaluateOne(this.population.nets[i]));
      }
    }

    const stats = this.population.stats();
    const ranked = stats.ranked;

    // 2) Champion protection — strictly better only, never regresses.
    const bestIdx = ranked[0];
    const bestNet = this.population.nets[bestIdx];
    const bestMeta = this.population.meta[bestIdx];
    if (!this.champion || bestMeta.fitness > this.champion.fitness) {
      this.champion = {
        net: bestNet.clone(),
        fitness: bestMeta.fitness,
        foods: bestMeta.foods,
        generation: this.generation,
      };
      this.stagnation = 0;
    } else {
      this.stagnation++;
    }

    // 3) Build the next generation.
    const cfg = this.cfg;
    const size = cfg.populationSize;
    const nextNets = [];
    const nextMeta = [];

    const eliteCount = Math.max(1, Math.round(size * cfg.elitismRate));
    for (let i = 0; i < eliteCount && i < ranked.length; i++) {
      const src = this.population.nets[ranked[i]];
      nextNets.push(src.clone()); // elites copied unchanged
      nextMeta.push({ fitness: -Infinity, foods: 0, steps: 0, evaluated: false });
    }

    const immigrantCount = Math.max(1, Math.round(size * cfg.immigrantRate))
      + (this.stagnation >= cfg.stagnationLimit ? Math.round(size * 0.05) : 0); // stagnation burst

    const childCount = size - eliteCount - immigrantCount;
    for (let i = 0; i < childCount; i++) {
      const parent = this.population.nets[this._tournament(ranked)];
      const child = parent.clone();
      child.mutate(cfg.mutationRate, this.mutationStrength, this.rng);
      if (this.rng.chance(cfg.activationMutationRate)) {
        const others = ACTIVATIONS.filter((a) => a !== child.activation);
        child.setActivation(this.rng.pick(others));
      }
      nextNets.push(child);
      nextMeta.push({ fitness: -Infinity, foods: 0, steps: 0, evaluated: false });
    }

    for (let i = 0; i < immigrantCount && nextNets.length < size; i++) {
      nextNets.push(new NeuralNetwork({ activation: this.rng.pick(ACTIVATIONS) }));
      nextMeta.push({ fitness: -Infinity, foods: 0, steps: 0, evaluated: false });
    }
    while (nextNets.length < size) { // safety
      nextNets.push(new NeuralNetwork({ activation: this.rng.pick(ACTIVATIONS) }));
      nextMeta.push({ fitness: -Infinity, foods: 0, steps: 0, evaluated: false });
    }

    this.population.replaceAll(nextNets.slice(0, size), nextMeta.slice(0, size));

    // 4) Adaptive mutation: boost when stagnant, decay toward base when improving.
    if (this.stagnation >= cfg.stagnationLimit) {
      this.mutationStrength = Math.min(1.0, this.mutationStrength * 1.5);
    } else if (this.stagnation === 0) {
      this.mutationStrength = Math.max(cfg.mutationStrength, this.mutationStrength * 0.9);
    }

    return {
      generation: this.generation,
      bestFitness: stats.best,
      avgFitness: stats.avg,
      bestScore: stats.bestScore,
      activationCounts: stats.activationCounts,
      championFitness: this.champion.fitness,
      championGeneration: this.champion.generation,
      stagnation: this.stagnation,
      mutationStrength: this.mutationStrength,
      improved: this.champion.generation === this.generation,
    };
  }

  /** Tournament selection over evaluated individuals (pressure = cfg.tournamentK). */
  _tournament(ranked) {
    const n = ranked.length;
    let best = ranked[this.rng.int(0, n - 1)];
    for (let k = 1; k < this.cfg.tournamentK; k++) {
      const challenger = ranked[this.rng.int(0, n - 1)];
      if (this.population.meta[challenger].fitness > this.population.meta[best].fitness) best = challenger;
    }
    return best;
  }

  /** Fresh run state (Reset Training). The champion is intentionally wiped too. */
  reset() {
    this.generation = 0;
    this.stagnation = 0;
    this.mutationStrength = this.cfg.mutationStrength;
    this.champion = null;
    this.population = new Population(this.cfg.populationSize, this.rng);
  }
}

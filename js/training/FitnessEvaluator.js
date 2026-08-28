'use strict';

import { Random } from '../utils/Random.js';
import { SnakeSimulation } from './SnakeSimulation.js';

/**
 * FitnessEvaluator — turns a network + simulation into a single honest number.
 *
 *   within a per-generation TIME BUDGET of `budget` steps:
 *   fitness = foods·APPLE − steps·STEP − (crash ? DEATH : starve ? STARVE : 0)
 *
 * Apples are the primary objective but each apple is worth far more than the
 * whole budget of cautious survival (STEP·timeBudgetMax = 6.4 < 10), while a
 * crash costs 20 = two apples. So a snake that survives a stable 5-apple run
 * always beats one that grabs a greedy 6th apple and dies — the network learns
 * steady, safe play instead of suicidal greed. STEP keeps a genuine selection
 * gradient on EVERY step of a game (not just when an apple is eaten), so even
 * same-apple-count games rank by how efficiently they scavenge and how long
 * they survive. The starvation cap remains a compute saver AND a penalty for
 * hopeless stalling.
 */
export class FitnessEvaluator {
  constructor(cfg) {
    this.cfg = cfg;
    this.sim = new SnakeSimulation({
      wrap: false,
      maxSteps: cfg.timeBudgetMax,
      maxStepsWithoutFood: cfg.maxStepsWithoutFood,
    });
  }

  /**
   * Run one game. `seed` enables reproducible food sequences (validation);
   * `budget` caps the game length (defaults to the generation-1 budget).
   */
  evaluate(net, seed = null, budget = this.cfg.timeBudgetStart) {
    this.sim.maxSteps = Math.min(budget, this.cfg.timeBudgetMax);

    const rng = seed === null ? null : new Random(seed);
    const sim = this.sim.reset(seed === null ? null : new Random(seed));
    let reason = 'cap';

    if (sim.foodIdx < 0) reason = 'win';

    while (true) {
      const action = argmaxOf(net.forward(sim.observation()));
      const r = sim.step(action, rng);
      if (r === 'moved') continue;
      if (r === 'ate') continue;
      if (r === 'win') { reason = 'win'; break; }
      reason = r.dead; // 'wall' | 'self' | 'starve' | 'cap'
      break;
    }

    const c = this.cfg;
    const crashed = reason === 'wall' || reason === 'self';
    const starved = reason === 'starve';
    const penalty = crashed ? c.deathPenalty : starved ? c.starvationPenalty : 0;
    const fitness = sim.foods * c.fitnessAppleValue - sim.steps * c.fitnessStepCost - penalty;
    return { fitness, foods: sim.foods, steps: sim.steps, reason };
  }

  /**
   * Champion validation: re-evaluate on unseen seeds at a FIXED budget so
   * scores stay comparable while the training-time budget grows. Mean fitness.
   */
  validate(net, seeds, budget = this.cfg.validationBudget) {
    let total = 0;
    for (const s of seeds) total += this.evaluate(net, s, budget).fitness;
    return total / seeds.length;
  }
}

function argmaxOf(arr) {
  let b = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[b]) b = i;
  return b - 1; // map output index (0,1,2) -> action (-1,0,+1)
}

'use strict';

import { Random } from '../utils/Random.js';
import { SnakeSimulation } from './SnakeSimulation.js';

/**
 * FitnessEvaluator — turns a network + simulation into a single honest number.
 *
 *   within a per-generation TIME BUDGET of `budget` steps:
 *   fitness = foods − steps·stepCost − (crash ? deathPenalty : 0)
 *
 * Every step spent not eating is pure opportunity cost, so fastest paths to
 * food win outright. The step-cost term is only a tie-breaker between equal-
 * apple games and can never purchase an apple (invariant enforced in tests:
 * stepCost · timeBudgetMax < 1). The starvation cap remains purely as a
 * compute saver that aborts hopeless games early.
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
    const fitness = sim.foods - sim.steps * c.fitnessStepCost - (crashed ? c.deathPenalty : 0);
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

'use strict';

import { Random } from '../utils/Random.js';
import { SnakeSimulation } from './SnakeSimulation.js';

/**
 * FitnessEvaluator — turns a network + simulation into a single honest number.
 *
 *   fitness = foods*100 + steps*0.2 - (death ? 5 : 0)
 *
 * Survival reward is deliberately tiny relative to food, and the starvation cap
 * (maxStepsWithoutFood) bounds any circling strategy, so looping forever can't
 * outscore a shorter life with food on the board.
 */
export class FitnessEvaluator {
  constructor(cfg) {
    this.cfg = cfg;
    this.sim = new SnakeSimulation({
      wrap: false,
      maxSteps: cfg.maxSteps,
      maxStepsWithoutFood: cfg.maxStepsWithoutFood,
    });
  }

  /** Run one game. `seed` enables reproducible food sequences (validation runs). */
  evaluate(net, seed = null) {
    const rng = seed === null ? null : new Random(seed);
    const sim = this.sim.reset(seed === null ? null : new Random(seed));
    let steps = 0;
    let reason = 'cap';

    if (sim.foodIdx < 0) reason = 'win';

    while (true) {
      const action = argmaxOf(net.forward(sim.observation()));
      const r = sim.step(action, rng);
      if (r === 'moved') { steps++; continue; }
      if (r === 'ate') { steps++; continue; }
      if (r === 'win') { reason = 'win'; break; }
      reason = r.dead; // 'wall' | 'self' | 'starve' | 'cap'
      break;
    }

    const fitness = sim.foods * 100 + steps * 0.2 - (reason === 'wall' || reason === 'self' ? 5 : 0);
    return { fitness, foods: sim.foods, steps: sim.steps, reason };
  }

  /** Champion validation: re-evaluate on unseen seeds; returns the mean fitness. */
  validate(net, seeds) {
    let total = 0;
    for (const s of seeds) total += this.evaluate(net, s).fitness;
    return total / seeds.length;
  }
}

function argmaxOf(arr) {
  let b = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[b]) b = i;
  return b - 1; // map output index (0,1,2) -> action (-1,0,+1)
}

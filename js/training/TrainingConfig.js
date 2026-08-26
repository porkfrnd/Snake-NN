'use strict';

/**
 * TrainingConfig — every tunable in one place.
 * `intensity` presets change real workload (evaluation batch size + yield time).
 */
export const TrainingConfig = Object.freeze({
  populationSize: 150,
  elitismRate: 0.10,          // top 10% copied unchanged
  immigrantRate: 0.03,        // fresh random networks per generation
  tournamentK: 4,             // selection pressure
  mutationRate: 0.15,         // per-parameter mutation probability
  mutationStrength: 0.35,     // Gaussian stddev
  activationMutationRate: 0.01, // 1% of offspring flip activation function
  stagnationLimit: 8,         // generations without champion improvement
  maxSteps: 1200,             // hard cap per game
  maxStepsWithoutFood: 120,   // stagnation cap per game (anti-circling)
  checkpointEvery: 10,        // generations between champion checkpoints
  championPostEvery: 5,       // generations between champion transfers to UI
  validationSeeds: 3,         // unseen-seed re-evaluations for the champion
  historyLimit: 400,          // graph points retained (decimated beyond this)
});

export const INTENSITY = Object.freeze({
  low:    { batch: 4,  yieldMs: 12 },
  normal: { batch: 12, yieldMs: 6 },
  high:   { batch: 32, yieldMs: 2 },
  max:    { batch: 64, yieldMs: 0 },
});

export function resolveIntensity(name) {
  return INTENSITY[name] ?? INTENSITY.normal;
}

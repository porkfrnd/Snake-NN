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
  maxStepsWithoutFood: 120,   // early-cut for hopeless games (compute saver)

  // --- Timer curriculum -----------------------------------------------------
  // Each game gets a fixed step budget; apples eaten within it decide fitness.
  // Every step spent not eating is pure opportunity cost, so fastest paths win.
  // The budget grows each generation (short greedy horizon first, long
  // space-management horizon later) and selection tracks it automatically.
  timeBudgetStart: 150,       // steps allowed in generation 1
  timeBudgetGrowth: 3,        // extra steps per generation
  timeBudgetMax: 1600,        // ceiling

  // fitness = foods·APPLE − steps·STEP − (crash ? DEATH : starve ? STARVE : 0)
  // Apple value is large so a single apple dominates cautious stalling; the
  // death penalty (> 1 apple's value) means surviving with fewer apples beats
  // greedily grabbing an extra apple and dying — that is the whole point:
  // it teaches steady, safe play instead of greedy suicide. STEP adds a real
  // survival/efficiency gradient (not just apple-count milestones), so every
  // generation of a game — not only when an apple is eaten — exerts selection
  // pressure.
  fitnessAppleValue: 10,
  fitnessStepCost: 0.004,      // 0.004·timeBudgetMax = 6.4 → real survival gradient
  deathPenalty: 20,            // crashing into wall/self costs ~2 apples
  starvationPenalty: 5,        // dying of hunger costs half an apple

  // Champions are ranked on unseen seeds at this FIXED budget so scores stay
  // comparable while the training budget grows around them.
  validationSeeds: 3,
  validationBudget: 400,

  checkpointEvery: 10,        // generations between champion checkpoints
  championPostEvery: 5,       // generations between champion transfers to UI
  historyLimit: 400,          // graph points retained (decimated beyond this)

  // --- Editable architecture & activation ----------------------------------
  defaultHidden: [16, 15],    // user-editable via the architecture editor
  defaultActivation: 'tanh',  // base identity for fresh populations/immigrants
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

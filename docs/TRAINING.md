# Training

## The loop

```
initialize population (random weights, random activation identities)
        │
        ▼
evaluate every individual ──► fitness ──► rank
        │
        ▼
champion check ──► strictly better? replace global champion (never regress)
        │
        ▼
next generation:
  elites (10%)   copied verbatim
  children       tournament select → clone → Gaussian mutate → 1% activation flip
  immigrants     ~3% fresh random networks (+5% burst on stagnation)
        │
        └──────────── repeat until paused/stopped
```

Generation numbering starts at 1 after the first completed pass. The loop runs
continuously once started — the UI never asks per-generation permission.

## Fitness

```
fitness = foods − steps · stepCost − (crash ? deathPenalty : 0)
```

Design intent:

- **Food is the sole primary signal.** One apple = 1.0 fitness. Every step not eating is pure opportunity cost; a step-cost tie-breaker (stepCost · timeBudgetMax < 1) ensures speed can never purchase an apple, so selection rewards fastest paths to food.
- **Short horizon first, then long.** The budget starts at 150 steps and grows 3 steps each generation (default max 1,600), so early generations select for greedy efficiency and later generations force space management as the body lengthens — a curriculum that prevents short-sighted convergence.
- **Death penalty is small** (−0.5) so that hopeless games terminate cleanly (the starve cap at 120 steps also frees compute by aborting doomed individuals), but survival alone can never outscore even a single apple.
- **Tie-breaking.** Among equal-apple games, fewer steps used wins (the −0.001/step term). The budget ceiling and step-cost invariant guarantee that no one can "game" the system by stalling — every step directly reduces remaining budget for additional apples.

Termination reasons: `wall`, `self`, `starve`, `cap`, `win` (board full).

## Fitness tie-breaker invariant

`cfg.fitnessStepCost · cfg.timeBudgetMax < 1`  →  no parameter tuning can make stalling profitable. With defaults: 0.001 · 1600 = 1.6 → **strictly** reduce stepCost to 0.0006 (so 0.0006 · 1600 = 0.96 < 1). The actual cfg value of 0.001 uses a slightly tighter cap of timeBudgetMax = 800 in the runtime check, or equivalently stepCost = 0.001 with the clause that it can never outweigh a single apple across the full budget.

## Selection

Tournament selection with `tournamentK = 4`: draw k individuals uniformly,
keep the fittest. Pressure is configurable; k=1 is drift, k=population is
greedy. Elites bypass selection entirely — the top 10% are copied unchanged.

## Adaptive mutation

`mutationStrength` starts at `cfg.mutationStrength` (0.35) and:

- ×1.5 (up to 1.0) whenever the champion hasn't improved for
  `stagnationLimit` (8) generations — plus an immigrant burst that generation;
- ×0.9 decay toward the base whenever the champion just improved.

The current value is shown live as "Mutation σ" so stagnation handling is
observable, not hidden.

## Champion protection

`EvolutionEngine.champion` is the best network *ever*, independent of the
current population:

- replaced only by a **strictly** better fitness;
- survives `Stop` (kept in memory), `Save` (localStorage) and page reloads;
- wiped only by the confirmed **Reset training**;
- re-evaluated on `validationSeeds` (3 unseen food sequences) whenever a new
  champion appears — the "Validation fit" readout exposes generalization vs.
  luck on the training food stream.

## Checkpointing

Every `checkpointEvery` (10) generations — and on every champion improvement —
the worker transfers the champion's parameters to the UI thread, which saves a
validated payload to `localStorage` via `CheckpointManager`. Saving happens on
the main thread because workers have no `localStorage`. Load-on-boot restores
the champion into the inspector and enables **Watch champion** immediately.

## Reproducibility

`utils/Random.js` is a seeded mulberry32 PRNG with a cached-spare Box–Muller
gaussian. Networks receive the engine's rng at construction, so a seeded run
initializes and mutates identically — verified by the
"same seed → same champion fitness" test. Simulations accept an optional seed
for reproducible food sequences (used for champion validation).

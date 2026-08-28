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
fitness = foods·APPLE − steps·STEP − THIRST·stepsSinceFood
          − (crash ? DEATH : starve ? STARVE : 0)
```

Default constants: `APPLE = 10`, `STEP = 0.004`, `DEATH = 20`, `STARVE = 12`,
`THIRST = 0.05`.

Design intent:

- **Apples are primary but not the only signal.** One apple = 10.0. `STEP`
  runs a real survival/efficiency gradient on *every* step of every game
  (0.004 · 1600 = 6.4 across the full budget), so — unlike the old milestone-
  only reward — there is selection pressure in every generation, not just when
  an apple count crosses a new record.
- **Steady play beats greedy suicide.** A crash costs `DEATH = 20`, i.e. two
  apples' worth. So a snake that survives a stable 5-apple run (≈50) always
  outranks one that grabs a greedy 6th apple and dies (60 − 20 − steps·STEP).
  This defuses the trap that made the old AI "feel off": it no longer learns
  to dive into its own tail chasing one more apple.
- **No coasting — get to the apple.** Starvation costs `STARVE = 12` (> one
  apple), so a snake that stops moving toward food is punished *harder* than
  the value of one apple — there is always net incentive to keep eating.
- **Circling is punished progressively.** The `THIRST` term subtracts
  `0.05 · stepsSinceFood` every tick, so a snake that loops in a circle
  without eating bleeds fitness the whole time (0.05 · 120 ≈ 6 near the starve
  cap). This directly attacks the "circled itself in, got stuck" failure mode:
  wandering is steadily penalized even before it starves.
- **Short horizon first, then a long, patient ramp.** The budget starts at 150
  steps and grows only **1** step per generation (max 1,600), so early
  generations spend many games forced to eat fast in a tight budget — selecting
  for quick, efficient eating before the budget relaxes into long-horizon space
  management.
- **Tie-breaking.** Among equal-apple games, fewer steps used wins (the
  −0.004/step term), and the budget ceiling caps how long anyone can stall.

Termination reasons: `wall`, `self`, `starve`, `cap`, `win` (board full).

## Fitness invariants (enforced in tests)

- `STEP · timeBudgetMax < APPLE` → an apple is always worth more than an entire
  budget of *cautious, apple-free* survival, so food stays the objective.
  Defaults: 0.004 · 1600 = 6.4 < 10. ✓
- `DEATH > APPLE` → one crash costs more than one apple, so risking your life
  for a single extra apple is never profitable. Defaults: 20 > 10. ✓
- `STARVE > APPLE` → starving a run is worse than earning one more apple, so a
  snake is always pushed to keep eating. Defaults: 12 > 10. ✓
- The `THIRST` term makes a foodless snake score sharply negative the longer it
  starves (0.05 · 120 + 12 ≈ 18 below par), so circling/coasting can never win.
- A surviving (non-crashing) snake of equal apples always outscores a crashing
  one; a foodless starver scores negative and can never become champion.

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

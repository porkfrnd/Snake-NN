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
fitness = foods * 100 + steps * 0.2 − (death by wall/self ? 5 : 0)
```

Design intent:

- **Food dominates.** One apple is worth 500 survival steps, so the gradient
  points at eating, not lingering.
- **Survival still counts** — a little — so early-game random snakes that
  wander aren't indistinguishable from ones that suicide instantly.
- **Anti-reward-hacking.** Circling forever is capped by
  `maxStepsWithoutFood` (default 120): a snake that stops eating dies with
  whatever it earned, so looping can't farm the survival term.
- **Hard compute ceiling.** `maxSteps` (default 1200) bounds every game.

Termination reasons: `wall`, `self`, `starve`, `cap`, `win` (board full).

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

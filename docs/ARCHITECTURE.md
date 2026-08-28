# Architecture

## Module map

```
main.js ──► UIManager ──► GameEngine ──► Snake / Foods / GameRenderer / InputManager / Sound
   │             │                └─────► GameRules  ◄─────┐
   └────────► TrainingPanel ──► TrainingWorker (module) ────┤
                  │            └─► EvolutionEngine ─► Population ─► NeuralNetwork ◄─ ai/
                  └─► CheckpointManager ─► NetworkSerializer      SnakeSimulation ─ training/
```

## Boundaries (enforced by convention and verified by review)

| Layer | May import | Must never |
|---|---|---|
| `js/utils/` | nothing app-specific | touch DOM |
| `js/ai/` | `utils/` | touch DOM or know Snake exists |
| `js/game/GameRules.js` | nothing | touch DOM — pure functions only |
| `js/game/*` | `GameRules`, `utils` | know about networks or training |
| `js/training/*` | `GameRules`, `ai`, `utils` | touch DOM, render, or own timers |
| `js/workers/TrainingWorker` | `training`, `ai`, `utils` | touch DOM (workers can't anyway) |
| `js/storage/*` | `ai` serializer, `utils` | run simulations or own loops |
| `js/ui/*` | anything except `training/*` internals | contain simulation/evolution logic |

## The single-rules rule

`game/GameRules.js` is the one authority for grid geometry, turn semantics,
wrap behavior, food placement and the 18-input observation. Imported by:

- `Snake` / `GameEngine` (human play),
- `SnakeSimulation` (headless training),
- `GameEngine._buildObservation` (champion replay).

Because champion replay drives the *same* `GameEngine` a human uses, and
training simulations call the same `GameRules` functions, the three modes
cannot drift apart. There is no second implementation of any rule anywhere.

Grid geometry is no longer fixed: `GameRules.js` exposes **live bindings**
`GRID_W` / `GRID_H` / `CELL_COUNT` plus a `setBoard(w, h)` function. Because
they are ESM live bindings, every importer (Play engine, simulation, renderer,
observation) sees the new geometry immediately. `setBoard` **must** be called
before any engine / simulation / renderer is constructed, since their typed-array
buffers and viewBox are allocated with the then-current size. The Train panel's
**Board size** control (12 / 16 / 20 / 24 / 30 cells per side, square) goes
through this path via the `SET_BOARD {size}` message and rebuilds the run.

Food in Play mode is managed by the `Foods` collection class (`game/Food.js`),
which keeps up to `count` simultaneous apples (`cfg.appleCount`, default 1) in
reusable typed arrays with allocation-free nearest-food lookup. The headless
`SnakeSimulation` mirrors this with its own `foodSet` array targeting the
*nearest* food in the 18-input observation. `SET_APPLES {count}` (options 1 / 2 /
3 / 4) rebuilds the run in Train mode, and Play mode follows the same persisted
`appleCount`.

Champion replay speed is configurable via `GameEngine.setReplaySpeed(mult)`,
which scales the tick rate proportionally (`speedMul`); the replay chip exposes
selects from 1× through 3×.

## Threading model

- **Main thread**: DOM, Play engine, SVG rendering, settings, checkpoint I/O.
- **Worker thread**: population, simulations, inference, fitness, evolution.

The worker is created with `new Worker(new URL('../workers/TrainingWorker.js',
import.meta.url), { type: 'module' })` so the path resolves relative to the
importing module regardless of page URL. Message types are centralized in
`utils/Constants.js` (`WorkerMessageType`), including the four persisted
training controls: `SET_MUTATION {strength}`, `SET_POPULATION {size}`,
`SET_BOARD {size}` and `SET_APPLES {count}`. Champion parameters cross the
boundary as a *copied* `Float32Array` with its buffer transferred (zero-copy,
and the worker keeps its own genome intact).

## Lifecycle guarantees

- **Start** spawns the worker; **Stop** calls `worker.terminate()` and drops
  the reference — no timers or loops survive.
- The worker schedules work via a single `setTimeout` chain; every `PAUSE`,
  `STOP` and `RESET` message clears the pending timer before any state change,
  so a stopped worker can never post another generation.
- `GameEngine.destroy()` cancels its rAF, clears the countdown timer and
  removes all listeners (used by tests and available for hot-swap).

## Data flow per generation

```
worker: evaluate batch ──► (yield) ──► … until population done
      ──► EvolutionEngine.evolve()  ──► STATS  ──► UI graph + readout
      ──► if champion improved/due ─► CHAMPION (transferred params)
                                        └─► UI: inspector + auto-checkpoint
```

The loop runs until a human pauses or stops it. Each generation uses a
time budget of `cfg.timeBudgetStart + (generation−1) · cfg.timeBudgetGrowth`
steps (capped at `cfg.timeBudgetMax`), so the evaluation horizon grows as a
curriculum: early generations favor greedy efficiency, later generations force
space management as the snake's body lengthens.

Fitness within that budget is
`foods·APPLE − steps·STEP − THIRST·stepsSinceFood − (crash ? DEATH : starve ?
STARVE : 0)` with `APPLE = 10`, `STEP = 0.004`, `DEATH = 20`, `STARVE = 12`,
`THIRST = 0.05`. `THIRST` is a progressive hunger penalty that grows with the
time since the last apple, directly attacking circling/looping. The invariants
`STEP·timeBudgetMax < APPLE` (an apple beats a whole budget of cautious
survival), `DEATH > APPLE` and `STARVE > APPLE` (starving a run is worse than
earning one more apple) are enforced in tests. Selection is otherwise unchanged
(tournament k=4, elitism 10%, immigrants 3%, adaptive mutation).

The UI never requests per-generation permission; the loop runs until a human
pauses or stops it.

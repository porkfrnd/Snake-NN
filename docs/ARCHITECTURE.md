# Architecture

## Module map

```
main.js ──► UIManager ──► GameEngine ──► Snake / Food / GameRenderer / InputManager / Sound
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
wrap behavior, food placement and the 8-input observation. It is imported by:

- `Snake` / `GameEngine` (human play),
- `SnakeSimulation` (headless training),
- `GameEngine._buildObservation` (champion replay).

Because champion replay drives the *same* `GameEngine` a human uses, and
training simulations call the same `GameRules` functions, the three modes
cannot drift apart. There is no second implementation of any rule anywhere.

## Threading model

- **Main thread**: DOM, Play engine, SVG rendering, settings, checkpoint I/O.
- **Worker thread**: population, simulations, inference, fitness, evolution.

The worker is created with `new Worker(new URL('../workers/TrainingWorker.js',
import.meta.url), { type: 'module' })` so the path resolves relative to the
importing module regardless of page URL. Message types are centralized in
`utils/Constants.js` (`WorkerMessageType`). Champion parameters cross the
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

The UI never requests per-generation permission; the loop runs until a human
pauses or stops it.

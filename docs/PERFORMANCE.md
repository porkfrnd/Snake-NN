# Performance

## Headless by default

Training simulations are pure numeric state machines (`training/SnakeSimulation.js`).
They never construct SVG nodes, never touch the DOM, and never run per-frame
rendering for the population. Only **Watch champion** renders a live game —
one game, through the normal Play-mode engine.

## Web Worker owns the loop

Everything expensive (simulation, `forward()`, fitness, evolution) runs inside
`workers/TrainingWorker.js`. The main thread's job per generation is one
`STATS` message and, occasionally, one `CHAMPION` message. Measured during
training at Normal intensity on a mid-range laptop:

- UI requestAnimationFrame median frame time: **16.7 ms** (60 fps held)
- training throughput: **~1,100 games/sec**, **~90k–125k steps/sec**'

The evaluation horizon grows each generation as a curriculum:
`cfg.timeBudgetStart + (generation−1) · cfg.timeBudgetGrowth`, capped at
`cfg.timeBudgetMax` (default 150 → +3/generation → 1,600). This means:

- **Throughput declines gradually** as the budget grows — games/sec scales roughly
  inversely with the current budget. At budget 1,600 the rate drops to ~100 games/sec.
- **Steps/sec remains the more stable metric** because it reflects per-step cost
  (inference + simulation) which is largely budget-independent.
- The UI displays the current `timeBudget` per generation so the trade-off is
  visible (e.g. "budget 400 · games/sec 320")



## Typed arrays, reused buffers

- Network parameters: one flat `Float32Array` per network (447 floats).
- Simulation state: `Uint8Array` occupancy grid + `Int16Array` ring-buffer body.
  Both allocated once per `FitnessEvaluator` and reused across every game and
  every generation — the hot loop performs **zero allocations**.
- `forward()` writes into three reusable scratch buffers (no per-call arrays).
- A test (`snakeSimulation.test.js → "no per-step allocation"`) pins this
  contract by asserting buffer identity across 50 steps.

## Batching + yielding (real intensity, not cosmetic)

The worker evaluates the population in batches and yields between batches via
`setTimeout` so incoming messages (Pause/Stop) are always processed:

| Intensity | batch size | yield |
|---|---|---|
| Low | 4 | 12 ms |
| Normal | 12 | 6 ms |
| High | 32 | 2 ms |
| Maximum | 64 | 0 ms |

These numbers change actual throughput — games/sec scales roughly with batch
size — they are not animation speeds.

## Interaction throttling

Any `pointerdown`/`keydown` on the page marks the user as active for 800 ms;
during that window the worker drops its batch to a single game and yields at
least 8 ms. Playing Snake while training therefore stays smooth, and training
speed recovers automatically when you stop typing.

## Visibility policy

When the tab is hidden, training pauses unless **Continue training in
background** is enabled (default off — conservative). The check lives on the
main thread (`visibilitychange` → PAUSE/RESUME messages); the worker just obeys.

## Transfer, not serialize

Champion parameters cross worker → UI as a *copied* `Float32Array` whose
backing buffer is transferred (structured clone avoided for the 1.8 KB payload;
the worker keeps its own copy since transferring would neuter its genome).

## Stop means stop

- Main thread: `worker.terminate()` on Stop/Reset; reference dropped.
- Worker: every message handler clears the pending `setTimeout` before
  changing state, so a stopped worker cannot schedule another tick.
- `GameEngine.destroy()` (used on teardown) cancels its rAF and countdown
  timer and removes every listener via `InputManager.destroy()`.

## Bounded memory

- Graph history is capped (`historyLimit = 400` points) and decimated by half
  when exceeded, so long runs don't grow the DOM or the array unboundedly.
- The worker keeps exactly one population and one champion; nothing
  generation-specific is retained.
- Checkpoints are single-slot (one champion payload in localStorage).

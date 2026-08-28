# Snake-NN

A plain Snake game with an evolutionary neural-network training mode built in.
Vanilla JavaScript, inline SVG, hand-written math — **no frameworks, no ML
libraries, no CDNs, no build step**.

Two experiences, one code path:

- **Play** — a good, simple Snake game: keyboard + touch, progressive speed,
  high score, wall wrap, sound, haptics, reduced-motion support.
- **Train** — a real genetic algorithm that evolves 607-parameter neural
  networks to play Snake, running in a Web Worker at ~1,000+ games/sec while
  the rest of the app stays fully responsive.

Every number shown in the UI is measured from a computation that just happened.
There is no pretrained champion, no simulated curve, no fabricated statistic —
a fresh install trains up from genuinely random networks.

---

## Quick start

ES modules and Web Workers require HTTP, so serve the folder instead of
double-clicking the file:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (`npx serve`, `php -S`, nginx, …).

## Play

| Input | Action |
|---|---|
| Arrow keys / WASD | Turn |
| `P` or `Esc` | Pause / resume |
| `Space` | Start / restart |
| `M`-free design | Sound toggle lives in **Settings** |
| D-pad / swipe (touch) | Turn |

Rules are classic: eat apples, grow, avoid walls and yourself. Speed increases
with every apple. Wall wrap is off by default and toggleable in Settings.

## Train

Switch to the **Train** tab and press **Start**.

- **What evolves** — networks shaped `18 → 16 → 15 → 3` by default (18 inputs,
  editable 0–4 hidden layers, 3 outputs; the 607 params are computed by
  `calculateParameterCount()`, never hard-coded). Inputs: food direction &
  distance, danger ahead/left/right, corridor lookahead, **food reachability**
  and free-region size (via BFS), tail distance/safety and tail reachability.
  Outputs: turn left / straight / turn right — relative turns make instant
  self-reversal impossible by construction.
- **Activations** — 12 options: `tanh`, `relu`, `leaky_relu`, `gelu`, `elu`,
  `selu`, `silu`, `mish`, `sigmoid`, `softsign`, `softplus`, `sin`. Each network
  carries one; reproduction flips it with ~1% probability, so the population
  mixes over time (watch the live activation-mix readout).
- **Loop** — elitism (top 10% copied verbatim) → tournament selection →
  Gaussian mutation → rare activation flips → 3% random immigrants. Mutation
  strength adapts: it rises during stagnation, decays back when improving.
- **Champion** — the best network ever found, protected from regression,
  auto-checkpointed every 10 generations, re-validated on unseen food seeds.
- **Watch champion** — replays the saved champion in the real Play-mode game
  through the same engine a human uses (`network.forward()` instead of keys).

### Controls

| Button | Meaning |
|---|---|
| Start / Pause / Resume | Run and hold the evolution loop |
| Stop | Terminates the worker — no background work survives |
| Reset training | Confirmed; wipes population **and** saved champion |
| Save / Load | Champion to/from `localStorage` |
| Export / Import | Champion as a validated JSON file |
| Watch champion | Replay in Play mode |
| Intensity | Low / Normal / High / Maximum — changes real batch size + yield |
| Continue in background | Opt in to training while the tab is hidden |
| Mutation level | 0–100 slider (default 55, maps to Gaussian σ default 0.35) |
| Population | Select 50 / 100 / **150** (default) / 250 / 400 |
| Board size | Select 12 / 16 / **20** (default) / 24 / 30 cells per side |
| Apples at once | Select **1** (default) / 2 / 3 / 4 simultaneous foods |

**Champion replay speed** is selectable (1×, 1.25×, 1.5×, 1.75×, 2×, 2.5×, 3×) and
scales the tick rate proportionally via `GameEngine.setReplaySpeed()`.

**Fullscreen buttons**: a ⛶ button in the training graph header (fullscreens the
graph area) and a floating ⛶ button over the game board (fullscreens the board),
both using the browser Fullscreen API.

### Training controls

Four simulation-level controls are persisted to `localStorage` and sent to the
training worker to rebuild the run:

| Control | Options / default | Persisted under | Worker message |
|---|---|---|---|
| Mutation level | 0–100 slider, default **55** (maps to Gaussian σ 0.35, `cfg.mutationStrength`) | `snake.settings.mutation` | `SET_MUTATION {strength}` |
| Population | 50 / 100 / **150** / 250 / 400 | `snake.settings.population` | `SET_POPULATION {size}` |
| Board size | 12 / 16 / **20** / 24 / 30 (cells per side, square) | `snake.settings.board` | `SET_BOARD {size}` |
| Apples at once | **1** / 2 / 3 / 4 | `snake.settings.apples` | `SET_APPLES {count}` |

- **Mutation level** sets the live Gaussian σ on `engine.mutationStrength` and
  `cfg.mutationStrength` (the stored value is parsed to 0–1).
- **Population** updates `cfg.populationSize` and rebuilds the population.
- **Board size** applies a square board of the chosen cells-per-side via
  `setBoard(w,h)` in `js/game/GameRules.js`. Because `setBoard` reallocates the
  engine/simulation/renderer buffers, it runs **before** any of them are built.
- **Apples at once** sets `cfg.appleCount` and rebuilds. Multi-apple is supported
  in **both** headless training (`SnakeSimulation` keeps a `foodSet` array and
  its 18-input observation targets the *nearest* food) and Play mode (`Foods`
  collection manager), so Play mode follows the persisted `appleCount` too.

### Performance notes

- Training is **headless** — simulations never touch the DOM or SVG.
- All evaluation lives in a **module Web Worker**; the UI thread only renders.
- Simulation state is typed arrays (`Uint8Array` occupancy + `Int16Array`
  ring-buffer body) with zero allocation per step.
- While you interact (any pointer/key event), the worker shrinks its batch to
  keep your input latency low; it scales back up automatically.
- Measured on a laptop at **Normal** intensity: ~1,100 games/sec,
  ~90k steps/sec, UI frame median 16.7 ms (60 fps) during training.

## Configuration

All tuning constants live in two files:

- `js/training/TrainingConfig.js` — population, elitism, mutation, caps,
  intensity presets, checkpoint cadence.
- `js/game/GameRules.js` — grid size, speeds, scoring, and the shared
  movement/collision/observation rules used by **both** Play mode and the
  headless simulation (one implementation, no drift).

## Testing

Plain-assertion test scripts — no test framework:

```bash
npm test          # runs all three suites — 52 assertions passing
# or individually:
node tests/neuralNetwork.test.js     # 17 assertions: params, forward, mutation,
                                     # clone, serialize round-trip, NaN repair
node tests/snakeSimulation.test.js   # 15 assertions: movement, collision, food,
                                     # wrap, tail-vacate, caps, observations
node tests/evolutionEngine.test.js   # 20 assertions: elitism, selection,
                                     # champion protection, stagnation, seeding
```

## Project layout

```
├── index.html              # shell + all markup (Play + Train)
├── css/                    # base tokens, game styles, training styles
├── js/
│   ├── main.js             # boot
│   ├── game/               # Play mode + shared GameRules (DOM-aware)
│   ├── ai/                 # NeuralNetwork, activations, config, serializer (DOM-free)
│   ├── training/           # simulation, fitness, population, evolution (DOM-free)
│   ├── workers/            # TrainingWorker — owns the whole loop
│   ├── storage/            # settings + champion checkpoints (validated)
│   ├── ui/                 # panels, SVG graph, network inspector (no sim logic)
│   └── utils/              # seeded PRNG, math, constants/message types
├── tests/                  # plain node assertion scripts
└── docs/                   # architecture, network, training, performance
```

Separation rules enforced throughout: `ai/` and `training/` never touch
`document`; `ui/` contains no simulation logic; `GameRules.js` is the single
authority for rules shared by human play, AI replay, and training.

## Checkpoints & portability

The champion is stored in `localStorage` under `ai.checkpoint.v1` as:

```json
{
  "kind": "snake-nn-champion",
  "version": 1,
  "network": { "shape": [18,16,15,3], "activation": "leaky_relu", "params": ["…607 floats…"] },
  "fitness": 2665.8,
  "generation": 50,
  "savedAt": "2026-08-26T10:23:37.580Z",
  "config": { "…training config snapshot…" }
}
```

Everything is validated on load — version, shape, parameter count, activation
name, and per-value finiteness. Corrupt or tampered files are rejected and the
app falls back to a fresh random champion without breaking anything.

## Browser support

Evergreen Chrome, Edge, Firefox, and Safari. Requires module-worker support
(all of the above since ~2023). No network access is needed at any point.

## License

MIT — see the repo. Built as a from-scratch exercise: game engine, neural
network, genetic algorithm, SVG charts, and worker scheduling are all
hand-rolled in this repository.

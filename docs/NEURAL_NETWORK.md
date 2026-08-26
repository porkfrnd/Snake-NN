# Neural Network

## Shape and parameter math

Exactly two hidden layers: `input → hidden1 → hidden2 → output`.

```
INPUT_SIZE = 8, HIDDEN1 = 16, HIDDEN2 = 15, OUTPUT_SIZE = 3
```

The count is *computed*, never hard-coded — `NetworkConfig.calculateParameterCount()`:

```
layer1: 8*16  weights + 16 biases = 144
layer2: 16*15 weights + 15 biases = 255
layer3: 15*3  weights +  3 biases =  48
                                  ─────
total                              447   (target ≈ 440, window 400–480)
```

## Inputs (8)

All computed in the shared `GameRules.buildObservation()` — the same function
used by Play-mode replay, so the network always sees the world identically:

| # | Name | Range | Meaning |
|---|---|---|---|
| 0 | foodForward | [-1, 1] | dot(food − head, forward) / span |
| 1 | foodLeft | [-1, 1] | dot(food − head, left) / span |
| 2 | dangerAhead | {0, 1} | wall or body straight ahead |
| 3 | dangerLeft | {0, 1} | wall or body to the left |
| 4 | dangerRight | {0, 1} | wall or body to the right |
| 5 | foodDist | [0, 1] | Manhattan distance to food, normalized |
| 6 | wallAhead | [0, 1] | 1 − free cells ahead / span (1.0 when wrap on) |
| 7 | lengthNorm | [0, 1] | length / 400 |

## Outputs (3)

Raw logits for **turn-left / straight / turn-right**, argmax-selected. Because
actions are *relative* to the current heading (`turnDir()` in GameRules), an
instant 180° reversal is impossible by construction.

## Forward pass

```
z1 = W1·x + b1   a1 = act(z1)
z2 = W2·a1 + b2  a2 = act(z2)
out = W3·a2 + b3            (logits, no final activation)
```

Parameters live in one flat `Float32Array` with layout offsets derived in
`NetworkConfig.LAYOUT` (row-major weights per layer, biases after each).
`forward()` writes into reusable scratch buffers (`#h1`, `#h2`, `#out`) —
zero allocation per call, which matters at ~90k steps/sec.

## Activations

| id | formula | init std |
|---|---|---|
| `tanh` | tanh(z) | Xavier √(1/fan_in) |
| `relu` | max(0, z) | He √(2/fan_in) |
| `leaky_relu` | z ≥ 0 ? z : 0.01·z | He √(2/fan_in) |
| `gelu` | 0.5·z·(1 + tanh(√(2/π)·(z + 0.044715·z³))) | Xavier √(1/fan_in) |

GELU uses the tanh approximation — stable, no exp overflow.

### Activation evolution

Each network carries an activation *identity*. During reproduction an offspring
flips to a different activation with probability `activationMutationRate`
(default 1%). The flip does **not** touch weights. The population therefore
drifts between activations over time instead of locking in — the UI shows the
live mix (e.g. `tanh 2% relu 4% leaky_relu 89% gelu 5%`).

## Mutation

`mutate(rate, strength, rng)` — for each parameter, with probability `rate`:

```
p += gaussian() * strength        (Box–Muller sampler in utils/Random.js)
p clamped to [-8, 8]
```

## Numerical safety

- `sanitize()` scans all parameters and replaces NaN/±Infinity with 0,
  returning the repair count. It runs after construction and after mutation.
- `forward()` ignores non-finite *inputs* (treats them as 0) rather than
  propagating poison.
- `mutate()` re-checks finiteness before writing and clamps magnitude.
- Deserialization rejects any non-finite value outright (see below).

## Cloning & serialization

- `clone()` — new network sharing the activation and a *copy* of the params.
- `serialize()` — plain object `{ version, shape, activation, parameterCount,
  params: number[] }` (JSON-safe).
- `NeuralNetwork.deserialize(data)` — validates version, shape, activation
  name, parameter count and per-value finiteness; throws on any mismatch.

`ai/NetworkSerializer.js` wraps that in a full champion payload
(`kind: "snake-nn-champion"`, fitness, generation, timestamps, config
snapshot) used by checkpoints, export and import. Corrupt payloads throw with
a precise message; callers catch and fall back to a fresh network.

'use strict';

/**
 * Plain-assertion tests for the neural network core (dynamic architectures,
 * twelve activations, serialization). Run: node tests/neuralNetwork.test.js
 */
import { NeuralNetwork } from '../js/ai/NeuralNetwork.js';
import {
  INPUT_SIZE, OUTPUT_SIZE, DEFAULT_HIDDEN, ARCH_LIMITS,
  fullDims, normalizeHidden, calculateParameterCount, buildLayout, shapeLabel, PARAM_COUNT,
} from '../js/ai/NetworkConfig.js';
import { activate, initStd, ACTIVATIONS, DEFAULT_ACTIVATION } from '../js/ai/ActivationFunctions.js';
import { Random } from '../js/utils/Random.js';

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); }
function ok(v, msg = '') { if (!v) throw new Error(msg || 'expected truthy'); }
function near(a, b, eps = 1e-6, msg = '') { if (Math.abs(a - b) > eps) throw new Error(`${msg} expected ~${b}, got ${a}`); }

console.log('neuralNetwork.test.js');

t('default architecture math: 18/16/15/3 -> 607 total (288 + 240 + 48)', () => {
  const dims = fullDims(DEFAULT_HIDDEN);
  eq(dims.join(','), '18,16,15,3');
  const c = calculateParameterCount(dims);
  eq(c.total, 607);
  eq(c.weights, 18 * 16 + 16 * 15 + 15 * 3);
  eq(c.biases, 16 + 15 + 3);
  eq(c.layers[0].weights, 288);
  eq(c.layers[1].weights, 240);
  eq(c.layers[2].weights, 45);
});

t('layout offsets are consistent with the count for several shapes', () => {
  for (const hidden of [[16, 15], [4], [], [10, 6, 12], [2]]) {
    const dims = fullDims(hidden);
    const L = buildLayout(dims);
    let expected = 0;
    for (let l = 0; l < dims.length - 1; l++) {
      eq(L[l].inSize, dims[l]);
      eq(L[l].outSize, dims[l + 1]);
      eq(L[l].w, expected, `w offset layer ${l}`);
      expected += dims[l] * dims[l + 1];
      eq(L[l].b, expected, `b offset layer ${l}`);
      expected += dims[l + 1];
    }
    eq(L.total, calculateParameterCount(dims).total, `total for ${shapeLabel(dims)}`);
  }
});

t('forward returns 3 finite logits and is deterministic', () => {
  const net = new NeuralNetwork({});
  const input = new Float32Array(INPUT_SIZE).fill(0.5);
  const a = Array.from(net.forward(input));
  const b = Array.from(net.forward(input));
  eq(a.length, OUTPUT_SIZE);
  for (let i = 0; i < OUTPUT_SIZE; i++) {
    ok(Number.isFinite(a[i]), `logit ${i} finite`);
    near(a[i], b[i], 0, 'deterministic');
  }
});

t('all twelve activations compute correct anchor values', () => {
  near(activate('tanh', 0), 0);
  eq(activate('relu', -2), 0);
  eq(activate('relu', 3), 3);
  eq(activate('leaky_relu', -2), -0.02);
  near(activate('gelu', 0), 0);
  eq(activate('elu', 1), 1);
  ok(activate('elu', -1) < 0 && activate('elu', -1) > -1.7, 'elu negative branch bounded');
  ok(Math.abs(activate('selu', 1) - 1.0507009873554805) < 1e-9, 'selu positive slope');
  near(activate('silu', 0), 0);
  near(activate('mish', 0), 0);
  near(activate('sigmoid', 0), 0.5);
  near(activate('softsign', 5), 5 / 6);
  near(activate('softplus', 0), Math.LN2, 1e-9);
  eq(activate('sin', 0), 0);
  near(activate('sin', Math.PI / 2), 1);
});

t('activations are overflow-safe at extreme inputs', () => {
  for (const id of ACTIVATIONS) {
    for (const x of [-800, 800]) {
      ok(Number.isFinite(activate(id, x)), `${id}(${x}) must be finite`);
    }
  }
  eq(activate('sigmoid', -800), 0);
  eq(activate('sigmoid', 800), 1);
  eq(activate('softplus', 800), 800, 'stable softplus is exact for large x');
});

t('every activation produces finite forward passes on multiple shapes', () => {
  for (const actId of ACTIVATIONS) {
    for (const hidden of [[16, 15], [6], []]) {
      const net = new NeuralNetwork({ activation: actId, hidden });
      const out = net.forward(new Float32Array(INPUT_SIZE).fill(0.25));
      eq(out.length, OUTPUT_SIZE);
      for (const v of out) ok(Number.isFinite(v), `${actId} ${hidden} -> non-finite output`);
    }
  }
});

t('init std follows the He / Xavier family table', () => {
  for (const id of ['relu', 'leaky_relu', 'elu', 'silu', 'mish', 'sin']) {
    near(initStd(id, 50), Math.sqrt(2 / 50));
  }
  for (const id of ['selu']) near(initStd(id, 50), Math.sqrt(1 / 50));
  for (const id of ['tanh', 'gelu', 'sigmoid', 'softsign', 'softplus']) {
    near(initStd(id, 50), Math.sqrt(1 / 50));
  }
});

t('variable architectures: forward works for linear, single and deep shapes', () => {
  const cases = [[], [4], [10, 6, 12], [2]];
  for (const hidden of cases) {
    const net = new NeuralNetwork({ hidden });
    eq(net.shape.join(','), fullDims(hidden).join(','));
    const out = net.forward(new Float32Array(INPUT_SIZE).fill(1));
    eq(out.length, OUTPUT_SIZE);
    for (const v of out) ok(Number.isFinite(v));
  }
});

t('normalizeHidden enforces the editor limits', () => {
  ok(normalizeHidden([16, 15]).join(',') === '16,15');
  throws(() => normalizeHidden(new Array(ARCH_LIMITS.maxHiddenLayers + 1).fill(4)), 'too many layers');
  throws(() => normalizeHidden([ARCH_LIMITS.maxNodesPerLayer + 1]), 'too many nodes');
  throws(() => normalizeHidden([1]), 'too few nodes');
  throws(() => normalizeHidden([4.5]), 'non-integer node count');
});
function throws(fn, msg) {
  try { fn(); } catch { return; }
  throw new Error(`expected throw: ${msg}`);
}

t('clone is independent and preserves shape + activation', () => {
  const net = new NeuralNetwork({ hidden: [7, 5], activation: 'mish' });
  const c = net.clone();
  eq(c.shape.join(','), net.shape.join(','));
  eq(c.activation, 'mish');
  c.params[0] += 100;
  ok(net.params[0] !== c.params[0], 'params are copies, not references');
});

t('mutate keeps parameters finite and bounded', () => {
  const rng = new Random(9);
  for (let k = 0; k < 20; k++) rng.gaussian();
  const net = new NeuralNetwork({ hidden: [5] });
  net.mutate(0.9, 5, rng);
  for (const v of net.params) ok(Number.isFinite(v) && Math.abs(v) <= 8.000001);
});

t('setActivation flips identity without touching weights', () => {
  const net = new NeuralNetwork({ hidden: [6] });
  const before = net.params.slice();
  net.setActivation('selu');
  eq(net.activation, 'selu');
  for (let i = 0; i < before.length; i++) eq(net.params[i], before[i]);
});

t('sanitize repairs NaN/Infinity parameters', () => {
  const net = new NeuralNetwork({ hidden: [4] });
  net.params[3] = NaN;
  net.params[7] = Infinity;
  const repaired = net.sanitize();
  eq(repaired, 2);
  eq(net.params[3], 0);
  eq(net.params[7], 0);
});

t('serialize -> deserialize round-trips exactly (default and custom shapes)', () => {
  for (const opts of [{}, { hidden: [10, 6, 12], activation: 'gelu' }, { hidden: [], activation: 'sin' }]) {
    const net = new NeuralNetwork(opts);
    const data = JSON.parse(JSON.stringify(net.serialize()));
    const back = NeuralNetwork.deserialize(data);
    eq(back.shape.join(','), net.shape.join(','));
    eq(back.activation, net.activation);
    eq(back.parameterCount, net.parameterCount);
    for (let i = 0; i < net.params.length; i++) {
      // serialize() rounds to 6 decimals (JSON-safe) — compare against that.
      near(back.params[i], Number(net.params[i].toFixed(6)), 1e-6, `param ${i}`);
    }
  }
});

t('deserialize rejects tampered payloads precisely', () => {
  const good = new NeuralNetwork({ hidden: [6] }).serialize();
  throws(() => NeuralNetwork.deserialize({ ...good, version: 99 }), 'bad version');
  throws(() => NeuralNetwork.deserialize({ ...good, activation: 'linear' }), 'unknown activation');
  throws(() => NeuralNetwork.deserialize({ ...good, params: good.params.slice(0, 5) }), 'short params');
  throws(() => NeuralNetwork.deserialize({ ...good, shape: [7, 6, 3] }), 'wrong input size');
  throws(() => NeuralNetwork.deserialize({ ...good, shape: [8, 6, 4] }), 'wrong output size');
  throws(() => NeuralNetwork.deserialize({
    ...good, shape: [8, 4, 4, 4, 4, 4, 3], parameterCount: 999, params: [],
  }), 'too many hidden layers');
  const nanParams = [...good.params]; nanParams[2] = 'oops';
  throws(() => NeuralNetwork.deserialize({ ...good, params: nanParams }), 'non-finite param');
  // parameterCount claim inconsistent with its own shape:
  const lie = { ...good, shape: [18, 6, 3], parameterCount: 999 };
  throws(() => NeuralNetwork.deserialize(lie), 'count does not match claimed shape');
});

t('seeded runs reproduce identical networks for any shape', () => {
  const mk = () => {
    const rng = new Random(2024);
    return new NeuralNetwork({ hidden: [9, 3], rng, activation: 'leaky_relu' });
  };
  const a = mk(), b = mk();
  for (let i = 0; i < a.params.length; i++) eq(a.params[i], b.params[i]);
});

t('module exports stay coherent', () => {
  eq(INPUT_SIZE, 18);
  eq(OUTPUT_SIZE, 3);
  eq(PARAM_COUNT, 607);
  ok(ACTIVATIONS.length >= 10, `activation list has ${ACTIVATIONS.length} entries`);
  ok(DEFAULT_ACTIVATION === 'tanh');
  eq(shapeLabel(fullDims(DEFAULT_HIDDEN)), '18→16→15→3');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

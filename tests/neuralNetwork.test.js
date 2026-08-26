'use strict';

/**
 * Plain-assertion tests for the neural network core. Run: node tests/neuralNetwork.test.js
 */
import { NeuralNetwork } from '../js/ai/NeuralNetwork.js';
import { calculateParameterCount, PARAM_COUNT, INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE } from '../js/ai/NetworkConfig.js';
import { activate } from '../js/ai/ActivationFunctions.js';
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

t('parameter count math: 8/16/15/3 -> 447 total (144 + 255 + 48)', () => {
  const c = calculateParameterCount(8, 16, 15, 3);
  eq(c.total, 447);
  eq(c.weights, 8 * 16 + 16 * 15 + 15 * 3);
  eq(c.biases, 16 + 15 + 3);
  eq(c.layers[0].weights, 128);
  eq(c.layers[1].weights, 240);
  eq(c.layers[2].weights, 45);
});

t('module constants match the calculation (not hard-coded)', () => {
  eq(PARAM_COUNT, calculateParameterCount(INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE).total);
  ok(PARAM_COUNT >= 400 && PARAM_COUNT <= 480, `count ${PARAM_COUNT} should be near the 440 target`);
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

t('forward rejects wrong-size input gracefully (returns zeros, no throw)', () => {
  const net = new NeuralNetwork({});
  const out = net.forward(new Float32Array(3));
  eq(out.length, OUTPUT_SIZE);
});

t('all four activations compute correctly', () => {
  near(activate('tanh', 0), 0);
  near(activate('relu', -2), 0);
  near(activate('relu', 3), 3);
  near(activate('leaky_relu', -2), -0.02);
  near(activate('leaky_relu', 2), 2);
  ok(activate('gelu', 0) === 0, 'gelu(0)=0');
  near(activate('gelu', 2), 2 * (0.5 * (1 + Math.tanh(0.7978845608 * (2 + 0.044715 * 8)))), 1e-9);
  ok(activate('gelu', -3) < 0.1 && activate('gelu', -3) > -0.1, 'gelu small negative near zero');
});

t('clone is independent (mutating clone leaves original untouched)', () => {
  const net = new NeuralNetwork({});
  const clone = net.clone();
  const before = net.params.slice();
  clone.mutate(1.0, 0.5, new Random(42));
  let diff = 0;
  for (let i = 0; i < PARAM_COUNT; i++) if (net.params[i] !== clone.params[i]) diff++;
  ok(diff > PARAM_COUNT * 0.5, `expected most params to differ, got ${diff}`);
  for (let i = 0; i < PARAM_COUNT; i++) near(net.params[i], before[i], 0, 'original untouched');
});

t('mutate keeps parameters finite and bounded', () => {
  const net = new NeuralNetwork({});
  net.mutate(1.0, 3.0, new Random(7));
  for (let i = 0; i < PARAM_COUNT; i++) {
    ok(Number.isFinite(net.params[i]), `param ${i} finite`);
    ok(Math.abs(net.params[i]) <= 8, `param ${i} bounded`);
  }
});

t('setActivation flips identity without touching weights', () => {
  const net = new NeuralNetwork({});
  const before = net.params.slice();
  net.setActivation('gelu');
  eq(net.activation, 'gelu');
  for (let i = 0; i < PARAM_COUNT; i++) near(net.params[i], before[i], 0, 'weights preserved');
});

t('sanitize repairs NaN/Infinity parameters', () => {
  const net = new NeuralNetwork({});
  net.params[0] = NaN;
  net.params[100] = Infinity;
  net.params[200] = -Infinity;
  const repaired = net.sanitize();
  eq(repaired, 3);
  near(net.params[0], 0); near(net.params[100], 0); near(net.params[200], 0);
});

t('serialize -> deserialize round-trips exactly', () => {
  const net = new NeuralNetwork({ activation: 'leaky_relu' });
  const data = net.serialize();
  const copy = NeuralNetwork.deserialize(data);
  eq(copy.activation, 'leaky_relu');
  for (let i = 0; i < PARAM_COUNT; i++) near(copy.params[i], net.params[i], 1e-6);
  const input = new Float32Array(INPUT_SIZE).fill(0.3);
  const o1 = Array.from(net.forward(input));
  const o2 = Array.from(copy.forward(input));
  for (let i = 0; i < OUTPUT_SIZE; i++) near(o1[i], o2[i], 1e-5, 'same outputs after round-trip');
});

t('deserialize rejects bad payloads', () => {
  let threw = 0;
  const cases = [
    () => NeuralNetwork.deserialize(null),
    () => NeuralNetwork.deserialize({ version: 2, shape: [8, 16, 15, 3], activation: 'tanh', params: [] }),
    () => NeuralNetwork.deserialize({ version: 1, shape: [4, 4, 4, 4], activation: 'tanh', params: new Array(PARAM_COUNT).fill(0) }),
    () => NeuralNetwork.deserialize({ version: 1, shape: [8, 16, 15, 3], activation: 'sigmoid', params: new Array(PARAM_COUNT).fill(0) }),
    () => NeuralNetwork.deserialize({ version: 1, shape: [8, 16, 15, 3], activation: 'tanh', params: new Array(PARAM_COUNT - 1).fill(0) }),
    () => NeuralNetwork.deserialize({ version: 1, shape: [8, 16, 15, 3], activation: 'tanh', params: new Array(PARAM_COUNT).fill(NaN) }),
  ];
  for (const c of cases) { try { c(); } catch { threw++; } }
  eq(threw, cases.length, 'all invalid payloads must throw');
});

t('seeded Random is reproducible; gaussian is roughly normal', () => {
  const a = new Random(123), b = new Random(123);
  for (let i = 0; i < 100; i++) near(a.next(), b.next(), 0, 'same seed same stream');
  const g = new Random(9);
  let sum = 0, sumSq = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) { const v = g.gaussian(); sum += v; sumSq += v * v; }
  const mean = sum / n;
  const varr = sumSq / n - mean * mean;
  ok(Math.abs(mean) < 0.05, `mean near 0, got ${mean}`);
  ok(varr > 0.9 && varr < 1.1, `variance near 1, got ${varr}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

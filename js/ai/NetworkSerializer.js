'use strict';

import { NeuralNetwork } from './NeuralNetwork.js';
import { calculateParameterCount } from './NetworkConfig.js';
import { isActivation } from './ActivationFunctions.js';

/**
 * NetworkSerializer — validation-first (de)serialization for checkpoints,
 * export files and worker transfers. Corrupt data throws; callers catch and
 * fall back. Shape validation is SELF-consistent: any user-chosen architecture
 * round-trips, while tampered shapes/counts are rejected.
 */

/** Validate a plain checkpoint payload; throws with a precise message on any problem. */
export function validatePayload(data) {
  if (!data || typeof data !== 'object') throw new Error('Payload is not an object');
  if (data.kind !== 'snake-nn-champion') throw new Error('Not a snake-nn-champion payload');
  if (data.version !== 1) throw new Error(`Unsupported version: ${data.version}`);

  const net = data.network;
  if (!net || typeof net !== 'object') throw new Error('Missing network');
  if (net.version !== 1) throw new Error('Unsupported network version');
  if (!Array.isArray(net.shape)) throw new Error('Missing shape');

  let expected;
  try { expected = calculateParameterCount(net.shape).total; }
  catch { throw new Error(`Invalid shape: ${net.shape}`); }
  if (net.parameterCount !== expected) {
    throw new Error(`Parameter count mismatch for shape ${net.shape.join('x')}: expected ${expected}, got ${net.parameterCount}`);
  }
  if (!isActivation(net.activation)) throw new Error(`Unknown activation: ${net.activation}`);
  if (!Array.isArray(net.params) || net.params.length !== expected) {
    throw new Error(`params must be an array of length ${expected}`);
  }
  for (let i = 0; i < expected; i++) {
    if (!Number.isFinite(net.params[i])) throw new Error(`Non-finite parameter at index ${i}`);
  }

  if (!Number.isFinite(data.fitness)) throw new Error('Missing finite fitness');
  if (!Number.isInteger(data.generation) || data.generation < 0) throw new Error('Invalid generation');
  return true;
}

/** Full champion payload -> plain JSON object (for localStorage / export files). */
export function toPayload(net, meta) {
  const body = {
    kind: 'snake-nn-champion',
    version: 1,
    network: net.serialize(),
    fitness: meta.fitness,
    generation: meta.generation,
    score: meta.score ?? null,
    valFitness: meta.valFitness ?? null,
    savedAt: meta.savedAt ?? new Date().toISOString(),
    config: meta.config ?? null,
  };
  validatePayload(body);
  return body;
}

/** Plain payload -> live NeuralNetwork (throws if invalid). */
export function fromPayload(data) {
  validatePayload(data);
  return NeuralNetwork.deserialize(data.network);
}

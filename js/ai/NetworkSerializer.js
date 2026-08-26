'use strict';

import { NeuralNetwork } from './NeuralNetwork.js';
import { PARAM_COUNT, INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE } from './NetworkConfig.js';
import { isActivation } from './ActivationFunctions.js';

/**
 * NetworkSerializer — validation-first (de)serialization for checkpoints,
 * export files and worker transfers. Corrupt data throws; callers catch and fall back.
 */

/** Validate a plain checkpoint payload; throws with a precise message on any problem. */
export function validatePayload(data) {
  if (!data || typeof data !== 'object') throw new Error('Payload is not an object');
  if (data.kind !== 'snake-nn-champion') throw new Error('Not a snake-nn-champion payload');
  if (data.version !== 1) throw new Error(`Unsupported version: ${data.version}`);

  const net = data.network;
  if (!net || typeof net !== 'object') throw new Error('Missing network');
  if (net.version !== 1) throw new Error('Unsupported network version');
  const expectedShape = [INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE];
  if (!Array.isArray(net.shape) || net.shape.length !== 4 || net.shape.some((v, i) => v !== expectedShape[i])) {
    throw new Error(`Shape mismatch: expected ${expectedShape.join('x')}`);
  }
  if (!isActivation(net.activation)) throw new Error(`Unknown activation: ${net.activation}`);
  if (net.parameterCount !== PARAM_COUNT) {
    throw new Error(`Parameter count mismatch: expected ${PARAM_COUNT}, got ${net.parameterCount}`);
  }
  if (!Array.isArray(net.params) || net.params.length !== PARAM_COUNT) {
    throw new Error(`params must be an array of length ${PARAM_COUNT}`);
  }
  for (let i = 0; i < PARAM_COUNT; i++) {
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

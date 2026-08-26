'use strict';

/**
 * NetworkConfig — architecture dimensions and the REAL parameter-count math.
 * Nothing hard-codes 440; the count is derived from the dimensions below.
 *
 * Chosen so the true total lands inside the ~400–480 window around the 440 target:
 *   8 inputs, 16 hidden1, 15 hidden2, 3 outputs
 *   weights+bias per layer:
 *     L1: 8*16 + 16  = 144
 *     L2: 16*15 + 15 = 255
 *     L3: 15*3 + 3   =  48
 *   total            = 447
 */

export const INPUT_SIZE = 8;
export const HIDDEN1 = 16;
export const HIDDEN2 = 15;
export const OUTPUT_SIZE = 3;
export const PARAMETER_TARGET = 440;

export function calculateParameterCount(inputs, hidden1, hidden2, outputs) {
  const l1w = inputs * hidden1, l1b = hidden1;
  const l2w = hidden1 * hidden2, l2b = hidden2;
  const l3w = hidden2 * outputs, l3b = outputs;
  return {
    total: l1w + l1b + l2w + l2b + l3w + l3b,
    weights: l1w + l2w + l3w,
    biases: l1b + l2b + l3b,
    layers: [
      { weights: l1w, biases: l1b },
      { weights: l2w, biases: l2b },
      { weights: l3w, biases: l3b },
    ],
  };
}

/** Flat Float32Array layout offsets, derived from the dimensions. */
const _count = calculateParameterCount(INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE);
export const PARAM_COUNT = _count.total;
export const LAYOUT = Object.freeze({
  w1: 0,
  b1: INPUT_SIZE * HIDDEN1,
  w2: INPUT_SIZE * HIDDEN1 + HIDDEN1,
  b2: INPUT_SIZE * HIDDEN1 + HIDDEN1 + HIDDEN1 * HIDDEN2,
  w3: INPUT_SIZE * HIDDEN1 + HIDDEN1 + HIDDEN1 * HIDDEN2 + HIDDEN2,
  b3: INPUT_SIZE * HIDDEN1 + HIDDEN1 + HIDDEN1 * HIDDEN2 + HIDDEN2 + HIDDEN2 * OUTPUT_SIZE,
  total: PARAM_COUNT,
});

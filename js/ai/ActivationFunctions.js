'use strict';

/**
 * ActivationFunctions — twelve activations with overflow-safe math plus
 * init-scale helpers matched to each function's variance behaviour.
 *
 * Families:
 *   saturating      tanh, sigmoid, softsign        -> Xavier   sqrt(1/fan_in)
 *   rectified       relu, leaky_relu, elu, selu,
 *                   silu (swish), mish             -> He       sqrt(2/fan_in)
 *   smooth modern   gelu                           -> Xavier   sqrt(1/fan_in)
 *   periodic        sin (SIREN-style)              -> He-equivalent sqrt(2/fan_in)
 *                                                   (std of U(±sqrt(6/fan)))
 */

export const ACTIVATIONS = Object.freeze([
  'tanh', 'relu', 'leaky_relu', 'gelu', 'elu', 'selu',
  'silu', 'mish', 'sigmoid', 'softsign', 'softplus', 'sin',
]);

export const DEFAULT_ACTIVATION = 'tanh';

/** SELU constants (Klambauer et al., 2017). */
const SELU_LAMBDA = 1.0507009873554805;
const SELU_ALPHA = 1.6732632423543778;

export function isActivation(id) { return ACTIVATIONS.includes(id); }

/** Numerically stable logistic: no exp() of a positive number, ever. */
function sigmoid(x) {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

/** Stable softplus: max(x,0) + log1p(exp(-|x|)) — bounded for all x. */
function softplus(x) {
  return Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));
}

export function activate(id, x) {
  switch (id) {
    case 'tanh': return Math.tanh(x);
    case 'relu': return x > 0 ? x : 0;
    case 'leaky_relu': return x >= 0 ? x : 0.01 * x;
    case 'gelu': {
      const c = 0.7978845608028654; // sqrt(2/pi)
      return 0.5 * x * (1 + Math.tanh(c * (x + 0.044715 * x * x * x)));
    }
    case 'elu': return x > 0 ? x : SELU_ALPHA * Math.expm1(Math.max(x, -15));
    case 'selu':
      return x > 0 ? SELU_LAMBDA * x : SELU_LAMBDA * SELU_ALPHA * Math.expm1(Math.max(x, -15));
    case 'silu': return x * sigmoid(x);
    case 'mish': return x * Math.tanh(softplus(x));
    case 'sigmoid': return sigmoid(x);
    case 'softsign': return x / (1 + Math.abs(x));
    case 'softplus': return softplus(x);
    case 'sin': return Math.sin(x);
    default: return Math.tanh(x);
  }
}

/** Init std per family (see header table). */
export function initStd(id, fanIn) {
  switch (id) {
    case 'relu':
    case 'leaky_relu':
    case 'elu':
    case 'silu':
    case 'mish':
    case 'sin':
      return Math.sqrt(2 / fanIn);                       // He
    case 'selu':
      return Math.sqrt(1 / fanIn);                       // LeCun (SELU pairs with it)
    default:
      return Math.sqrt(1 / fanIn);                       // Xavier
  }
}

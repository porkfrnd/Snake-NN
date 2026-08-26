'use strict';

/**
 * ActivationFunctions — the four supported activations plus init-scale helpers.
 * GELU uses the numerically-stable tanh approximation (Hendrycks & Gimpel, 2016).
 */

export const ACTIVATIONS = Object.freeze(['tanh', 'relu', 'leaky_relu', 'gelu']);

export function isActivation(id) { return ACTIVATIONS.includes(id); }

export function activate(id, x) {
  switch (id) {
    case 'tanh': return Math.tanh(x);
    case 'relu': return x > 0 ? x : 0;
    case 'leaky_relu': return x >= 0 ? x : 0.01 * x;
    case 'gelu': {
      const c = 0.7978845608028654; // sqrt(2/pi)
      return 0.5 * x * (1 + Math.tanh(c * (x + 0.044715 * x * x * x)));
    }
    default: return Math.tanh(x);
  }
}

/** He-style std for ReLU family, Xavier-style std for tanh/GELU. */
export function initStd(id, fanIn) {
  if (id === 'relu' || id === 'leaky_relu') return Math.sqrt(2 / fanIn);
  return Math.sqrt(1 / fanIn);
}

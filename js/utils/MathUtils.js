'use strict';

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Index of the largest value. */
export function argmax(arr, n = arr.length) {
  let best = 0;
  for (let i = 1; i < n; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

export const fmt = (n, d = 1) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

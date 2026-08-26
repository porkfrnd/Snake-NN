'use strict';

/**
 * Seeded PRNG (mulberry32) + Gaussian sampler.
 * Deterministic when seeded — used for reproducible simulations and tests.
 */
export class Random {
  constructor(seed = (Math.random() * 0xffffffff) >>> 0) {
    this.s = seed >>> 0;
    this._spare = null;
  }

  /** float in [0, 1) */
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min, max) */
  range(min, max) { return min + this.next() * (max - min); }

  /** int in [min, max] inclusive */
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }

  /** Standard normal via Box–Muller with cached spare. */
  gaussian() {
    if (this._spare !== null) { const v = this._spare; this._spare = null; return v; }
    let u = 0, v = 0, s = 0;
    do { u = this.next() * 2 - 1; v = this.next() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * mul;
    return u * mul;
  }

  /** true with probability p */
  chance(p) { return this.next() < p; }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
}

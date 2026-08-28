'use strict';

import { GRID_W, GRID_H, spawnFood } from './GameRules.js';

/**
 * Foods — manages up to `count` simultaneous apples on the board (Play mode).
 * Keeps the first `filled` slots of xs/ys as the live apples so respawn,
 * lookup and nearest-food are all O(apples) and allocation-free.
 */
export class Foods {
  constructor(rng = Math.random, count = 1) {
    this.rng = rng;
    this.count = Math.max(1, Math.min(4, count | 0));
    this.xs = new Int16Array(this.count).fill(-1);
    this.ys = new Int16Array(this.count).fill(-1);
    this.filled = 0;
  }

  /** Place `count` apples away from the snake. False when the board is full. */
  respawnAll(isFree) {
    this.filled = 0;
    for (let i = 0; i < this.count; i++) this._addOne(isFree);
    return this.filled === this.count;
  }

  /** Refill one empty slot after an apple is eaten. */
  respawnOne(isFree) {
    if (this.filled >= this.count) return true;
    return this._addOne(isFree);
  }

  _addOne(isFree) {
    const idx = spawnFood(
      () => Math.floor(this.rng() * GRID_W * GRID_H),
      (i) => isFree(i % GRID_W, Math.floor(i / GRID_W)),
    );
    if (idx < 0) return false;
    this.xs[this.filled] = idx % GRID_W;
    this.ys[this.filled] = Math.floor(idx / GRID_W);
    this.filled++;
    return true;
  }

  has(x, y) {
    for (let i = 0; i < this.filled; i++) if (this.xs[i] === x && this.ys[i] === y) return true;
    return false;
  }

  remove(x, y) {
    for (let i = 0; i < this.filled; i++) {
      if (this.xs[i] === x && this.ys[i] === y) {
        this.filled--;
        this.xs[i] = this.xs[this.filled];
        this.ys[i] = this.ys[this.filled];
        this.xs[this.filled] = -1;
        this.ys[this.filled] = -1;
        return true;
      }
    }
    return false;
  }

  /** Nearest apple to (x,y) — the food the network targets. */
  nearest(x, y) {
    if (!this.filled) return { x: -1, y: -1 };
    let bx = this.xs[0], by = this.ys[0], bd = Infinity;
    for (let i = 0; i < this.filled; i++) {
      const d = Math.abs(this.xs[i] - x) + Math.abs(this.ys[i] - y);
      if (d < bd) { bd = d; bx = this.xs[i]; by = this.ys[i]; }
    }
    return { x: bx, y: by };
  }

  get isEmpty() { return this.filled === 0; }
}

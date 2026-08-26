'use strict';

import { GRID_W, GRID_H, spawnFood } from './GameRules.js';

/** Food — single apple position with respawn logic (Play mode). */
export class Food {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.x = 0;
    this.y = 0;
  }

  /** Place at a random cell not occupied by the snake. isFree(x,y) predicate. */
  respawn(isFree) {
    const idx = spawnFood(
      () => Math.floor(this.rng() * GRID_W * GRID_H),
      (i) => isFree(i % GRID_W, Math.floor(i / GRID_W)),
    );
    if (idx < 0) { this.x = -1; this.y = -1; return false; } // board full
    this.x = idx % GRID_W;
    this.y = Math.floor(idx / GRID_W);
    return true;
  }
}

'use strict';

import {
  GRID_W, GRID_H, START_LENGTH,
  DIRS, turnDir, nextCell, isOutside, dirIndexFromVector,
} from './GameRules.js';

/**
 * Snake — Play-mode snake state machine.
 * Uses GameRules primitives so turn/wrap/collision semantics match training exactly.
 */
export class Snake {
  constructor(wrap = false) {
    this.wrap = wrap;
    this.reset();
  }

  reset() {
    this.body = [];
    const cx = Math.floor(GRID_W / 2);
    const cy = Math.floor(GRID_H / 2);
    for (let i = 0; i < START_LENGTH; i++) this.body.push({ x: cx - i, y: cy });
    this.dirIndex = 1; // right
    this.pendingAction = 0; // relative turn queued by input
    this.grewLastStep = false;
  }

  /** Queue an absolute direction (human input). Converted to a relative turn. */
  queueDirection(vec) {
    const want = dirIndexFromVector(vec);
    const rel = ((want - this.dirIndex) % 4 + 4) % 4; // 0 straight, 1 right, 3 left
    this.pendingAction = rel === 3 ? -1 : rel === 1 ? 1 : 0;
  }

  /** Queue a relative action directly (AI replay uses this). */
  queueAction(action) { this.pendingAction = action; }

  /**
   * Advance one tick.
   * isFood(x,y) tells whether the target cell holds food (decides tail semantics).
   * blockedFn(x,y) reports body membership.
   * Returns 'moved' | 'ate' | 'dead'.
   */
  step(isFood, blockedFn) {
    const dirIndex = turnDir(this.dirIndex, this.pendingAction);
    this.pendingAction = 0;
    const { x: hx, y: hy } = this.body[0];
    const { x: nx, y: ny } = nextCell(hx, hy, dirIndex, this.wrap);

    if (!this.wrap && isOutside(nx, ny)) return 'dead';

    const eating = isFood(nx, ny);
    const ignoreTail = !eating; // tail vacates this tick unless we grow
    for (let i = 0; i < this.body.length; i++) {
      if (ignoreTail && i === this.body.length - 1) break;
      const s = this.body[i];
      if (s.x === nx && s.y === ny) return 'dead';
    }

    this.body.unshift({ x: nx, y: ny });
    if (eating) {
      this.grewLastStep = true;
      return 'ate';
    }
    this.body.pop();
    this.grewLastStep = false;
    this.dirIndex = dirIndex;
    return 'moved';
  }

  get head() { return this.body[0]; }
  get length() { return this.body.length; }
  get direction() { return DIRS[this.dirIndex]; }
}

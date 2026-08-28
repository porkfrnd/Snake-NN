'use strict';

import {
  GRID_W, GRID_H, CELL_COUNT, START_LENGTH,
  DIRS, turnDir, nextCell, isOutside, buildObservation, spawnFood,
} from '../game/GameRules.js';
import { INPUT_SIZE as NET_INPUT_SIZE } from '../ai/NetworkConfig.js';

/**
 * SnakeSimulation — headless, DOM-free Snake driven by explicit step() calls.
 * Built on GameRules so movement/collision/food semantics match Play mode exactly.
 *
 * Typed-array state, zero allocation per step:
 *   occ   Uint8Array  — cell occupancy for O(1) collision + food placement
 *   bx/by Int16Array  — ring buffer of body cells (head pointer + length)
 */
export class SnakeSimulation {
  constructor({ wrap = false, maxSteps = 1200, maxStepsWithoutFood = 120, appleCount = 1 } = {}) {
    this.wrap = wrap;
    this.maxSteps = maxSteps;
    this.maxStepsWithoutFood = maxStepsWithoutFood;
    this.appleCount = Math.max(1, Math.min(4, appleCount));
    this.occ = new Uint8Array(CELL_COUNT);
    this.bx = new Int16Array(CELL_COUNT);
    this.by = new Int16Array(CELL_COUNT);
    this.obs = new Float32Array(NET_INPUT_SIZE);
    this.reset();
  }

  reset(seedRng = null) {
    this.occ.fill(0);
    this.length = START_LENGTH;
    const cx = GRID_W >> 1, cy = GRID_H >> 1;
    for (let i = 0; i < START_LENGTH; i++) {
      const x = cx - i, y = cy;
      const slot = START_LENGTH - 1 - i;
      this.bx[slot] = x; this.by[slot] = y;
      this.occ[y * GRID_W + x] = 1;
    }
    this.headPtr = START_LENGTH - 1;
    this.dirIndex = 1; // right
    this.steps = 0;
    this.stepsSinceFood = 0;
    this.foods = 0;
    this.foodIdx = -1;
    this.foodSet = [];      // list of on-board food cell indices (count <= appleCount)
    this._spawnFoods(seedRng);
    return this;
  }

  _spawnFoods(seedRng) {
    const rand = seedRng
      ? () => Math.floor(seedRng.next() * CELL_COUNT)
      : () => (Math.random() * CELL_COUNT) | 0;
    while (this.foodSet.length < this.appleCount) {
      const idx = spawnFood(rand, (i) => this.occ[i] === 0 && !this.foodSet.includes(i));
      if (idx < 0) break;   // board full
      this.foodSet.push(idx);
    }
    this.foodIdx = this._nearestFood();
  }

  _nearestFood() {
    if (this.foodSet.length === 0) return -1;
    const hx = this.headX, hy = this.headY;
    let best = this.foodSet[0], bd = Infinity;
    for (const idx of this.foodSet) {
      const d = Math.abs((idx % GRID_W) - hx) + Math.abs(((idx / GRID_W) | 0) - hy);
      if (d < bd) { bd = d; best = idx; }
    }
    return best;
  }

  get headX() { return this.bx[this.headPtr]; }
  get headY() { return this.by[this.headPtr]; }

  /** One tick. Returns 'moved' | 'ate' | {dead: reason} | 'win'. */
  step(action, seedRng = null) {
    this.dirIndex = turnDir(this.dirIndex, action);
    const { x: nx, y: ny } = nextCell(this.headX, this.headY, this.dirIndex, this.wrap);

    if (!this.wrap && isOutside(nx, ny)) return { dead: 'wall' };

    const cell = ny * GRID_W + nx;
    const eating = this.foodSet.includes(cell);
    const tailPtr = (this.headPtr - this.length + 1 + CELL_COUNT) % CELL_COUNT;
    if (this.occ[cell] === 1 && !(cell === tailPtr && !eating)) return { dead: 'self' };

    this.headPtr = (this.headPtr + 1) % CELL_COUNT;
    this.bx[this.headPtr] = nx;
    this.by[this.headPtr] = ny;
    this.occ[cell] = 1;
    if (!eating) {
      this.occ[this.by[tailPtr] * GRID_W + this.bx[tailPtr]] = 0;
    }
    this.steps++;
    this.stepsSinceFood++;

    if (eating) {
      this.length++;
      this.foods++;
      this.stepsSinceFood = 0;
      this.foodSet = this.foodSet.filter((i) => i !== cell);
      this._spawnFoods(seedRng);
      if (this.foodSet.length === 0) return 'win';
      return 'ate';
    }

    if (this.stepsSinceFood >= this.maxStepsWithoutFood) return { dead: 'starve' };
    if (this.steps >= this.maxSteps) return { dead: 'cap' };
    return 'moved';
  }

  /** Build the shared 18-input observation targeting the NEAREST food. */
  observation() {
    this.foodIdx = this._nearestFood();
    const tailSlot = (this.headPtr - this.length + 1 + CELL_COUNT) % CELL_COUNT;
    const fi = this.foodIdx;
    return buildObservation(
      this.obs, this.headX, this.headY, this.dirIndex,
      fi < 0 ? this.headX : fi % GRID_W, fi < 0 ? this.headY : Math.floor(fi / GRID_W),
      this.length, this.wrap,
      { occ: this.occ, tailIdx: this.bx[tailSlot] + this.by[tailSlot] * GRID_W, foodIdx: fi },
    );
  }
}

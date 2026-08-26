'use strict';

/**
 * GameRules — THE one authority for grid geometry, turn semantics and observation.
 * Imported by Play mode (Snake/GameEngine) AND the headless SnakeSimulation,
 * so the rules can never drift apart. Pure functions only — no DOM, no state.
 *
 * Direction indexing (used everywhere):
 *   0 = up (0,-1)   1 = right (1,0)   2 = down (0,1)   3 = left (-1,0)
 * A "left turn"  maps d -> (d+3)%4, a "right turn" maps d -> (d+1)%4.
 * The network outputs relative turns, so instant reversal is impossible by construction.
 */

export const GRID_W = 20;
export const GRID_H = 20;
export const CELL_COUNT = GRID_W * GRID_H;

export const INITIAL_SPEED_MS = 130;
export const MIN_SPEED_MS = 48;
export const SPEED_STEP_MS = 2.6;   // ms shaved off per food eaten
export const SCORE_PER_FOOD = 10;
export const LEVEL_EVERY = 50;      // points per level
export const START_LENGTH = 4;

export const DIRS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);

/** Apply a relative action (-1 left, 0 straight, +1 right) to a direction index. */
export function turnDir(dirIndex, action) {
  if (action < 0) return (dirIndex + 3) % 4;
  if (action > 0) return (dirIndex + 1) % 4;
  return dirIndex;
}

/** Convert a direction vector to its index (falls back to 1/right for {0,0}). */
export function dirIndexFromVector(v) {
  if (v.x === 0 && v.y === -1) return 0;
  if (v.x === 1 && v.y === 0) return 1;
  if (v.x === 0 && v.y === 1) return 2;
  if (v.x === -1 && v.y === 0) return 3;
  return 1;
}

export function isOutside(x, y) {
  return x < 0 || y < 0 || x >= GRID_W || y >= GRID_H;
}

/** Next cell from (x,y) heading dirIndex; wraps when wrap=true. */
export function nextCell(x, y, dirIndex, wrap) {
  const d = DIRS[dirIndex];
  let nx = x + d.x;
  let ny = y + d.y;
  if (wrap) {
    nx = (nx + GRID_W) % GRID_W;
    ny = (ny + GRID_H) % GRID_H;
  }
  return { x: nx, y: ny };
}

/** True if the cell is a wall or body (blockedFn decides "body"). */
export function isBlocked(x, y, wrap, blockedFn) {
  if (!wrap && isOutside(x, y)) return true;
  if (wrap) { /* no walls when wrapping */ }
  else if (isOutside(x, y)) return true;
  return blockedFn(x, y);
}

/**
 * Build the 8-input observation vector into `out` (Float32Array length 8).
 * Shared by the headless simulation and champion replay so the network always
 * sees exactly the same world representation.
 *
 *  0 foodForward  [-1,1]  dot(food-head, forward)/span
 *  1 foodLeft     [-1,1]  dot(food-head, left)/span
 *  2 dangerAhead  {0,1}   wall or body straight ahead
 *  3 dangerLeft   {0,1}
 *  4 dangerRight  {0,1}
 *  5 foodDist     [0,1]   manhattan distance to food, normalized
 *  6 wallAhead    [0,1]   1 - (free cells ahead / span); 1.0 when wrapping (no walls)
 *  7 lengthNorm   [0,1]   snake length / CELL_COUNT
 */
export function buildObservation(out, headX, headY, dirIndex, foodX, foodY, length, wrap, blockedFn) {
  const span = Math.max(GRID_W, GRID_H);
  const fwd = DIRS[dirIndex];
  const left = DIRS[(dirIndex + 3) % 4];
  const right = DIRS[(dirIndex + 1) % 4];

  const fdx = foodX - headX;
  const fdy = foodY - headY;
  out[0] = (fdx * fwd.x + fdy * fwd.y) / span;
  out[1] = (fdx * left.x + fdy * left.y) / span;

  const probe = (d) => {
    const nx = headX + d.x, ny = headY + d.y;
    if (!wrap && isOutside(nx, ny)) return 1;
    return blockedFn(nx, ny) ? 1 : 0;
  };
  out[2] = probe(fwd);
  out[3] = probe(left);
  out[4] = probe(right);

  out[5] = (Math.abs(fdx) + Math.abs(fdy)) / (GRID_W + GRID_H);

  let free = 0;
  if (wrap) {
    out[6] = 1; // no walls in wrap mode
  } else {
    let cx = headX, cy = headY;
    while (!isOutside(cx + fwd.x, cy + fwd.y)) { free++; cx += fwd.x; cy += fwd.y; }
    out[6] = 1 - free / span;
  }

  out[7] = length / CELL_COUNT;
  return out;
}

/**
 * Spawn food: pick a free index via `randIndex` attempts, then linear fallback.
 * `isFree(idx)` must be an O(1) predicate over cell indices (y*GRID_W+x).
 * Returns the chosen index, or -1 if the board is full (win condition).
 */
export function spawnFood(randIndex, isFree) {
  for (let t = 0; t < 60; t++) {
    const idx = randIndex();
    if (isFree(idx)) return idx;
  }
  for (let idx = 0; idx < CELL_COUNT; idx++) if (isFree(idx)) return idx;
  return -1;
}

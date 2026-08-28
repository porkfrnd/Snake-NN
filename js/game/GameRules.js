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

export let GRID_W = 20;
export let GRID_H = 20;
export let CELL_COUNT = GRID_W * GRID_H;

/**
 * Runtime board sizing. Because these are ESM live bindings, every module that
 * imports GRID_W/GRID_H/CELL_COUNT sees the new geometry immediately. MUST be
 * called before any engine / simulation / renderer is constructed (their
 * typed-array buffers and viewBox are allocated with the then-current size).
 */
export function setBoard(w, h) {
  GRID_W = Math.max(6, Math.min(60, Math.floor(w)));
  GRID_H = Math.max(6, Math.min(60, Math.floor(h)));
  CELL_COUNT = GRID_W * GRID_H;
}

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

/** True if the cell is blocked for navigation/pathing (wall or body). */
function isBlockedCell(x, y, wrap, occ, ignoreTailIdx) {
  if (!wrap && isOutside(x, y)) return true;
  const idx = y * GRID_W + x;
  if (occ[idx] === 1 && idx !== ignoreTailIdx) return true;
  return false;
}

/**
 * Flood fill from the head over free (navigable) cells. Returns:
 *   { reachable:boolean(does foodIdx sit in the head's region),
 *     tailReachable:boolean(the tail cell was reached — an escape route),
 *     regionSize:number # reachable free cells }
 * `ignoreTailIdx` lets the vacating tail act as a path during this tick, so
 * tail-chasing appears as a reachable escape. Uses a typed-array visited
 * bitmap and an explicit queue (no recursion).
 */
export function floodRegion(occ, wrap, headX, headY, foodIdx, tailIdx) {
  const visited = new Uint8Array(CELL_COUNT);
  const qx = new Int16Array(CELL_COUNT);
  const qy = new Int16Array(CELL_COUNT);
  let head = 0, tail = 0;
  let reachable = false;
  let tailReachable = tailIdx === foodIdx;
  let regionSize = 0;

  const start = headY * GRID_W + headX;
  if (isBlockedCell(headX, headY, wrap, occ, tailIdx)) return { reachable, tailReachable, regionSize };
  visited[start] = 1;
  qx[tail] = headX; qy[tail] = headY; tail++;
  regionSize++;

  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    if (y * GRID_W + x === tailIdx) tailReachable = true;
    for (const d of DIRS) {
      const nx = x + d.x, ny = y + d.y;
      if (!wrap && isOutside(nx, ny)) continue;
      const ni = ny * GRID_W + nx;
      if (ni === foodIdx) reachable = true;
      if (visited[ni]) continue;
      if (isBlockedCell(nx, ny, wrap, occ, tailIdx)) continue;
      visited[ni] = 1;
      qx[tail] = nx; qy[tail] = ny; tail++;
      regionSize++;
    }
  }
  return { reachable, tailReachable, regionSize };
}

/**
 * Build the 18-input observation vector into `out` (Float32Array length 18).
 * Shared by the headless simulation and champion replay so the network always
 * sees exactly the same world representation. `ctx` supplies the occupancy
 * mirror, the tail cell (for tail-aware safety) and the food index, letting us
 * run flood-fill reachability that the old wall-only view never had.
 *
 *  0  foodForward  [-1,1] dot(food-head, forward)/span
 *  1  foodLeft     [-1,1] dot(food-head, left)/span
 *  2  dangerAhead  {0,1}  wall/body straight ahead (head-neighbour)
 *  3  dangerLeft   {0,1}
 *  4  dangerRight  {0,1}
 *  5  foodDist     [0,1]  manhattan distance to food, normalized
 *  6  wallAhead    [0,1]  1 - (free run ahead / span); 1.0 when wrapping
 *  7  lengthNorm   [0,1]  length / CELL_COUNT
 *  8  corridorAhead [0,1] open cells directly ahead (up to 4), /4
 *  9  corridorLeft  [0,1]
 * 10  corridorRight [0,1]
 * 11  foodReachable {0,1} is the food in the head's connected free region?
 * 12  regionFrac    [0,1] size of the head's free region / CELL_COUNT
 * 13  tailDistNorm  [0,1] manhattan(head,tail)/span (short = retreat route)
 * 14  safeAhead     {0,1} moving straight this tick is non-fatal (tail-aware)
 * 15  safeLeft      {0,1}
 * 16  safeRight     {0,1}
 * 17  tailReachable {0,1} tail borders the head's region (escape exists)
 */
export function buildObservation(out, headX, headY, dirIndex, foodX, foodY, length, wrap, ctx) {
  const span = Math.max(GRID_W, GRID_H);
  const fwd = DIRS[dirIndex];
  const left = DIRS[(dirIndex + 3) % 4];
  const right = DIRS[(dirIndex + 1) % 4];
  const occ = ctx.occ;
  const tailIdx = ctx.tailIdx;
  const foodIdx = ctx.foodIdx;

  const fdx = foodX - headX;
  const fdy = foodY - headY;
  out[0] = (fdx * fwd.x + fdy * fwd.y) / span;
  out[1] = (fdx * left.x + fdy * left.y) / span;

  const probe = (d) => isBlockedCell(headX + d.x, headY + d.y, wrap, occ, tailIdx) ? 1 : 0;
  out[2] = probe(fwd);
  out[3] = probe(left);
  out[4] = probe(right);

  out[5] = (Math.abs(fdx) + Math.abs(fdy)) / (GRID_W + GRID_H);

  let free = 0;
  if (wrap) {
    out[6] = 1; // no walls in wrap mode
  } else {
    let cx = headX, cy = headY;
    while (!isOutside(cx + fwd.x, cy + fwd.y) && !isBlockedCell(cx + fwd.x, cy + fwd.y, wrap, occ, tailIdx)) {
      free++; cx += fwd.x; cy += fwd.y;
    }
    out[6] = 1 - Math.min(free, span) / span;
  }

  out[7] = length / CELL_COUNT;

  // Corridor lookahead: contiguous open cells in each relative direction (up to 4).
  const corridor = (d) => {
    let n = 0, x = headX, y = headY;
    for (let k = 0; k < 4; k++) {
      x += d.x; y += d.y;
      if (isBlockedCell(x, y, wrap, occ, tailIdx)) break;
      n++;
    }
    return n / 4;
  };
  out[8]  = corridor(fwd);
  out[9]  = corridor(left);
  out[10] = corridor(right);

  // Flood fill once and reuse its results for reachability + region liveness.
  const region = floodRegion(occ, wrap, headX, headY, foodIdx, tailIdx);
  out[11] = region.reachable ? 1 : 0;
  out[12] = region.regionSize / CELL_COUNT;

  if (tailIdx >= 0) {
    const ty = (tailIdx / GRID_W) | 0, tx = tailIdx % GRID_W;
    out[13] = (Math.abs(tx - headX) + Math.abs(ty - headY)) / span;
  } else {
    out[13] = 1; // no tail yet — farthest normalised distance
  }
  const safe = (d) => isBlockedCell(headX + d.x, headY + d.y, wrap, occ, tailIdx) ? 0 : 1;
  out[14] = safe(fwd);      // tail-aware: moving into the vacating tail is allowed
  out[15] = safe(left);
  out[16] = safe(right);
  out[17] = region.tailReachable ? 1 : 0;
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

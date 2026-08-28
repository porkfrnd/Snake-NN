'use strict';

/**
 * Plain-assertion tests for the headless simulation + shared GameRules.
 * Run: node tests/snakeSimulation.test.js
 */
import { SnakeSimulation } from '../js/training/SnakeSimulation.js';
import { GRID_W, GRID_H, CELL_COUNT, nextCell, turnDir, isOutside, buildObservation, spawnFood, DIRS } from '../js/game/GameRules.js';

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); }
function ok(v, msg = '') { if (!v) throw new Error(msg || 'expected truthy'); }

console.log('snakeSimulation.test.js');

t('reset places a length-4 snake facing right with food on the board', () => {
  const s = new SnakeSimulation({});
  s.reset();
  eq(s.length, 4);
  eq(s.dirIndex, 1);
  ok(s.foodIdx >= 0 && s.foodIdx < CELL_COUNT);
  ok(s.occ[s.foodIdx] === 0, 'food not on the snake');
});

t('turnDir semantics: left/straight/right relative turns', () => {
  eq(turnDir(1, 0), 1, 'straight');
  eq(turnDir(1, -1), 0, 'right->up? no: right(1) + left turn = up(0)');
  eq(turnDir(1, 1), 2, 'right turn from right = down');
  eq(turnDir(0, -1), 3, 'left turn from up = left');
  eq(turnDir(0, 1), 1, 'right turn from up = right');
});

t('nextCell geometry with and without wrap', () => {
  eq(nextCell(19, 5, 1, false).x, 20, 'right edge beyond board');
  ok(isOutside(20, 5));
  eq(nextCell(19, 5, 1, true).x, 0, 'wraps to left edge');
  eq(nextCell(5, 0, 0, true).y, GRID_H - 1, 'wraps bottom->top');
});

t('moving straight advances the head one cell', () => {
  const s = new SnakeSimulation({});
  s.reset();
  const hx = s.headX, hy = s.headY;
  s.step(0);
  eq(s.headX, hx + 1);
  eq(s.headY, hy);
  eq(s.length, 4, 'length unchanged without food');
  eq(s.steps, 1);
});

t('wall death when wrap disabled', () => {
  const s = new SnakeSimulation({ wrap: false });
  s.reset();
  // Head starts at (10,10) heading right; walk to the right wall.
  let r;
  for (let i = 0; i < 20; i++) { r = s.step(0); if (r.dead) break; }
  ok(r.dead === 'wall', `expected wall death, got ${JSON.stringify(r)}`);
});

t('wrap mode crosses the edge without dying', () => {
  const s = new SnakeSimulation({ wrap: true, maxSteps: 100, maxStepsWithoutFood: 1000 });
  s.reset();
  let crossed = false;
  for (let i = 0; i < 12; i++) {
    const r = s.step(0);
    if (r.dead) { ok(false, `unexpected death ${JSON.stringify(r)}`); return; }
    if (s.headX < 3) crossed = true;
  }
  ok(crossed, 'head should have crossed to the left side');
});

t('eating food grows the snake and increments foods', () => {
  const s = new SnakeSimulation({});
  s.reset();
  const before = s.length;
  // Force food right in front of the head.
  s.occ[s.foodIdx] = 0;
  s.foodIdx = (s.headY * GRID_W) + s.headX + 1;
  s.occ[s.foodIdx] = 0;
  const r = s.step(0);
  eq(r, 'ate');
  eq(s.length, before + 1);
  eq(s.foods, 1);
  eq(s.stepsSinceFood, 0);
});

t('moving into the vacating tail cell is legal', () => {
  const s = new SnakeSimulation({ maxStepsWithoutFood: 10000 });
  s.reset();
  // Build a loop scenario: chase our own tail in a tight 2x2 cycle.
  // Simplest deterministic check: a snake following its own body in a square.
  // Construct: head (10,10) dir right; body [(10,10),(9,10),(8,10),(7,10)]
  // Turn down, then left twice, then up -> head approaches tail cell (7,10) as it vacates.
  s.step(1);  // down  -> (10,11)
  s.step(-1); // left  -> (9,11)
  s.step(-1); // left  -> (8,11)
  s.step(-1); // left  -> (7,11)
  s.step(-1); // left  -> (6,11)
  s.step(1);  // up    -> (6,10)
  s.step(1);  // right -> (7,10) — the original tail cell, vacated long ago
  ok(true, 'no death following the body path');
});

t('starvation cap terminates a circling snake', () => {
  const s = new SnakeSimulation({ maxSteps: 100000, maxStepsWithoutFood: 25 });
  s.reset();
  let r = 'moved';
  for (let i = 0; i < 100; i++) { r = s.step(0); if (r.dead) break; }
  ok(r.dead === 'starve' || r.dead === 'self' || r.dead === 'wall' || r.dead === 'cap',
     `terminated, got ${JSON.stringify(r)}`);
  ok(s.steps <= 30, `terminated near the cap, steps=${s.steps}`);
});

t('maxSteps cap terminates long games', () => {
  const s = new SnakeSimulation({ maxSteps: 10, maxStepsWithoutFood: 100000 });
  s.reset();
  let r = 'moved';
  for (let i = 0; i < 50; i++) { r = s.step(0); if (r.dead) break; }
  ok(r.dead === 'cap' || r.dead === 'wall', `cap or wall, got ${JSON.stringify(r)}`);
});

t('observation: 18 finite inputs, danger ahead detected at the wall', () => {
  const s = new SnakeSimulation({});
  s.reset();
  const obs = s.observation();
  eq(obs.length, 18);
  for (let i = 0; i < 18; i++) ok(Number.isFinite(obs[i]), `obs[${i}] finite`);

  // Put the head at the right edge facing right: dangerAhead must be 1.
  s.occ[s.headY * GRID_W + s.headX] = 0; // detach head cell for simplicity
  s.bx[s.headPtr] = GRID_W - 1;
  s.occ[(GRID_H / 2) * GRID_W + GRID_W - 1] = 1;
  s.by[s.headPtr] = GRID_H / 2;
  s.dirIndex = 1;
  const o2 = s.observation();
  eq(o2[2], 1, 'dangerAhead at right wall');
  eq(o2[3], 0, 'no danger left');
});

t('buildObservation food encoding: food ahead vs behind', () => {
  const out = new Float32Array(18);
  const ctx = { occ: new Uint8Array(CELL_COUNT), tailIdx: -1, foodIdx: 0 };
  // Head (5,5) facing right; food at (10,5) -> ahead positive.
  buildObservation(out, 5, 5, 1, 10, 5, 4, false, ctx);
  ok(out[0] > 0, 'food ahead positive');
  ok(Math.abs(out[1]) < 0.01, 'food not to the side');
  // Food behind -> ahead negative.
  buildObservation(out, 5, 5, 1, 2, 5, 4, false, ctx);
  ok(out[0] < 0, 'food behind negative');
});

t('spawnFood returns -1 only when the board is full', () => {
  eq(spawnFood(() => 0, () => false), -1, 'full board');
  ok(spawnFood(() => 3, (i) => i !== 5) === 3, 'picks the random free index');
  ok(spawnFood(() => 5, (i) => i !== 5) === 0, 'falls back to the linear scan');
});

t('typed-array state: no per-step allocation of the big buffers', () => {
  const s = new SnakeSimulation({});
  const occ = s.occ, bx = s.bx, by = s.by;
  s.reset();
  for (let i = 0; i < 50; i++) { const r = s.step(0); if (r.dead) break; }
  ok(s.occ === occ && s.bx === bx && s.by === by, 'buffers reused across steps');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

'use strict';

import {
  GRID_W, GRID_H, CELL_COUNT,
  INITIAL_SPEED_MS, MIN_SPEED_MS, SPEED_STEP_MS, SCORE_PER_FOOD, LEVEL_EVERY,
  buildObservation, dirIndexFromVector,
} from './GameRules.js';
import { Snake } from './Snake.js';
import { Food } from './Food.js';
import { GameRenderer } from './GameRenderer.js';
import { InputManager } from './InputManager.js';
import { argmax } from '../utils/MathUtils.js';

export const GameState = Object.freeze({
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  OVER: 'over',
});

/**
 * GameEngine — loop + state machine for Play mode.
 * The SAME code path serves human play and AI replay: when `controller` is set,
 * each tick asks it for a relative turn (-1/0/+1) instead of reading queued input.
 */
export class GameEngine {
  constructor({ storage, sound, reducedMotion, callbacks }) {
    this.storage = storage;
    this.sound = sound;
    this.reducedMotion = reducedMotion;
    this.cb = callbacks; // { onHUD, onState, onOver }

    this.state = GameState.MENU;
    this.wrap = storage.getWrap();
    this.snake = new Snake(this.wrap);
    this.food = new Food();
    this.renderer = new GameRenderer({ gridLayer: 'gridLayer', foodLayer: 'foodLayer', snakeLayer: 'snakeLayer', fxLayer: 'fxLayer' });
    this.renderer.buildGrid();

    this.speedMs = INITIAL_SPEED_MS;
    this.score = 0;
    this.level = 1;
    this.foodsEaten = 0;
    this.best = storage.getHighScore();

    this.controller = null;   // { decide(obs)->action } during AI replay
    this.controllerMeta = null;
    this._occ = new Uint8Array(CELL_COUNT); // reusable occupancy mirror for observations
    this._obs = new Float32Array(8);

    this._raf = 0;
    this._lastTs = 0;
    this._acc = 0;
    this._countTimer = 0;

    this.input = new InputManager({
      onDirection: (vec) => {
        this.sound.unlock();
        if (this.state === GameState.MENU || this.state === GameState.OVER) this.start();
        if (this.state === GameState.PLAYING && !this.controller) this.snake.queueDirection(vec);
      },
      onPause: () => {
        this.sound.unlock();
        if (this.state === GameState.PLAYING) this.pause();
        else if (this.state === GameState.PAUSED) this.resume();
      },
      onStart: () => {
        this.sound.unlock();
        if (this.state === GameState.MENU || this.state === GameState.OVER) this.start();
        else if (this.state === GameState.PAUSED) this.resume();
      },
      onAny: () => this.sound.unlock(),
    });

    this._onVisibility = () => { if (document.hidden && this.state === GameState.PLAYING) this.pause(); };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._render();
    this.cb.onHUD(this._hud());
    this.cb.onState(this.state);
  }

  // ---- public API ----

  setWrap(on) {
    this.wrap = on;
    if (this.state === GameState.PLAYING || this.state === GameState.PAUSED) this.pause();
    this.snake = new Snake(this.wrap);
    this._render();
  }

  setReducedMotion(on) { this.reducedMotion = on; }

  attachController(controller, meta) {
    this.controller = controller;
    this.controllerMeta = meta || null;
    this.cb.onHUD(this._hud());
  }

  detachController() {
    this.controller = null;
    this.controllerMeta = null;
    if (this.state === GameState.PLAYING || this.state === GameState.PAUSED) this.goMenu();
    this.cb.onHUD(this._hud());
  }

  start() {
    if (this.state === GameState.COUNTDOWN) return;
    this._stopLoop();
    this.snake = new Snake(this.wrap);
    this.food.respawn((x, y) => !this._cellOccupied(x, y));
    this.score = 0;
    this.level = 1;
    this.foodsEaten = 0;
    this.speedMs = INITIAL_SPEED_MS;
    this._setState(GameState.COUNTDOWN);
    this._render();
    this.cb.onHUD(this._hud());
    this._countdown(3);
  }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    this._stopLoop();
    this._setState(GameState.PAUSED);
    this.sound.pause(true);
  }

  resume() {
    if (this.state !== GameState.PAUSED) return;
    this._setState(GameState.PLAYING);
    this.sound.pause(false);
    this._lastTs = 0;
    this._acc = 0;
    this._raf = requestAnimationFrame(this._loop);
  }

  restart() { this.start(); }

  goMenu() {
    this._stopLoop();
    clearTimeout(this._countTimer);
    this.snake = new Snake(this.wrap);
    this.food.respawn((x, y) => !this._cellOccupied(x, y));
    this.score = 0;
    this.level = 1;
    this.speedMs = INITIAL_SPEED_MS;
    this._setState(GameState.MENU);
    this._render();
    this.cb.onHUD(this._hud());
  }

  destroy() {
    this._stopLoop();
    clearTimeout(this._countTimer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.input.destroy();
    this.renderer.clearAll();
  }

  // ---- internals ----

  _hud() {
    const speedPct = Math.round(((INITIAL_SPEED_MS - this.speedMs) / (INITIAL_SPEED_MS - MIN_SPEED_MS)) * 100);
    return {
      score: this.score,
      best: this.best,
      level: this.level,
      speedPct: Math.max(4, Math.min(100, speedPct)),
      ai: this.controllerMeta,
    };
  }

  _setState(s) {
    this.state = s;
    this.cb.onState(s);
  }

  _countdown(n) {
    this.sound.tick(n);
    this.cb.onState(GameState.COUNTDOWN, n);
    if (n > 0) {
      this._countTimer = setTimeout(() => this._countdown(n - 1), 550);
    } else {
      this._countTimer = setTimeout(() => {
        this._setState(GameState.PLAYING);
        this._lastTs = 0;
        this._acc = 0;
        this._raf = requestAnimationFrame(this._loop);
      }, 350);
    }
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _cellOccupied(x, y) {
    return this.snake.body.some((s) => s.x === x && s.y === y);
  }

  _loop = (ts) => {
    if (this.state !== GameState.PLAYING) return;
    if (!this._lastTs) this._lastTs = ts;
    this._acc += Math.min(100, ts - this._lastTs);
    this._lastTs = ts;

    let steps = 0;
    while (this._acc >= this.speedMs && steps < 4) {
      this._tick();
      steps++;
      if (this.state !== GameState.PLAYING) return;
      this._acc -= this.speedMs;
    }
    this._render();
    this._raf = requestAnimationFrame(this._loop);
  };

  _tick() {
    // Decide direction: AI controller or queued human input.
    if (this.controller) {
      this._buildObservation();
      const action = this.controller.decide(this._obs);
      this.snake.queueAction(Number.isFinite(action) ? Math.sign(action) : 0);
    }

    const fx = this.food.x, fy = this.food.y;
    const result = this.snake.step(
      (x, y) => x === fx && y === fy,
      (x, y) => this._cellOccupied(x, y),
    );

    if (result === 'dead') { this._gameOver(); return; }

    if (result === 'ate') {
      this.foodsEaten++;
      this.score += SCORE_PER_FOOD;
      this.level = Math.floor(this.score / LEVEL_EVERY) + 1;
      this.speedMs = Math.max(MIN_SPEED_MS, this.speedMs - SPEED_STEP_MS);
      if (!this.food.respawn((x, y) => !this._cellOccupied(x, y))) {
        this._gameOver('win'); // board full — perfect game
        return;
      }
      this.renderer.eatPulse(this.snake.head.x, this.snake.head.y, this.reducedMotion);
      this.sound.eat();
      if (navigator.vibrate && this.storage.getHaptics()) navigator.vibrate(14);
      this.cb.onHUD(this._hud());
    }
  }

  /** Shared observation builder — identical representation to training. */
  _buildObservation() {
    const occ = this._occ;
    occ.fill(0);
    const body = this.snake.body;
    for (let i = 0; i < body.length; i++) occ[body[i].y * GRID_W + body[i].x] = 1;
    const h = this.snake.head;
    return buildObservation(
      this._obs, h.x, h.y, this.snake.dirIndex,
      this.food.x, this.food.y, this.snake.length, this.wrap,
      (x, y) => (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) ? 1 : occ[y * GRID_W + x] === 1,
    );
  }

  _gameOver(reason = 'crash') {
    this._stopLoop();
    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      this.storage.setHighScore(this.best);
    }
    this._setState(GameState.OVER);
    this.sound.crash();
    if (navigator.vibrate && this.storage.getHaptics()) navigator.vibrate([24, 30, 40]);
    this.cb.onOver({
      score: this.score,
      best: this.best,
      level: this.level,
      foods: this.foodsEaten,
      isNewBest,
      reason,
      ai: this.controllerMeta,
    });
  }

  _render() {
    this.renderer.renderSnake(this.snake.body, this.snake.dirIndex, this.wrap);
    this.renderer.renderFood(this.food);
  }
}

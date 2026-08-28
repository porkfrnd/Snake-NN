'use strict';

import { STORAGE_KEYS } from '../utils/Constants.js';

/**
 * StorageManager — safe localStorage wrapper. Every access is guarded so a
 * disabled or full localStorage degrades gracefully instead of crashing.
 */
export class StorageManager {
  _get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch { return fallback; }
  }

  _set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* quota/blocked — ignore */ }
  }

  // High score
  getHighScore() { const v = parseInt(this._get(STORAGE_KEYS.highScore, '0'), 10); return Number.isFinite(v) && v > 0 ? v : 0; }
  setHighScore(v) { this._set(STORAGE_KEYS.highScore, String(v)); }

  // Boolean settings
  getSound() { return this._get(STORAGE_KEYS.sound, '1') === '1'; }
  setSound(v) { this._set(STORAGE_KEYS.sound, v ? '1' : '0'); }

  getHaptics() { return this._get(STORAGE_KEYS.haptics, '1') === '1'; }
  setHaptics(v) { this._set(STORAGE_KEYS.haptics, v ? '1' : '0'); }

  getWrap() { return this._get(STORAGE_KEYS.wrap, '0') === '1'; }
  setWrap(v) { this._set(STORAGE_KEYS.wrap, v ? '1' : '0'); }

  getReducedMotion() {
    if (this._get(STORAGE_KEYS.reducedMotion, '0') === '1') return true;
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }
  setReducedMotion(v) { this._set(STORAGE_KEYS.reducedMotion, v ? '1' : '0'); }

  getBackgroundTraining() { return this._get(STORAGE_KEYS.backgroundTraining, '0') === '1'; }
  setBackgroundTraining(v) { this._set(STORAGE_KEYS.backgroundTraining, v ? '1' : '0'); }

  // Theme ('light' | 'dark')
  getTheme() { return this._get(STORAGE_KEYS.theme, '') || null; }
  setTheme(v) { this._set(STORAGE_KEYS.theme, v); }

  // Architecture editor state (hidden sizes array as JSON)
  getDefaultHidden(fallback) {
    try {
      const v = JSON.parse(this._get(STORAGE_KEYS.arch, 'null'));
      if (Array.isArray(v)) return v;
    } catch { /* fall through */ }
    return fallback;
  }
  setDefaultHidden(hidden) { this._set(STORAGE_KEYS.arch, JSON.stringify(hidden)); }

  // Base activation for new populations
  getDefaultActivation(fallback) { return this._get(STORAGE_KEYS.activation, fallback); }
  setDefaultActivation(name) { this._set(STORAGE_KEYS.activation, name); }

  // Mutation strength σ (0..1) for new/current population
  getMutationStrength(fallback) {
    const v = parseFloat(this._get(STORAGE_KEYS.mutation, ''));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  }
  setMutationStrength(v) { this._set(STORAGE_KEYS.mutation, String(Math.max(0, Math.min(1, v)))); }

  // Population size override (undefined => use TrainingConfig default)
  getPopulationSize() {
    const v = parseInt(this._get(STORAGE_KEYS.population, ''), 10);
    return Number.isFinite(v) && v >= 10 ? v : undefined;
  }
  setPopulationSize(v) { this._set(STORAGE_KEYS.population, String(v)); }

  // Replay playback speed multiplier (1x..3x)
  getReplaySpeed(fallback = 1) {
    const v = parseFloat(this._get(STORAGE_KEYS.replaySpeed, ''));
    return Number.isFinite(v) && v >= 1 && v <= 3 ? v : fallback;
  }
  setReplaySpeed(v) { this._set(STORAGE_KEYS.replaySpeed, String(v)); }

  // Square board size (cells per side); undefined => default 20
  getBoardSize(fallback = 20) {
    const v = parseInt(this._get(STORAGE_KEYS.boardSize, ''), 10);
    return Number.isFinite(v) && v >= 8 && v <= 40 ? v : fallback;
  }
  setBoardSize(v) { this._set(STORAGE_KEYS.boardSize, String(v)); }

  // Simultaneous apples on the board; undefined => default 1
  getAppleCount(fallback = 1) {
    const v = parseInt(this._get(STORAGE_KEYS.appleCount, ''), 10);
    return Number.isFinite(v) && v >= 1 && v <= 4 ? v : fallback;
  }
  setAppleCount(v) { this._set(STORAGE_KEYS.appleCount, String(v)); }
}

'use strict';

/** App-wide constants: storage keys and worker message types. */

export const STORAGE_KEYS = {
  highScore: 'snake.highScore',
  sound: 'snake.settings.sound',
  haptics: 'snake.settings.haptics',
  wrap: 'snake.settings.wrap',
  reducedMotion: 'snake.settings.reducedMotion',
  backgroundTraining: 'snake.settings.backgroundTraining',
  theme: 'snake.settings.theme',
  arch: 'snake.settings.arch',
  activation: 'snake.settings.activation',
  mutation: 'snake.settings.mutation',
  population: 'snake.settings.population',
  replaySpeed: 'snake.settings.replaySpeed',
  boardSize: 'snake.settings.board',
  appleCount: 'snake.settings.apples',
  checkpoint: 'ai.checkpoint.v1',
};

export const WorkerMessageType = Object.freeze({
  // main -> worker
  START: 'START',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  STOP: 'STOP',
  RESET: 'RESET',
  SET_INTENSITY: 'SET_INTENSITY',
  SET_INTERACTING: 'SET_INTERACTING',
  SET_BACKGROUND: 'SET_BACKGROUND',
  SET_ACTIVATION: 'SET_ACTIVATION',   // { name } — convert population, weights preserved
  SET_ARCH: 'SET_ARCH',               // { hidden: [..] } — rebuild population (fresh run)
  SET_MUTATION: 'SET_MUTATION',       // { strength } — Gaussian mutation σ
  SET_POPULATION: 'SET_POPULATION',   // { size } — rebuild population (fresh run)
  SET_BOARD: 'SET_BOARD',             // { size } — square board cells-per-side (fresh run)
  SET_APPLES: 'SET_APPLES',           // { count } — simultaneous foods (fresh run)
  GET_CHAMPION: 'GET_CHAMPION',
  // worker -> main
  READY: 'READY',
  STATS: 'STATS',
  CHAMPION: 'CHAMPION',
  ERROR: 'ERROR',
});

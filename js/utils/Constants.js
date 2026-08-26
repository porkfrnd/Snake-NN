'use strict';

/** App-wide constants: storage keys and worker message types. */

export const STORAGE_KEYS = {
  highScore: 'snake.highScore',
  sound: 'snake.settings.sound',
  haptics: 'snake.settings.haptics',
  wrap: 'snake.settings.wrap',
  reducedMotion: 'snake.settings.reducedMotion',
  backgroundTraining: 'snake.settings.backgroundTraining',
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
  GET_CHAMPION: 'GET_CHAMPION',
  // worker -> main
  READY: 'READY',
  STATS: 'STATS',
  CHAMPION: 'CHAMPION',
  ERROR: 'ERROR',
});

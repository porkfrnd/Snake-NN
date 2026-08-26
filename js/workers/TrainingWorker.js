'use strict';

/**
 * TrainingWorker — owns the ENTIRE training loop: population, simulation,
 * inference, fitness, evolution. The main thread only sends commands and
 * renders stats. Batched evaluation with setTimeout yields keeps this worker
 * responsive to PAUSE/STOP messages at every intensity level.
 */

import { EvolutionEngine } from '../training/EvolutionEngine.js';
import { FitnessEvaluator } from '../training/FitnessEvaluator.js';
import { TrainingConfig, resolveIntensity } from '../training/TrainingConfig.js';
import { WorkerMessageType as MSG } from '../utils/Constants.js';
import { Random } from '../utils/Random.js';

let engine = null;
let evaluator = null;
let cfg = null;
let timer = 0;
let running = false;
let paused = false;
let interacting = false;
let cursor = 0;                 // next population index to evaluate
let intensity = resolveIntensity('normal');
let lastChampionPost = -1;
let windowStart = 0, windowGames = 0, windowSteps = 0;
let validationSeeds = [];

function post(type, data = {}, transfer = []) {
  self.postMessage({ type, ...data }, transfer);
}

function init() {
  cfg = { ...TrainingConfig };
  engine = new EvolutionEngine(cfg, (Math.random() * 0xffffffff) >>> 0);
  evaluator = new FitnessEvaluator(cfg);
  validationSeeds = Array.from({ length: cfg.validationSeeds }, () => (Math.random() * 0xffffffff) >>> 0);
  cursor = 0;
  windowStart = performance.now();
  windowGames = 0;
  windowSteps = 0;
  lastChampionPost = -1;
  post(MSG.READY, {
    populationSize: cfg.populationSize,
    parameterCount: engine.population.nets[0].parameterCount,
  });
}

function workTick() {
  if (!running || paused) return;

  // While the user is actively playing/typing, shrink the batch to keep
  // the main thread's competitor for CPU small (real throttling).
  const batch = interacting ? 1 : intensity.batch;

  const pop = engine.population;
  const end = Math.min(pop.size, cursor + batch);
  for (; cursor < end; cursor++) {
    if (!pop.meta[cursor].evaluated) {
      const r = evaluator.evaluate(pop.nets[cursor]);
      pop.markEvaluated(cursor, r);
      windowGames++;
      windowSteps += r.steps;
    }
  }

  if (cursor < pop.size) {
    timer = setTimeout(workTick, interacting ? Math.max(intensity.yieldMs, 8) : intensity.yieldMs);
    return;
  }

  // Generation complete -> evolve.
  cursor = 0;
  const stats = engine.evolve((net) => evaluator.evaluate(net));
  windowSteps += stats.bestScore > 0 ? 0 : 0; // steps already counted per game above

  const now = performance.now();
  const elapsed = Math.max(1, now - windowStart) / 1000;
  const gamesPerSec = windowGames / elapsed;
  const stepsPerSec = windowSteps / elapsed;
  if (elapsed >= 1.0) { windowStart = now; windowGames = 0; windowSteps = 0; }

  // Validation on unseen seeds — only for a fresh champion, it's cheap.
  let valFitness = null;
  if (stats.improved) {
    valFitness = evaluator.validate(engine.champion.net, validationSeeds);
    engine.champion.valFitness = valFitness;
  }

  post(MSG.STATS, {
    stats: { ...stats, valFitness },
    gamesPerSec,
    stepsPerSec,
    historyPoint: { gen: stats.generation, best: stats.bestFitness, avg: stats.avgFitness },
  });

  const due = stats.generation - lastChampionPost >= cfg.championPostEvery;
  if (stats.improved || due) {
    lastChampionPost = stats.generation;
    const copy = engine.champion.net.params.slice(); // transfer a copy, keep ours
    post(MSG.CHAMPION, {
      champion: {
        fitness: engine.champion.fitness,
        valFitness: engine.champion.valFitness ?? null,
        foods: engine.champion.foods,
        generation: engine.champion.generation,
        activation: engine.champion.net.activation,
        parameterCount: engine.champion.net.parameterCount,
        checkpointDue: stats.generation % cfg.checkpointEvery === 0 || stats.improved,
      },
      params: copy,
    }, [copy.buffer]);
  }

  if (running && !paused) timer = setTimeout(workTick, intensity.yieldMs);
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  try {
    switch (msg.type) {
      case MSG.START:
        if (!engine) init();
        running = true;
        paused = false;
        clearTimeout(timer);
        timer = setTimeout(workTick, 0);
        break;

      case MSG.PAUSE:
        paused = true;
        clearTimeout(timer);
        timer = 0;
        break;

      case MSG.RESUME:
        if (!running) break;
        paused = false;
        clearTimeout(timer);
        timer = setTimeout(workTick, 0);
        break;

      case MSG.STOP:
        running = false;
        paused = false;
        clearTimeout(timer);
        timer = 0;
        break;

      case MSG.RESET:
        clearTimeout(timer);
        timer = 0;
        init();               // fresh population + champion
        if (running && !paused) timer = setTimeout(workTick, 0);
        break;

      case MSG.SET_INTENSITY:
        intensity = resolveIntensity(msg.intensity);
        break;

      case MSG.SET_INTERACTING:
        interacting = !!msg.value;
        break;

      case MSG.SET_BACKGROUND:
        // Main thread already decided policy; worker just obeys pause/resume.
        break;

      case MSG.GET_CHAMPION: {
        if (engine?.champion) {
          const copy = engine.champion.net.params.slice();
          post(MSG.CHAMPION, {
            champion: {
              fitness: engine.champion.fitness,
              valFitness: engine.champion.valFitness ?? null,
              foods: engine.champion.foods,
              generation: engine.champion.generation,
              activation: engine.champion.net.activation,
              parameterCount: engine.champion.net.parameterCount,
              checkpointDue: true,
            },
            params: copy,
          }, [copy.buffer]);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    post(MSG.ERROR, { error: String(err && err.stack || err) });
  }
});

self.addEventListener('error', (e) => {
  post(MSG.ERROR, { error: String(e.message || 'worker error') });
});

'use strict';

/**
 * TrainingWorker — owns the ENTIRE training loop: population, simulation,
 * inference, fitness, evolution. The main thread only sends commands and
 * renders stats. Batched evaluation with setTimeout yields keeps this worker
 * responsive to PAUSE/STOP messages at every intensity level.
 *
 * Timer curriculum: games run under a growing step budget (engine.getTimeBudget);
 * champions are ranked by fixed-budget validation on unseen seeds so scores stay
 * comparable across generations.
 */

import { EvolutionEngine } from '../training/EvolutionEngine.js';
import { FitnessEvaluator } from '../training/FitnessEvaluator.js';
import { TrainingConfig, resolveIntensity } from '../training/TrainingConfig.js';
import { normalizeHidden } from '../ai/NetworkConfig.js';
import { isActivation } from '../ai/ActivationFunctions.js';
import { setBoard } from '../game/GameRules.js';
import { WorkerMessageType as MSG } from '../utils/Constants.js';

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
let archOp = {};   // last arch/builder prefs, so SET_BOARD/SET_APPLES can re-init

function post(type, data = {}, transfer = []) {
  self.postMessage({ type, ...data }, transfer);
}

function init(archPrefs = {}) {
  cfg = { ...TrainingConfig };
  archOp = { ...archPrefs };
  let hidden, activation;
  try {
    hidden = archPrefs.hidden !== undefined ? normalizeHidden(archPrefs.hidden) : undefined;
  } catch { hidden = undefined; }
  if (isActivation(archPrefs.activation)) activation = archPrefs.activation;

  if (Number.isFinite(archPrefs.populationSize) && archPrefs.populationSize >= 10) {
    cfg.populationSize = Math.min(2000, Math.floor(archPrefs.populationSize));
  }
  if (Number.isFinite(archPrefs.mutationStrength) && archPrefs.mutationStrength >= 0 && archPrefs.mutationStrength <= 1) {
    cfg.mutationStrength = archPrefs.mutationStrength;
  }
  if (Number.isFinite(archPrefs.boardSize) && archPrefs.boardSize >= 8 && archPrefs.boardSize <= 40) {
    setBoard(archPrefs.boardSize, archPrefs.boardSize);   // live binding — observers pick it up
  }
  if (Number.isFinite(archPrefs.appleCount) && archPrefs.appleCount >= 1 && archPrefs.appleCount <= 4) {
    cfg.appleCount = Math.floor(archPrefs.appleCount);
  }

  engine = new EvolutionEngine(cfg, (Math.random() * 0xffffffff) >>> 0, {
    ...(hidden ? { hidden } : {}),
    ...(activation ? { activation } : {}),
  });
  evaluator = new FitnessEvaluator(cfg);
  validationSeeds = Array.from({ length: cfg.validationSeeds }, () => (Math.random() * 0xffffffff) >>> 0);
  cursor = 0;
  windowStart = performance.now();
  windowGames = 0;
  windowSteps = 0;
  lastChampionPost = -1;
  const net0 = engine.population.nets[0];
  post(MSG.READY, {
    populationSize: cfg.populationSize,
    parameterCount: net0.parameterCount,
    shape: net0.shape,
    timeBudget: engine.getTimeBudget(),
  });
}

function workTick() {
  if (!running || paused) return;

  // While the user is actively playing/typing, shrink the batch to keep
  // the main thread's competitor for CPU small (real throttling).
  const batch = interacting ? 1 : intensity.batch;

  const pop = engine.population;
  const budget = engine.getTimeBudget(); // curriculum: grows each generation
  const end = Math.min(pop.size, cursor + batch);
  for (; cursor < end; cursor++) {
    if (!pop.meta[cursor].evaluated) {
      const r = evaluator.evaluate(pop.nets[cursor], null, budget);
      pop.markEvaluated(cursor, r);
      windowGames++;
      windowSteps += r.steps;
    }
  }

  if (cursor < pop.size) {
    timer = setTimeout(workTick, interacting ? Math.max(intensity.yieldMs, 8) : intensity.yieldMs);
    return;
  }

  // Generation complete -> evolve. Champions rank on FIXED-budget validation
  // over unseen seeds so scores are comparable while the budget grows.
  cursor = 0;
  const stats = engine.evolve(
    (net) => evaluator.evaluate(net, null, engine.getTimeBudget()),
    (net) => evaluator.validate(net, validationSeeds),
  );

  const now = performance.now();
  const elapsed = Math.max(1, now - windowStart) / 1000;
  const gamesPerSec = windowGames / elapsed;
  const stepsPerSec = windowSteps / elapsed;
  if (elapsed >= 1.0) { windowStart = now; windowGames = 0; windowSteps = 0; }

  post(MSG.STATS, {
    stats,
    gamesPerSec,
    stepsPerSec,
    historyPoint: { gen: stats.generation, best: stats.bestFitness, avg: stats.avgFitness },
  });

  const due = stats.generation - lastChampionPost >= cfg.championPostEvery;
  if (stats.improved || due) {
    lastChampionPost = stats.generation;
    if (stats.improved) engine.champion.valFitness = engine.champion.fitness;
    const copy = engine.champion.net.params.slice(); // transfer a copy, keep ours
    post(MSG.CHAMPION, {
      champion: {
        fitness: engine.champion.fitness,
        trainFitness: engine.champion.trainFitness,
        valFitness: engine.champion.valFitness ?? null,
        foods: engine.champion.foods,
        generation: engine.champion.generation,
        activation: engine.champion.net.activation,
        parameterCount: engine.champion.net.parameterCount,
        shape: engine.champion.net.shape,
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
        if (!engine) init(msg.arch);
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
        init(msg.arch);       // fresh population + champion
        if (running && !paused) timer = setTimeout(workTick, 0);
        break;

      case MSG.SET_ARCH:
        // Architecture change invalidates every genome -> full rebuild.
        clearTimeout(timer);
        timer = 0;
        init({ hidden: msg.hidden });
        if (running && !paused) timer = setTimeout(workTick, 0);
        break;

      case MSG.SET_ACTIVATION:
        // Weights-preserving identity conversion; future immigrants follow.
        if (engine && isActivation(msg.name)) {
          engine.arch.activation = msg.name;
          engine.population.convertAll(msg.name);
        }
        break;

      case MSG.SET_INTENSITY:
        intensity = resolveIntensity(msg.intensity);
        break;

      case MSG.SET_MUTATION:
        // Live-adjust Gaussian σ for current population + future runs.
        if (engine) {
          engine.mutationStrength = Math.max(0, Math.min(1, Number(msg.strength) || cfg.mutationStrength));
          cfg.mutationStrength = engine.mutationStrength;   // reset target for adaptive decay
        }
        break;

      case MSG.SET_POPULATION:
        // Population size requires a fresh population to take effect.
        if (engine) {
          cfg.populationSize = Math.max(10, Math.min(2000, Number(msg.size) || cfg.populationSize));
          clearTimeout(timer);
          timer = 0;
          engine.reset();   // rebuild population at the new size
          if (running && !paused) timer = setTimeout(workTick, 0);
        }
        break;

      case MSG.SET_BOARD:
        // Board geometry + population + evaluator must all rebuild together.
        if (engine) {
          const size = Math.max(8, Math.min(40, Number(msg.size) || 20));
          setBoard(size, size);
          clearTimeout(timer);
          timer = 0;
          init({ ...archOp, boardSize: size, appleCount: cfg.appleCount });
          if (running && !paused) timer = setTimeout(workTick, 0);
        }
        break;

      case MSG.SET_APPLES:
        if (engine) {
          cfg.appleCount = Math.max(1, Math.min(4, Number(msg.count) || 1));
          clearTimeout(timer);
          timer = 0;
          init({ ...archOp, boardSize: archOp.boardSize ?? 20, appleCount: cfg.appleCount });
          if (running && !paused) timer = setTimeout(workTick, 0);
        }
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
              trainFitness: engine.champion.trainFitness,
              valFitness: engine.champion.valFitness ?? null,
              foods: engine.champion.foods,
              generation: engine.champion.generation,
              activation: engine.champion.net.activation,
              parameterCount: engine.champion.net.parameterCount,
              shape: engine.champion.net.shape,
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

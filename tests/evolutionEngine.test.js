'use strict';

/**
 * Plain-assertion tests for the evolution engine + timer-curriculum fitness.
 * Run: node tests/evolutionEngine.test.js
 */
import { EvolutionEngine } from '../js/training/EvolutionEngine.js';
import { TrainingConfig } from '../js/training/TrainingConfig.js';
import { FitnessEvaluator } from '../js/training/FitnessEvaluator.js';
import { ACTIVATIONS } from '../js/ai/ActivationFunctions.js';
import { Random } from '../js/utils/Random.js';

const CFG = {
  ...TrainingConfig,
  populationSize: 30,        // small for fast tests
  elitismRate: 0.10,         // 3 elites
  immigrantRate: 0.10,       // 3 immigrants
  maxStepsWithoutFood: 40,
};

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); }
function ok(v, msg = '') { if (!v) throw new Error(msg || 'expected truthy'); }

/** Deterministic fake evaluation: fitness = f(first weight) so selection is testable. */
function fakeEvaluate(net) {
  const foods = Math.floor(Math.abs(net.params[0]) * 5);
  return { fitness: foods * 100 + 10, foods, steps: 20, reason: 'cap' };
}

console.log('evolutionEngine.test.js');

t('population initializes with the configured size and random activations', () => {
  const e = new EvolutionEngine(CFG, 42);
  eq(e.population.size, CFG.populationSize);
  const acts = new Set(e.population.nets.map((n) => n.activation));
  for (const a of acts) ok(ACTIVATIONS.includes(a), `unknown activation ${a}`);
});

t('evolve evaluates the whole population and advances the generation', () => {
  const e = new EvolutionEngine(CFG, 42);
  let evaluated = 0;
  const s = e.evolve((net) => { evaluated++; return fakeEvaluate(net); });
  eq(evaluated, CFG.populationSize, 'entire population evaluated');
  eq(e.generation, 1, 'first pass is generation 1');
  for (const m of e.population.meta) ok(!m.evaluated, 'next generation starts unevaluated');
  ok(Number.isFinite(s.bestFitness), 'best fitness finite');
});

t('champion tracks the best fitness and never regresses', () => {
  const e = new EvolutionEngine(CFG, 7);
  let s = e.evolve(fakeEvaluate);
  const firstChampion = e.champion.fitness;
  ok(firstChampion > 0);
  const worse = () => ({ fitness: -1, foods: 0, steps: 1, reason: 'self' });
  for (let g = 0; g < 5; g++) {
    s = e.evolve(worse);
    ok(e.champion.fitness >= firstChampion, `champion never regresses (gen ${e.generation})`);
  }
  eq(e.champion.generation, 1, 'champion still from generation 1');
});

t('time budget follows the configured growth schedule and caps out', () => {
  const cfg = { ...CFG, timeBudgetStart: 100, timeBudgetGrowth: 7, timeBudgetMax: 130 };
  const e = new EvolutionEngine(cfg, 42);
  eq(e.getTimeBudget(), 100, 'generation 0 uses the start budget');
  e.evolve(fakeEvaluate);
  eq(e.getTimeBudget(), 107, 'grows by growth after gen 1');
  for (let g = 0; g < 20; g++) e.evolve(fakeEvaluate);
  eq(e.getTimeBudget(), 130, 'never exceeds the cap');
});

t('champion fitness comes from the comparable validation score, never raw training fitness', () => {
  const e = new EvolutionEngine(CFG, 9);
  // Training scores inflate every generation (simulating a growing budget).
  const inflating = () => ({ fitness: 500 + e.generation * 1000, foods: 5, steps: 10, reason: 'cap' });
  let last = e.evolve(inflating, () => -7);
  eq(last.championFitness, -7, 'champion score IS the validation callback value');
  for (let g = 0; g < 5; g++) {
    last = e.evolve(inflating, () => -7);
    ok(e.champion.fitness <= -7, 'inflating training scores can never hijack the champion title');
  }
});

t('elites survive unchanged into the next generation', () => {
  const e = new EvolutionEngine(CFG, 99);
  const evaluated = [];
  e.evolve((net) => {
    const r = fakeEvaluate(net);
    evaluated.push({ fitness: r.fitness, params: net.params.slice() });
    return r;
  });
  const eliteCount = Math.max(1, Math.round(CFG.populationSize * CFG.elitismRate));
  const elites = evaluated.sort((a, b) => b.fitness - a.fitness).slice(0, eliteCount);

  let matched = 0;
  for (const elite of elites) {
    outer: for (const net of e.population.nets) {
      for (let i = 0; i < elite.params.length; i++) {
        if (elite.params[i] !== net.params[i]) continue outer;
      }
      matched++;
      break;
    }
  }
  eq(matched, elites.length, 'every elite still present verbatim');
});

t('mutation actually alters most offspring', () => {
  const e = new EvolutionEngine(CFG, 5);
  e.evolve(fakeEvaluate);
  const s = e.evolve(fakeEvaluate);
  ok(Number.isFinite(s.bestFitness), 'best fitness finite');
  ok(Number.isFinite(s.avgFitness), 'avg fitness finite');
});

t('stagnation boosts mutation strength, improvement decays it', () => {
  const e = new EvolutionEngine(CFG, 11);
  e.evolve(fakeEvaluate);
  const base = e.mutationStrength;
  const worse = () => ({ fitness: -1, foods: 0, steps: 1, reason: 'self' });
  for (let g = 0; g < CFG.stagnationLimit + 1; g++) e.evolve(worse);
  ok(e.mutationStrength > base, `stagnation raised strength: ${base} -> ${e.mutationStrength}`);
});

t('activation mutation stays within the supported set', () => {
  const e = new EvolutionEngine({ ...CFG, activationMutationRate: 0.5 }, 3); // exaggerated for the test
  e.evolve(fakeEvaluate);
  for (let g = 0; g < 6; g++) e.evolve(fakeEvaluate);
  for (const n of e.population.nets) ok(ACTIVATIONS.includes(n.activation), `unknown activation ${n.activation}`);
});

t('architecture option: every network (incl. immigrants) has the chosen hidden sizes', () => {
  const e = new EvolutionEngine(CFG, 13, { hidden: [4, 6], activation: 'gelu' });
  for (const net of e.population.nets) {
    ok(net.shape.join(',') === '18,4,6,3', `shape ${net.shape.join(',')}`);
  }
  e.evolve(fakeEvaluate); // builds next generation (elites, children, immigrants)
  for (const net of e.population.nets) {
    ok(net.shape.join(',') === '18,4,6,3', `post-evolve shape ${net.shape.join(',')}`);
  }
  ok(e.population.nets.some((n) => n.activation === 'gelu'), 'base activation present');
});

t('reset wipes generation, champion and population', () => {
  const e = new EvolutionEngine(CFG, 21);
  e.evolve(fakeEvaluate);
  ok(e.champion);
  e.reset();
  eq(e.generation, 0);
  ok(e.champion === null, 'champion wiped on explicit reset');
  eq(e.population.size, CFG.populationSize);
});

t('full deterministic run: same seed -> same champion fitness', () => {
  const run = (seed) => {
    const e = new EvolutionEngine(CFG, seed);
    let last = null;
    for (let g = 0; g < 3; g++) last = e.evolve(fakeEvaluate);
    return last.championFitness;
  };
  eq(run(123), run(123), 'reproducible with the same seed');
});

// ---- Timer-curriculum fitness (scripted simulations through the real evaluator) ----

/** Minimal simulation double: eats one apple every `period` steps, then dies
 *  (`deathReason`) after `dieAfter` steps (defaults to surviving to the cap).
 *  Cap semantics mirror the real simulation: checked BEFORE the step, so
 *  steps never exceeds maxSteps. */
function makeScriptedSim(period, { deathReason = 'cap', dieAfter = Infinity } = {}) {
  return class {
    constructor() { this.maxSteps = Infinity; this.maxStepsWithoutFood = Infinity; }
    reset() {
      this.steps = 0;
      this.foods = 0;
      this.foodIdx = 0;
      this._sinceFood = 0;
      return this;
    }
    observation() { return new Float32Array(18); }
    step() {
      if (this._sinceFood >= this.maxStepsWithoutFood) return { dead: 'starve' };
      if (this.steps >= this.maxSteps) return { dead: deathReason };
      if (this.steps >= dieAfter) return { dead: deathReason };
      this.steps++;
      this._sinceFood++;
      if (this.steps % period === 0) { this.foods++; this._sinceFood = 0; return 'ate'; }
      return 'moved';
    }
  };
}

t('timer fitness: equal apples, the FASTER snake scores higher', () => {
  const cfg = { ...CFG };
  const evFast = new FitnessEvaluator(cfg);
  evFast.sim = new (makeScriptedSim(5))();          // apple every 5 steps
  evFast.sim.maxSteps = cfg.timeBudgetStart;
  const evSlow = new FitnessEvaluator(cfg);
  evSlow.sim = new (makeScriptedSim(10))();         // apple every 10 steps
  evSlow.sim.maxSteps = cfg.timeBudgetStart;

  const dummyNet = { forward: () => new Float32Array(3) };
  const rFast = evFast.evaluate(dummyNet, null, cfg.timeBudgetStart);
  const rSlow = evSlow.evaluate(dummyNet, null, cfg.timeBudgetStart);
  ok(rFast.foods > rSlow.foods, `faster snake ate more within the budget (${rFast.foods} vs ${rSlow.foods})`);
  ok(rFast.fitness > rSlow.fitness, 'more apples within the same timer wins');
});

// The new reward contract: apples are primary, but surviving a stable run
// must beat greedily grabbing one more apple and dying — otherwise selection
// would reward suicidal apple chasing (the old "feels off" behaviour).
t('reward: survival gradient exists (same apples, no crash > crash)', () => {
  const cfg = { ...CFG };
  const evAlive = new FitnessEvaluator(cfg);
  evAlive.sim = new (makeScriptedSim(6, { deathReason: 'cap' }));   // survives to cap
  const evCrash = new FitnessEvaluator(cfg);
  evCrash.sim = new (makeScriptedSim(6, { deathReason: 'wall' })); // same rate, dies by wall
  const dummyNet = { forward: () => new Float32Array(3) };
  const a = evAlive.evaluate(dummyNet, null, cfg.timeBudgetStart);
  const c = evCrash.evaluate(dummyNet, null, cfg.timeBudgetStart);
  eq(a.foods, c.foods, 'same apples eaten');
  ok(c.reason === 'wall', 'crash sim died by wall');
  ok(a.fitness > c.fitness, `surviving (${a.fitness}) beats crashing (${c.fitness}) with equal apples`);
});

t('reward: death penalty exceeds one apple — greedy-then-die never wins', () => {
  const c = { ...CFG };
  // A single crash costs MORE than the value of one extra apple, so a snake
  // that risks its life for one more apple is, at best, trading +1 apple for
  // −deathPenalty fitness — never a good deal. Surviving a +1 apple slower is
  // always preferred over grabbing it and dying.
  ok(c.deathPenalty > c.fitnessAppleValue, 'a crash costs more than one apple');
  ok(c.starvationPenalty < c.fitnessAppleValue, 'starvation is real but cheaper than surviving-an-extra-apple');
});

t('reward: an apple is worth more than a whole budget of cautious survival', () => {
  ok(
    CFG.fitnessStepCost * CFG.timeBudgetMax < CFG.fitnessAppleValue,
    `STEP·timeBudgetMax = ${CFG.fitnessStepCost * CFG.timeBudgetMax} must stay under one apple (${CFG.fitnessAppleValue})`,
  );
});

t('reward: starvation is penalized (no coasting without eating)', () => {
  const cfg = { ...CFG };
  const ev = new FitnessEvaluator(cfg);
  ev.sim = new (makeScriptedSim(999999, { deathReason: 'starve', dieAfter: cfg.maxStepsWithoutFood }));
  const dummyNet = { forward: () => new Float32Array(3) };
  const r = ev.evaluate(dummyNet, null, cfg.timeBudgetStart);
  eq(r.reason, 'starve', 'starves without food');
  ok(r.fitness < 0, `a foodless starver scores negative (${r.fitness})`);
});

t('timer fitness: evaluation respects the imposed budget', () => {
  const ev = new FitnessEvaluator({ ...CFG });
  ev.sim = new (makeScriptedSim(3))();
  const dummyNet = { forward: () => new Float32Array(3) };
  const r = ev.evaluate(dummyNet, null, 90);
  eq(r.reason, 'cap', 'game ended on the budget');
  ok(r.steps <= 90, `steps ${r.steps} within budget 90`);
});

t('validation runs at the FIXED reference budget regardless of the training budget', () => {
  const cfg = { ...CFG };
  const ev = new FitnessEvaluator(cfg);
  ev.sim = new (makeScriptedSim(4))();
  const dummyNet = { forward: () => new Float32Array(3) };
  // Two "training" budgets, same validation seeds -> identical validation score.
  const v1 = ev.validate(dummyNet, [11, 22]);
  const v2 = ev.validate(dummyNet, [11, 22], cfg.validationBudget);
  eq(v1, v2, 'default validate() budget is the fixed reference budget');
});

t('real evaluation smoke: 2 generations with the actual evaluator stay finite', async () => {
  const e = new EvolutionEngine({ ...CFG, populationSize: 12 }, 77);
  const ev = new FitnessEvaluator(e.cfg);
  let s = null;
  for (let g = 0; g < 2; g++) s = e.evolve((net) => ev.evaluate(net, null, e.getTimeBudget()));
  ok(Number.isFinite(s.bestFitness));
  ok(Number.isFinite(s.avgFitness));
  ok(Number.isFinite(s.championFitness), 'champion carries a finite comparable score');
  ok(s.timeBudget >= CFG.timeBudgetStart, 'stats expose the current time budget');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

'use strict';

import { WorkerMessageType as MSG } from '../utils/Constants.js';
import { TrainingConfig, INTENSITY } from '../training/TrainingConfig.js';
import { NeuralNetwork } from '../ai/NeuralNetwork.js';
import {
  DEFAULT_HIDDEN, ARCH_LIMITS, fullDims, calculateParameterCount, shapeLabel,
} from '../ai/NetworkConfig.js';
import { ACTIVATIONS } from '../ai/ActivationFunctions.js';
import { CheckpointManager } from '../storage/CheckpointManager.js';
import { TrainingGraph } from './TrainingGraph.js';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { fmt } from '../utils/MathUtils.js';

/**
 * TrainingPanel — main-thread client for TrainingWorker.
 * Owns the worker lifecycle (create/terminate), renders real measured stats,
 * auto-saves the champion, and hands the champion to UIManager for replay.
 * Also hosts the architecture editor and activation picker; no simulation
 * logic lives here — only message plumbing and DOM.
 */
export class TrainingPanel {
  constructor({ storage, ui }) {
    this.storage = storage;
    this.ui = ui;
    this.checkpoints = new CheckpointManager(storage);
    this.worker = null;
    this.running = false;
    this.paused = false;
    this.champion = null;      // NeuralNetwork
    this.championMeta = null;  // { fitness, generation, activation, valFitness }
    this._interactTimer = 0;

    // User-selected base activation + editable hidden sizes (persisted).
    this.activation = this.storage.getDefaultActivation(TrainingConfig.defaultActivation);
    if (!ACTIVATIONS.includes(this.activation)) this.activation = TrainingConfig.defaultActivation;
    let savedHidden = this.storage.getDefaultHidden(null);
    try {
      this.hidden = this._sanitizeHidden(savedHidden ?? TrainingConfig.defaultHidden);
    } catch { this.hidden = [...TrainingConfig.defaultHidden]; }

    this.graph = new TrainingGraph(document.getElementById('trainGraph'), { limit: TrainingConfig.historyLimit });
    this.viz = new NetworkVisualizer(document.getElementById('netViz'));

    this._syncSettingInputs();
    this._renderArch();
    this._bind();
    this._restoreCheckpoint();
  }

  // ---- wiring ----

  _$(id) { return document.getElementById(id); }

  _bind() {
    const click = (id, fn) => this._$(id)?.addEventListener('click', () => { this.ui.sound.click(); fn(); });

    click('trainStart', () => this._start());
    click('trainPause', () => this._pause());
    click('trainResume', () => this._resume());
    click('trainStop', () => this._stop());
    click('trainReset', () => {
      if (window.confirm('Reset training? The current population AND the saved champion will be discarded.')) {
        this._reset();
      }
    });
    click('trainSave', () => this._save());
    click('trainLoad', () => this._load());
    click('trainExport', () => this._export());
    click('trainImport', () => this._import());
    click('trainWatch', () => this._watch());
    click('graphReset', () => this.graph.reset());

    this._$('intensitySelect')?.addEventListener('change', (e) => {
      this._post(MSG.SET_INTENSITY, { intensity: e.target.value });
    });

    // Activation picker: converts the live population (weights preserved)
    // and becomes the base identity for fresh runs/immigrants.
    this._$('activationSelect')?.addEventListener('change', (e) => {
      const name = e.target.value;
      if (!ACTIVATIONS.includes(name)) return;
      this.activation = name;
      this.storage.setDefaultActivation(name);
      if (this.worker) this._post(MSG.SET_ACTIVATION, { name });
      this._note(`Activation set to ${name} — population converted, weights preserved.`);
    });

    // Architecture editor: one delegated listener handles every row button.
    this._$('archEditor')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      this._archEdit(btn.dataset.act, Number(btn.dataset.layer));
    });
    this._$('archAddLayer')?.addEventListener('click', () => this._archEdit('add', -1));

    this._$('backgroundToggle')?.addEventListener('change', (e) => {
      this.storage.setBackgroundTraining(e.target.checked);
      if (!e.target.checked && document.hidden && this.running && !this.paused) this._pause();
    });

    // Real interaction throttling: pointer/key activity shrinks the worker batch.
    const markInteracting = () => {
      if (!this.worker || !this.running || this.paused) return;
      this._post(MSG.SET_INTERACTING, { value: true });
      clearTimeout(this._interactTimer);
      this._interactTimer = setTimeout(() => this._post(MSG.SET_INTERACTING, { value: false }), 800);
    };
    window.addEventListener('pointerdown', markInteracting, { passive: true });
    window.addEventListener('keydown', markInteracting, { passive: true });

    // Visibility policy: pause when hidden unless the user opted in.
    document.addEventListener('visibilitychange', () => {
      if (!this.running || this.paused) return;
      if (document.hidden && !this.storage.getBackgroundTraining()) this._pause();
    });
  }

  // ---- architecture & activation UI ----

  _sanitizeHidden(arr) {
    if (!Array.isArray(arr)) throw new Error('hidden must be an array');
    return arr.map((n) => {
      const v = Math.round(Number(n));
      if (!Number.isFinite(v) || v < ARCH_LIMITS.minNodesPerLayer || v > ARCH_LIMITS.maxNodesPerLayer) {
        throw new Error('layer size out of range');
      }
      return v;
    }).slice(0, ARCH_LIMITS.maxHiddenLayers);
  }

  /** Reflect persisted prefs into the controls (called once at boot). */
  _syncSettingInputs() {
    const sel = this._$('activationSelect');
    if (sel) sel.value = this.activation;
  }

  /** Redraw the hidden-layer rows + live param counter from this.hidden. */
  _renderArch() {
    const host = this._$('archEditor');
    if (!host) return;
    host.textContent = '';
    if (this.hidden.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'hint';
      empty.textContent = '(no hidden layers — linear 18→3)';
      host.appendChild(empty);
    }
    this.hidden.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'archrow';
      row.innerHTML =
        `<span class="lname">h${i + 1}</span>` +
        `<button type="button" data-act="dec" data-layer="${i}" aria-label="Remove a node from layer ${i + 1}">−</button>` +
        `<b>${n}</b>` +
        `<button type="button" data-act="inc" data-layer="${i}" aria-label="Add a node to layer ${i + 1}">+</button>` +
        `<button type="button" class="remove" data-act="del" data-layer="${i}" aria-label="Delete layer ${i + 1}">✕</button>`;
      host.appendChild(row);
    });

    let count;
    try { count = calculateParameterCount(fullDims(this.hidden)).total; }
    catch { count = null; }
    const out = this._$('archParams');
    if (out) {
      out.textContent = count != null && count <= ARCH_LIMITS.maxParams
        ? `${count} params · ${shapeLabel(fullDims(this.hidden))}`
        : '—';
    }
    const addBtn = this._$('archAddLayer');
    if (addBtn) addBtn.disabled = this.hidden.length >= ARCH_LIMITS.maxHiddenLayers;
  }

  /** Handle an editor action; persists and (with consent) rebuilds the run. */
  _archEdit(act, layer) {
    const L = ARCH_LIMITS;
    const h = [...this.hidden];
    if (act === 'add') {
      if (h.length >= L.maxHiddenLayers) return;
      h.push(L.minNodesPerLayer);
    } else if (act === 'del') {
      if (layer < 0 || layer >= h.length) return;
      h.splice(layer, 1);
    } else if (act === 'inc') {
      if (h[layer] >= L.maxNodesPerLayer) return;
      h[layer]++;
    } else if (act === 'dec') {
      if (h[layer] <= L.minNodesPerLayer) return;
      h[layer]--;
    }

    let count;
    try { count = calculateParameterCount(fullDims(h)).total; }
    catch { return; } // invalid intermediate state — ignore
    if (count > L.maxParams) {
      this._note(`Too large — keep the network under ${L.maxParams} parameters.`);
      return;
    }

    this.hidden = h;
    this._renderArch();
    this.storage.setDefaultHidden(h);

    // Seamless apply — never block the user with a popup.
    //   - live worker (running or paused): rebuild immediately with a fresh
    //     population (old genomes have a different shape). When paused the
    //     worker stays paused and picks it up on Resume.
    //   - stopped: persist only, applied on the next Start.
    if (this.worker) {
      this.graph.reset();
      this._post(MSG.SET_ARCH, { hidden: h });
      this._note(`Architecture ${shapeLabel(fullDims(h))} applied — fresh population.`);
    } else {
      this._note(`Architecture set to ${shapeLabel(fullDims(h))} — used on next Start.`);
    }
  }

  _restoreCheckpoint() {
    const meta = this.checkpoints.loadMeta();
    if (!meta) {
      this._note('No saved champion yet — press Start to train from random networks.');
      this._$('trainWatch').disabled = true;
      return;
    }
    // Load full network for replay/inspector.
    const loaded = this.checkpoints.load();
    if (loaded) {
      this.champion = loaded;
      this.championMeta = meta;
      this.viz.render(loaded);
      this._$('trainWatch').disabled = false;
      this._caption();
      this._note(`Restored champion from ${meta.savedAt} (gen ${meta.generation}, fitness ${fmt(meta.fitness)}).`);
    }
  }

  // ---- worker lifecycle (Stop means stop: terminate() kills the loop dead) ----

  _spawnWorker() {
    if (this.worker) return;
    this.worker = new Worker(
      new URL('../workers/TrainingWorker.js', import.meta.url),
      { type: 'module' },
    );
    this.worker.addEventListener('message', (e) => this._onMessage(e.data));
    this.worker.addEventListener('error', (e) => {
      this._note(`Worker error: ${e.message}`);
      this._teardown();
    });
  }

  _teardown() {
    if (this.worker) { this.worker.terminate(); this.worker = null; } // no orphaned loops
    this.running = false;
    this.paused = false;
    this._buttons();
  }

  _post(type, data = {}, transfer = []) {
    this.worker?.postMessage({ type, ...data }, transfer);
  }

  _arch() {
    return { hidden: this.hidden.slice(), activation: this.activation };
  }

  _start() {
    if (this.running) return;
    this._spawnWorker();
    this._post(MSG.SET_INTENSITY, { intensity: this._$('intensitySelect').value });
    this._post(MSG.START, { arch: this._arch() });
    this.running = true;
    this.paused = false;
    this._buttons();
    this._note('Training…');
  }

  _pause() {
    if (!this.running || this.paused) return;
    this._post(MSG.PAUSE);
    this.paused = true;
    this._buttons();
    this._note('Paused — population held in memory.');
  }

  _resume() {
    if (!this.running || !this.paused) return;
    this._post(MSG.RESUME);
    this.paused = false;
    this._buttons();
    this._note('Resumed.');
  }

  _stop() {
    if (!this.running) return;
    this._post(MSG.STOP);
    this._teardown();
    this._note('Stopped. Progress is kept — Start resumes a fresh evaluation pass, Save/Load keeps the champion.');
  }

  _reset() {
    this._teardown();
    this.checkpoints.clear();
    this.graph.reset();
    this.champion = null;
    this.championMeta = null;
    this.viz.clear();
    this._$('trainWatch').disabled = true;
    this._caption();
    this._spawnWorker();
    this._post(MSG.SET_INTENSITY, { intensity: this._$('intensitySelect').value });
    this._post(MSG.RESET, { arch: this._arch() });
    this._post(MSG.START);
    this.running = true;
    this.paused = false;
    this._buttons();
    this._note('Reset — new random population, champion wiped.');
  }

  // ---- persistence buttons ----

  _save() {
    if (!this.champion) { this._note('Nothing to save yet.'); return; }
    const ok = this.checkpoints.save(this.champion, this.championMeta);
    this._note(ok ? `Champion saved (gen ${this.championMeta.generation}).` : 'Save failed (storage unavailable).');
  }

  _load() {
    const net = this.checkpoints.load();
    const meta = this.checkpoints.loadMeta();
    if (!net || !meta) { this._note('No valid checkpoint found.'); return; }
    this.champion = net;
    this.championMeta = meta;
    this.viz.render(net);
    this._caption();
    this._$('trainWatch').disabled = false;
    this._note(`Loaded champion (gen ${meta.generation}, fitness ${fmt(meta.fitness)}).`);
  }

  _export() {
    if (!this.champion) { this._note('Nothing to export yet.'); return; }
    const json = this.checkpoints.exportJSON(this.champion, this.championMeta);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `snake-champion-gen${this.championMeta.generation}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this._note('Exported champion JSON.');
  }

  async _import() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        const { net, meta } = this.checkpoints.importJSON(text); // validates, throws if bad
        this.champion = net;
        this.championMeta = meta;
        this.viz.render(net);
        this._caption();
        this._$('trainWatch').disabled = false;
        this._note(`Imported champion (gen ${meta.generation}, fitness ${fmt(meta.fitness)}).`);
      }).catch((err) => this._note(`Import rejected: ${err.message}`));
    };
    input.click();
  }

  _watch() {
    if (!this.champion) { this._note('No champion available — train or load one first.'); return; }
    this.ui.startReplay(this.champion, this.championMeta);
  }

  // ---- worker messages ----

  _onMessage(msg) {
    switch (msg.type) {
      case MSG.READY:
        this._$('statPopulation').textContent = msg.populationSize;
        this._$('statParams').textContent = msg.parameterCount;
        if (msg.timeBudget != null) this._$('statTimeBudget').textContent = msg.timeBudget;
        // Worker normalized the shape — mirror it into the editor.
        if (Array.isArray(msg.shape)) {
          const hidden = msg.shape.slice(1, -1);
          if (hidden.join(',') !== this.hidden.join(',')) {
            try {
              this.hidden = this._sanitizeHidden(hidden);
              this._renderArch();
              this.storage.setDefaultHidden(this.hidden);
            } catch { /* keep editor as-is */ }
          }
        }
        break;

      case MSG.STATS: {
        const s = msg.stats;
        this._$('statGeneration').textContent = s.generation;
        this._$('statBest').textContent = fmt(s.bestFitness);
        this._$('statAvg').textContent = Number.isFinite(s.avgFitness) ? fmt(s.avgFitness) : '—';
        this._$('statBestScore').textContent = s.bestScore;
        if (s.timeBudget != null) this._$('statTimeBudget').textContent = s.timeBudget;
        this._$('statGamesSec').textContent = fmt(msg.gamesPerSec, 0);
        this._$('statStepsSec').textContent = fmt(msg.stepsPerSec, 0);
        this._$('statMutation').textContent = fmt(s.mutationStrength, 2);
        this._$('statStagnation').textContent = s.stagnation;
        this._$('statValFitness').textContent = s.valFitness == null ? '—' : fmt(s.valFitness);
        const total = Object.values(s.activationCounts).reduce((a, b) => a + b, 0) || 1;
        this._$('statActivations').textContent = Object.entries(s.activationCounts)
          .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join('  ');
        if (msg.historyPoint) this.graph.push(msg.historyPoint.gen, msg.historyPoint.best, msg.historyPoint.avg);
        break;
      }

      case MSG.CHAMPION: {
        const c = msg.champion;
        const net = new NeuralNetwork({
          activation: c.activation,
          params: msg.params,
          ...(Array.isArray(c.shape) ? { dims: c.shape } : {}),
        });
        this.champion = net;
        this.championMeta = {
          fitness: c.fitness,
          generation: c.generation,
          activation: c.activation,
          score: c.foods,
          valFitness: c.valFitness,
        };
        this._$('trainWatch').disabled = false;
        this.viz.render(net); // keep the inspector in sync with the live champion
        this._caption();
        if (c.checkpointDue) this.checkpoints.save(net, this.championMeta); // auto-checkpoint
        break;
      }

      case MSG.ERROR:
        this._note(`Training error: ${msg.error}`);
        this._teardown();
        break;
    }
  }

  // ---- DOM helpers ----

  _buttons() {
    const set = (id, disabled) => { const el = this._$(id); if (el) el.disabled = disabled; };
    set('trainStart', this.running);
    set('trainPause', !this.running || this.paused);
    set('trainResume', !this.running || !this.paused);
    set('trainStop', !this.running);
    set('trainReset', false);
  }

  _caption() {
    const el = this._$('netCaption');
    if (!this.champion) { el.textContent = 'No network selected.'; return; }
    const m = this.championMeta;
    el.textContent = `Champion — gen ${m.generation} · fitness ${fmt(m.fitness)}` +
      (m.valFitness != null ? ` · validation ${fmt(m.valFitness)}` : '') +
      ` · ${m.activation} · ${shapeLabel(this.champion.shape)} (${this.champion.parameterCount} params)`;
  }

  _note(text) {
    const el = this._$('trainNote');
    if (el) el.textContent = text;
  }
}

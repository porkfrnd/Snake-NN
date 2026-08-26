'use strict';

import { GameEngine, GameState } from '../game/GameEngine.js';
import { StorageManager } from '../storage/StorageManager.js';
import { Sound } from '../game/Sound.js';
import { fmt } from '../utils/MathUtils.js';

/**
 * UIManager — owns Play-mode DOM: tabs, HUD, overlays, settings, replay chip.
 * Contains zero simulation/training logic; it wires the engine to the screen.
 */
export class UIManager {
  constructor() {
    this.storage = new StorageManager();
    this.sound = new Sound(this.storage.getSound());
    this.engine = null; // set in init()
    this.replayActive = false;
  }

  _$(id) { return document.getElementById(id); }

  init() {
    this.engine = new GameEngine({
      storage: this.storage,
      sound: this.sound,
      reducedMotion: this.storage.getReducedMotion(),
      callbacks: {
        onHUD: (hud) => this._renderHUD(hud),
        onState: (state, count) => this._renderState(state, count),
        onOver: (r) => this._renderOver(r),
      },
    });

    this._bindPlay();
    this._bindSettings();
    this._bindTabs();
    this._buttons();
  }

  // ---- Play mode wiring ----

  _bindPlay() {
    const click = (id, fn) => this._$(id)?.addEventListener('click', () => { this.sound.unlock(); this.sound.click(); fn(); });
    click('pauseBtn', () => {
      if (this.engine.state === GameState.PLAYING) this.engine.pause();
      else if (this.engine.state === GameState.PAUSED) this.engine.resume();
    });
    click('restartBtn', () => this.engine.restart());
    click('menuPlayBtn', () => this.engine.start());
    click('pauseResumeBtn', () => this.engine.resume());
    click('pauseRestartBtn', () => this.engine.restart());
    click('overRestartBtn', () => this.engine.restart());
    click('overMenuBtn', () => this._stopReplayAndMenu());
    click('replayStopBtn', () => this._stopReplayAndMenu());
  }

  _bindSettings() {
    const toggle = (id, get, set) => {
      const el = this._$(id);
      if (!el) return;
      el.setAttribute('aria-checked', String(get()));
      el.addEventListener('click', () => {
        const next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', String(next));
        set(next);
        this.sound.unlock();
        this.sound.click();
      });
    };
    toggle('wrapToggle', () => this.storage.getWrap(), (v) => { this.storage.setWrap(v); this.engine.setWrap(v); });
    toggle('soundToggle', () => this.storage.getSound(), (v) => { this.storage.setSound(v); this.sound.setEnabled(v); });
    toggle('hapticsToggle', () => this.storage.getHaptics(), (v) => this.storage.setHaptics(v));
    toggle('motionToggle', () => this.storage.getReducedMotion(), (v) => { this.storage.setReducedMotion(v); this.engine.setReducedMotion(v); });
  }

  _bindTabs() {
    const show = (which) => {
      this._$('playScreen').hidden = which !== 'play';
      this._$('trainScreen').hidden = which !== 'train';
      this._$('tabPlay').classList.toggle('active', which === 'play');
      this._$('tabTrain').classList.toggle('active', which === 'train');
    };
    this._$('tabPlay')?.addEventListener('click', () => show('play'));
    this._$('tabTrain')?.addEventListener('click', () => show('train'));
  }

  // ---- rendering ----

  _renderHUD(hud) {
    this._$('hudScore').textContent = hud.score;
    this._$('hudBest').textContent = hud.best;
    this._$('hudLevel').textContent = hud.level;
    this._$('hudSpeed').style.width = `${hud.speedPct}%`;
    const chip = this._$('replayChip');
    if (hud.ai) {
      chip.hidden = false;
      this._$('replayMeta').textContent = `gen ${hud.ai.generation} · fit ${fmt(hud.ai.fitness)} · ${hud.ai.activation}`;
    } else {
      chip.hidden = true;
    }
  }

  _renderState(state, count) {
    const show = (id, on) => { this._$(id).classList.toggle('open', on); };
    show('menuOverlay', state === GameState.MENU);
    show('pauseOverlay', state === GameState.PAUSED);
    show('overOverlay', state === GameState.OVER);
    show('countOverlay', state === GameState.COUNTDOWN);
    if (state === GameState.COUNTDOWN && count != null) {
      this._$('countNum').textContent = count > 0 ? String(count) : 'GO';
    }
    this._buttons(state);
  }

  _renderOver(r) {
    this._$('overScore').textContent = r.score;
    this._$('overBest').textContent = r.best;
    this._$('overLevel').textContent = r.level;
    this._$('overFoods').textContent = r.foods;
    this._$('overNew').hidden = !r.isNewBest;
    const title = this._$('overTitle');
    if (r.reason === 'win') title.textContent = 'Perfect game!';
    else if (r.ai) title.textContent = 'AI run ended';
    else title.textContent = 'Game over';
    this._$('overMsg').textContent = r.isNewBest && !r.ai
      ? 'New personal best.'
      : (r.ai ? 'The champion crashed — train more or try again.' : 'The snake hit something solid.');
  }

  _buttons(state = this.engine.state) {
    const playing = state === GameState.PLAYING;
    const paused = state === GameState.PAUSED;
    this._$('pauseBtn').disabled = !playing && !paused;
    this._$('pauseBtn').textContent = paused ? 'Resume' : 'Pause';
  }

  // ---- AI replay (same engine, same code path as humans) ----

  startReplay(net, meta) {
    this.replayActive = true;
    this._switchTab('play');
    this.engine.attachController(
      { decide: (obs) => { const out = net.forward(obs); let b = 0; for (let i = 1; i < out.length; i++) if (out[i] > out[b]) b = i; return b - 1; } },
      { fitness: meta.fitness, generation: meta.generation, activation: meta.activation },
    );
    this.engine.restart();
  }

  _stopReplayAndMenu() {
    if (this.replayActive) {
      this.replayActive = false;
      this.engine.detachController(); // also returns to menu
    } else {
      this.engine.goMenu();
    }
  }

  _switchTab(which) {
    const btn = which === 'play' ? this._$('tabPlay') : this._$('tabTrain');
    btn?.click();
  }
}

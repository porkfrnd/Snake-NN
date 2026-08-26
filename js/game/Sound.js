'use strict';

/**
 * Sound — tiny Web Audio synthesizer. No files, no libraries.
 * Every method is safe to call when AudioContext is unavailable.
 */
export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
  }

  /** Create/resume the context from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { /* audio optional */ }
  }

  _tone(freq, dur, type = 'sine', gain = 0.12, slideTo = null) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo != null) o.frequency.linearRampToValueAtTime(slideTo, t + dur * 0.85);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch { /* never break gameplay over audio */ }
  }

  eat()     { this._tone(560, 0.09, 'square', 0.10, 880); }
  crash()   { this._tone(200, 0.18, 'sawtooth', 0.12, 70); this._tone(110, 0.25, 'triangle', 0.10, 45); }
  click()   { this._tone(700, 0.05, 'sine', 0.07); }
  tick(n)   { this._tone(n === 0 ? 880 : 480 + n * 90, 0.09, 'sine', 0.09); }
  pause(on) { this._tone(on ? 400 : 620, 0.08, 'triangle', 0.08, on ? 300 : 520); }
}

'use strict';

/**
 * InputManager — keyboard, touch d-pad and swipe. Calls back into the engine.
 * Listeners are tracked so destroy() removes everything (no orphans).
 */
export class InputManager {
  constructor(handlers) {
    this.handlers = handlers; // { onDirection(vec), onPause(), onStart(), onAny() }
    this._cleanups = [];
    this._touchStart = null;

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._cleanups.push(() => target.removeEventListener(type, fn, opts));
    };

    on(window, 'keydown', (e) => {
      const k = e.key, c = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
      this.handlers.onAny?.();
      if (k === 'p' || k === 'P' || c === 'KeyP' || k === 'Escape') { this.handlers.onPause(); return; }
      if (k === ' ' || c === 'Space') { this.handlers.onStart(); return; }
      if (k === 'ArrowUp' || c === 'KeyW') this.handlers.onDirection({ x: 0, y: -1 });
      else if (k === 'ArrowDown' || c === 'KeyS') this.handlers.onDirection({ x: 0, y: 1 });
      else if (k === 'ArrowLeft' || c === 'KeyA') this.handlers.onDirection({ x: -1, y: 0 });
      else if (k === 'ArrowRight' || c === 'KeyD') this.handlers.onDirection({ x: 1, y: 0 });
    }, { passive: false });

    // D-pad buttons (pointer events share mouse + touch logic)
    const dpad = document.getElementById('dpad');
    if (dpad) {
      const dirs = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
      dpad.querySelectorAll('button[data-dir]').forEach((btn) => {
        const vec = dirs[btn.dataset.dir];
        const press = (e) => {
          e.preventDefault();
          btn.classList.add('pressed');
          this.handlers.onAny?.();
          this.handlers.onDirection(vec);
        };
        const release = () => btn.classList.remove('pressed');
        on(btn, 'pointerdown', press, { passive: false });
        on(btn, 'pointerup', release);
        on(btn, 'pointerleave', release);
        on(btn, 'pointercancel', release);
      });
      on(dpad, 'contextmenu', (e) => e.preventDefault());
    }

    // Swipe on the board
    const board = document.getElementById('boardWrap');
    if (board) {
      on(board, 'touchstart', (e) => {
        if (e.touches.length !== 1) return;
        this._touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }, { passive: true });
      on(board, 'touchmove', (e) => { if (this._touchStart) e.preventDefault(); }, { passive: false });
      on(board, 'touchend', (e) => {
        if (!this._touchStart) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - this._touchStart.x;
        const dy = t.clientY - this._touchStart.y;
        this._touchStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        this.handlers.onAny?.();
        if (Math.abs(dx) > Math.abs(dy)) this.handlers.onDirection({ x: Math.sign(dx), y: 0 });
        else this.handlers.onDirection({ x: 0, y: Math.sign(dy) });
      }, { passive: true });
    }
  }

  destroy() {
    for (const fn of this._cleanups) { try { fn(); } catch { /* noop */ } }
    this._cleanups.length = 0;
  }
}

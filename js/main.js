'use strict';

import { UIManager } from './ui/UIManager.js';
import { TrainingPanel } from './ui/TrainingPanel.js';

/**
 * main.js — entry point. Boots UI (Play) and the Training panel, exposes a
 * debug hook. Everything else lives in its own module.
 */

function boot() {
  const ui = new UIManager();
  ui.init();
  const training = new TrainingPanel({ storage: ui.storage, ui });

  // Theme toggle — light / matte-grain dark, persisted, applied pre-paint inline.
  const themeBtn = document.getElementById('themeToggle');
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
    if (themeBtn) themeBtn.textContent = t === 'dark' ? 'Light' : 'Dark';
  };
  applyTheme(ui.storage.getTheme() ??
    (matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeBtn?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    ui.storage.setTheme(next);
    applyTheme(next);
    ui.sound.click();
  });

  // Fullscreen toggles for the training graph and the game board.
  const fs = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const toggle = () => {
      if (!document.fullscreenElement) {
        el.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    };
    const btn = id === 'graphWrap' ? document.getElementById('graphFullscreen') : document.getElementById('boardFullscreen');
    btn?.addEventListener('click', toggle);
    el.addEventListener('fullscreenchange', () => {
      if (btn) btn.textContent = document.fullscreenElement ? '✕ Exit' : '⛶';
    });
  };
  fs('graphWrap');
  fs('boardWrap');

  // Debug/inspection hook (intentional, documented in README).
  window.__snake = { ui, training };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

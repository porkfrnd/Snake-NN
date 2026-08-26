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

  // Debug/inspection hook (intentional, documented in README).
  window.__snake = { ui, training };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

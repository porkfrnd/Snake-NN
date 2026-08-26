'use strict';

import { GRID_W, GRID_H } from './GameRules.js';

/**
 * GameRenderer — flat SVG rendering only. No game logic, no gradients, no filters.
 * Palette: snake greens, food red, subtle grid — deliberately plain per design spec.
 */
const NS = 'http://www.w3.org/2000/svg';
const COLORS = {
  grid: '#e9e9e4',
  border: '#d8d8d2',
  head: '#15803d',
  body: '#22c55e',
  tail: '#86efac',
  food: '#dc2626',
  stem: '#7f1d1d',
  leaf: '#16a34a',
  pulse: 'rgba(220,38,38,.35)',
};

export class GameRenderer {
  constructor({ gridLayer, foodLayer, snakeLayer, fxLayer }) {
    this.gridLayer = document.getElementById(gridLayer);
    this.foodLayer = document.getElementById(foodLayer);
    this.snakeLayer = document.getElementById(snakeLayer);
    this.fxLayer = document.getElementById(fxLayer);
    this.cell = 600 / GRID_W;
    this._segPool = [];
  }

  buildGrid() {
    const g = this.gridLayer;
    while (g.firstChild) g.removeChild(g.firstChild);
    const c = this.cell;
    const mk = (x1, y1, x2, y2) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', COLORS.grid);
      l.setAttribute('stroke-width', '1');
      g.appendChild(l);
    };
    for (let x = 1; x < GRID_W; x++) mk(x * c, 0, x * c, 600);
    for (let y = 1; y < GRID_H; y++) mk(0, y * c, 600, y * c);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', 0.5); rect.setAttribute('y', 0.5);
    rect.setAttribute('width', 599); rect.setAttribute('height', 599);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', COLORS.border);
    rect.setAttribute('stroke-width', '2');
    g.appendChild(rect);
  }

  _segEl(i) {
    while (this._segPool.length <= i) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('stroke', 'none');
      this.snakeLayer.appendChild(r);
      this._segPool.push(r);
    }
    return this._segPool[i];
  }

  /** Draw the snake from its body array (head first). */
  renderSnake(body, dirIndex, wrap) {
    const c = this.cell;
    const n = body.length;
    this.snakeLayer.setAttribute('fill-rule', 'evenodd');
    for (let i = 0; i < n; i++) {
      const el = this._segEl(i);
      const { x, y } = body[i];
      const pad = i === 0 ? 1.5 : i === n - 1 ? 4.5 : 3;
      const size = c - pad * 2;
      el.setAttribute('x', x * c + pad);
      el.setAttribute('y', y * c + pad);
      el.setAttribute('width', size);
      el.setAttribute('height', size);
      el.setAttribute('rx', i === 0 ? 8 : i === n - 1 ? 5 : 6);
      el.setAttribute('fill', i === 0 ? COLORS.head : i === n - 1 ? COLORS.tail : COLORS.body);
      el.setAttribute('visibility', 'visible');
    }
    for (let i = n; i < this._segPool.length; i++) this._segPool[i].setAttribute('visibility', 'hidden');

    // Eyes on the head — flat white circles with dark pupils, facing travel direction.
    if (n > 0) {
      this._renderEyes(body[0], dirIndex, wrap);
    }
  }

  _renderEyes(head, dirIndex, wrap) {
    const c = this.cell;
    const cx = head.x * c + c / 2;
    const cy = head.y * c + c / 2;
    // Eye offsets rotate with direction: [up, right, down, left]
    const offs = [
      [{ x: -5, y: -5 }, { x: 5, y: -5 }],
      [{ x: 5, y: -5 }, { x: 5, y: 5 }],
      [{ x: -5, y: 5 }, { x: 5, y: 5 }],
      [{ x: -5, y: -5 }, { x: -5, y: 5 }],
    ];
    const [a, b] = offs[dirIndex % 4];
    if (!this._eyes) {
      const mk = (fill) => {
        const e = document.createElementNS(NS, 'circle');
        e.setAttribute('r', fill === '#111' ? 1.8 : 3.2);
        e.setAttribute('fill', fill);
        this.snakeLayer.appendChild(e);
        return e;
      };
      this._eyes = [mk('#fff'), mk('#fff'), mk('#111'), mk('#111')];
    }
    const pos = [
      [cx + a.x, cy + a.y], [cx + b.x, cy + b.y],
      [cx + a.x, cy + a.y], [cx + b.x, cy + b.y],
    ];
    for (let i = 0; i < 4; i++) {
      const el = this._eyes[i];
      el.setAttribute('cx', pos[i][0] + (i >= 2 ? (dirIndex === 1 ? 1.4 : dirIndex === 3 ? -1.4 : 0) : 0));
      el.setAttribute('cy', pos[i][1] + (i >= 2 ? (dirIndex === 2 ? 1.4 : dirIndex === 0 ? -1.4 : 0) : 0));
      el.setAttribute('visibility', 'visible');
    }
  }

  renderFood(food) {
    const g = this.foodLayer;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (food.x < 0) return;
    const c = this.cell;
    const cx = food.x * c + c / 2;
    const cy = food.y * c + c / 2;
    const grp = document.createElementNS(NS, 'g');

    const body = document.createElementNS(NS, 'circle');
    body.setAttribute('cx', cx);
    body.setAttribute('cy', cy + 1);
    body.setAttribute('r', c * 0.32);
    body.setAttribute('fill', COLORS.food);
    grp.appendChild(body);

    const stem = document.createElementNS(NS, 'rect');
    stem.setAttribute('x', cx - 1.2);
    stem.setAttribute('y', cy - c * 0.32 - 2);
    stem.setAttribute('width', 2.4);
    stem.setAttribute('height', 5);
    stem.setAttribute('rx', 1.1);
    stem.setAttribute('fill', COLORS.stem);
    grp.appendChild(stem);

    const leaf = document.createElementNS(NS, 'path');
    const ly = cy - c * 0.32 - 1;
    leaf.setAttribute('d', `M${cx + 1.4} ${ly} c 4 -3.4 8 -1.6 7 1.8 c -1 2.8 -5.4 2.6 -7 -1.8 z`);
    leaf.setAttribute('fill', COLORS.leaf);
    grp.appendChild(leaf);

    g.appendChild(grp);
  }

  /** Short expanding ring where food was eaten. Skipped under reduced motion. */
  eatPulse(x, y, reducedMotion) {
    if (reducedMotion) return;
    const c = this.cell;
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', x * c + c / 2);
    ring.setAttribute('cy', y * c + c / 2);
    ring.setAttribute('r', 6);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', COLORS.pulse);
    ring.setAttribute('stroke-width', 3);
    this.fxLayer.appendChild(ring);
    const anim = ring.animate(
      [{ r: '6', opacity: 0.9 }, { r: '26', opacity: 0 }],
      { duration: 320, easing: 'ease-out', fill: 'forwards' },
    );
    const cleanup = () => { try { ring.remove(); } catch { /* noop */ } };
    if (anim && anim.finished) anim.finished.then(cleanup, cleanup);
    else setTimeout(cleanup, 340);
  }

  clearAll() {
    for (const layer of [this.snakeLayer, this.foodLayer, this.fxLayer]) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
    this._segPool.length = 0;
    this._eyes = null;
  }
}

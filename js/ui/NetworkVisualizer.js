'use strict';

import { INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE, PARAM_COUNT } from '../ai/NetworkConfig.js';

/**
 * NetworkVisualizer — draws one network (typically the champion) as SVG:
 * nodes per layer, edges tinted/weighted by sign and magnitude.
 * Renders a single network, never the whole population.
 */
const NS = 'http://www.w3.org/2000/svg';

export class NetworkVisualizer {
  constructor(svgEl, { width = 640, height = 240 } = {}) {
    this.svg = svgEl;
    this.W = width;
    this.H = height;
  }

  /** net: NeuralNetwork (reads .params via LAYOUT offsets through serialize-free access). */
  render(net) {
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const layers = [INPUT_SIZE, HIDDEN1, HIDDEN2, OUTPUT_SIZE];
    const xs = [50, 240, 440, 590];
    const pos = (li, ni) => {
      const n = layers[li];
      const usable = this.H - 30;
      const gap = usable / (n + 1);
      return { x: xs[li], y: 15 + gap * (ni + 1) };
    };

    const p = net.params;
    const w1 = INPUT_SIZE * HIDDEN1;
    const b1 = w1 + HIDDEN1;
    const w2 = b1 + HIDDEN1 * HIDDEN2;
    const b2 = w2 + HIDDEN1 * HIDDEN2;
    const w3 = b2 + HIDDEN2 * OUTPUT_SIZE;

    const edge = (x1, y1, x2, y2, w) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', w >= 0 ? '#15803d' : '#b91c1c');
      l.setAttribute('stroke-width', 0.6);
      l.setAttribute('stroke-opacity', Math.min(0.55, 0.08 + Math.abs(w) * 0.25).toFixed(2));
      svg.appendChild(l);
    };

    // Edges (all of them — 447 lines is cheap for SVG)
    for (let i = 0; i < INPUT_SIZE; i++) {
      const a = pos(0, i);
      for (let j = 0; j < HIDDEN1; j++) {
        const b = pos(1, j);
        edge(a.x, a.y, b.x, b.y, p[i * HIDDEN1 + j]);
      }
    }
    for (let i = 0; i < HIDDEN1; i++) {
      const a = pos(1, i);
      for (let j = 0; j < HIDDEN2; j++) {
        const b = pos(2, j);
        edge(a.x, a.y, b.x, b.y, p[b1 + i * HIDDEN2 + j]);
      }
    }
    for (let i = 0; i < HIDDEN2; i++) {
      const a = pos(2, i);
      for (let j = 0; j < OUTPUT_SIZE; j++) {
        const b = pos(3, j);
        edge(a.x, a.y, b.x, b.y, p[b2 + i * OUTPUT_SIZE + j]);
      }
    }

    // Nodes
    const node = (li, ni, r, fill) => {
      const { x, y } = pos(li, ni);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', r);
      c.setAttribute('fill', fill);
      c.setAttribute('stroke', '#555');
      c.setAttribute('stroke-width', 0.8);
      svg.appendChild(c);
    };
    for (let i = 0; i < INPUT_SIZE; i++) node(0, i, 5, '#fff');
    for (let i = 0; i < HIDDEN1; i++) node(1, i, 4.5, '#fff');
    for (let i = 0; i < HIDDEN2; i++) node(2, i, 4.5, '#fff');
    for (let i = 0; i < OUTPUT_SIZE; i++) node(3, i, 6, '#dbeafe');

    // Labels
    const label = (x, y, text) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('font-size', 10);
      t.setAttribute('fill', '#777');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = text;
      svg.appendChild(t);
    };
    label(50, this.H - 2, `in ${INPUT_SIZE}`);
    label(240, this.H - 2, `h1 ${HIDDEN1}`);
    label(440, this.H - 2, `h2 ${HIDDEN2}`);
    label(590, this.H - 2, `out ${OUTPUT_SIZE} (L/S/R)`);
  }

  clear() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
  }
}

'use strict';

/**
 * NetworkVisualizer — draws one network (typically the champion) as SVG:
 * nodes per layer, edges tinted by sign and weighted by magnitude.
 * Adapts to ANY hidden architecture; colors come from CSS variables so the
 * inspector follows the active theme. Renders a single network, never a population.
 */
const NS = 'http://www.w3.org/2000/svg';

export class NetworkVisualizer {
  constructor(svgEl, { width = 640, height = 240 } = {}) {
    this.svg = svgEl;
    this.W = width;
    this.H = height;
  }

  /** net: NeuralNetwork (uses net.dims and net.layout offsets). */
  render(net) {
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const dims = net.shape;
    const layers = dims.length;
    const pad = 50;
    const usableW = this.W - pad * 2;
    const xs = Array.from({ length: layers }, (_, l) =>
      layers === 1 ? this.W / 2 : pad + (usableW * l) / (layers - 1));

    const pos = (li, ni) => {
      const n = dims[li];
      const usable = this.H - 30;
      const gap = usable / (n + 1);
      return { x: xs[li], y: 15 + gap * (ni + 1) };
    };

    const p = net.params;
    const L = net.layout;

    const edge = (x1, y1, x2, y2, w) => {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', w >= 0 ? 'var(--viz-pos)' : 'var(--viz-neg)');
      line.setAttribute('stroke-width', 0.6);
      line.setAttribute('stroke-opacity', Math.min(0.55, 0.08 + Math.abs(w) * 0.25).toFixed(2));
      svg.appendChild(line);
    };

    // All edges — a few thousand lines is still cheap for SVG at these limits.
    for (let l = 0; l < L.length; l++) {
      const { w: wOff, inSize, outSize } = L[l];
      for (let i = 0; i < inSize; i++) {
        const a = pos(l, i);
        for (let j = 0; j < outSize; j++) {
          const b = pos(l + 1, j);
          edge(a.x, a.y, b.x, b.y, p[wOff + i * outSize + j]);
        }
      }
    }

    // Nodes
    const node = (li, ni, r, fill) => {
      const { x, y } = pos(li, ni);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', r);
      c.setAttribute('fill', fill);
      c.setAttribute('stroke', 'var(--viz-node-stroke)');
      c.setAttribute('stroke-width', 0.8);
      svg.appendChild(c);
    };
    for (let l = 0; l < layers; l++) {
      const outLayer = l === layers - 1;
      for (let i = 0; i < dims[l]; i++) {
        node(l, i, l === 0 ? 5 : outLayer ? 6 : 4.5, outLayer ? 'var(--viz-out)' : 'var(--viz-node)');
      }
    }

    // Labels
    const label = (x, text) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', this.H - 2);
      t.setAttribute('font-size', 10);
      t.setAttribute('fill', 'var(--muted)');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = text;
      svg.appendChild(t);
    };
    dims.forEach((n, l) => {
      const tag = l === 0 ? 'in' : l === layers - 1 ? 'out' : `h${l}`;
      label(xs[l], `${tag} ${n}${l === layers - 1 ? ' (L/S/R)' : ''}`);
    });
  }

  clear() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
  }
}

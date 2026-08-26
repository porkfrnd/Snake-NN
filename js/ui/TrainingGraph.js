'use strict';

/**
 * TrainingGraph — bounded-history SVG line chart (best/avg fitness per generation).
 * Hand-rolled: axes auto-scale from real data, history decimated past the cap.
 */
const NS = 'http://www.w3.org/2000/svg';

export class TrainingGraph {
  constructor(svgEl, { limit = 400, width = 640, height = 180 } = {}) {
    this.svg = svgEl;
    this.limit = limit;
    this.W = width;
    this.H = height;
    this.pad = { l: 44, r: 10, t: 12, b: 20 };
    this.points = []; // { gen, best, avg }
    this.stride = 1;
    this._build();
  }

  _build() {
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const mk = (tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
      return el;
    };
    this._plot = mk('rect', { x: this.pad.l, y: this.pad.t, width: this.W - this.pad.l - this.pad.r, height: this.H - this.pad.t - this.pad.b, fill: 'none', stroke: '#d8d8d2' });
    this._grid1 = mk('line', { stroke: '#efefe9', 'stroke-width': 1 });
    this._grid2 = mk('line', { stroke: '#efefe9', 'stroke-width': 1 });
    this._best = mk('polyline', { fill: 'none', stroke: '#15803d', 'stroke-width': 1.8, 'stroke-linejoin': 'round' });
    this._avg = mk('polyline', { fill: 'none', stroke: '#8b8b84', 'stroke-width': 1.4, 'stroke-dasharray': '4 3' });
    this._yMax = mk('text', { x: 6, y: this.pad.t + 10, 'font-size': 10, fill: '#777' });
    this._yMid = mk('text', { x: 6, y: this.H / 2, 'font-size': 10, fill: '#777' });
    this._yMin = mk('text', { x: 6, y: this.H - this.pad.b, 'font-size': 10, fill: '#777' });
    this._xMax = mk('text', { x: this.W - this.pad.r, y: this.H - 6, 'font-size': 10, fill: '#777', 'text-anchor': 'end' });
    this._legend = mk('text', { x: this.pad.l + 8, y: this.pad.t + 14, 'font-size': 10, fill: '#777' });
    this._legend.textContent = '— best   ┄ avg';
  }

  reset() {
    this.points.length = 0;
    this.stride = 1;
    this._render();
  }

  push(gen, best, avg) {
    this.points.push({ gen, best, avg });
    if (this.points.length > this.limit) {
      this.points = this.points.filter((_, i) => i % 2 === 0);
      this.stride *= 2;
    }
    this._render();
  }

  _render() {
    const { points: P } = this;
    const iw = this.W - this.pad.l - this.pad.r;
    const ih = this.H - this.pad.t - this.pad.b;

    if (P.length < 2) {
      this._best.setAttribute('points', '');
      this._avg.setAttribute('points', '');
      this._yMax.textContent = ''; this._yMid.textContent = ''; this._yMin.textContent = '';
      this._xMax.textContent = P.length ? `gen ${P[P.length - 1].gen}` : '';
      return;
    }

    let min = Infinity, max = -Infinity;
    for (const p of P) { if (p.best < min) min = p.best; if (p.best > max) max = p.best; if (p.avg < min) min = p.avg; if (p.avg > max) max = p.avg; }
    if (!Number.isFinite(min)) { min = 0; }
    if (!Number.isFinite(max) || max === min) max = min + 1;
    const padY = (max - min) * 0.08;

    const x = (i) => this.pad.l + (i / (P.length - 1)) * iw;
    const y = (v) => this.pad.t + ih - ((v - (min - padY)) / ((max + padY) - (min - padY))) * ih;

    this._best.setAttribute('points', P.map((p, i) => `${x(i).toFixed(1)},${y(p.best).toFixed(1)}`).join(' '));
    this._avg.setAttribute('points', P.map((p, i) => `${x(i).toFixed(1)},${y(Number.isFinite(p.avg) ? p.avg : min).toFixed(1)}`).join(' '));

    const fmtN = (v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);
    this._yMax.textContent = fmtN(max);
    this._yMid.textContent = fmtN((max + min) / 2);
    this._yMin.textContent = fmtN(min);
    this._xMax.textContent = `gen ${P[P.length - 1].gen}`;
    this._grid1.setAttribute('x1', this.pad.l); this._grid1.setAttribute('x2', this.W - this.pad.r);
    this._grid1.setAttribute('y1', this.pad.t + ih / 2); this._grid1.setAttribute('y2', this.pad.t + ih / 2);
    this._grid2.setAttribute('x1', this.pad.l + iw / 2); this._grid2.setAttribute('x2', this.pad.l + iw / 2);
    this._grid2.setAttribute('y1', this.pad.t); this._grid2.setAttribute('y2', this.H - this.pad.b);
  }
}

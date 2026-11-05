// Generates the original isometric SVG art in frontend/assets/sprites/.
// Run from anywhere with: node tools/make-sprites.js
//
// Every sprite is drawn around a ground origin (0,0), one grid cell = 40 x 20 px on screen, which
// matches iso-layout.js. The origin is stored on the <svg> as data-ax / data-ay so the map can
// stand a sprite on its grid point. Windows that light up at night go in <g class="lights">.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'frontend', 'assets', 'sprites');
const HW = 20, HH = 10;
const OUTLINE = '#20242e';

const iso = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1))));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

class Art {
  constructor() { this.parts = []; this.lights = []; this.min = [1e9, 1e9]; this.max = [-1e9, -1e9]; }
  see(p) {
    this.min = [Math.min(this.min[0], p[0]), Math.min(this.min[1], p[1])];
    this.max = [Math.max(this.max[0], p[0]), Math.max(this.max[1], p[1])];
  }
  poly(points, fill, opts = {}) {
    points.forEach((q) => this.see(q));
    const pts = points.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
    const stroke = opts.stroke === false ? '' : ` stroke="${opts.stroke || OUTLINE}" stroke-width="${opts.sw || 0.9}" stroke-linejoin="round"`;
    (opts.light ? this.lights : this.parts).push(`<polygon points="${pts}" fill="${fill}"${stroke}/>`);
  }
  // Axis-aligned block. Only the three faces a viewer can see are drawn.
  box(x, y, w, d, h, color, z = 0, opts = {}) {
    this.poly([iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)], opts.left || shade(color, 0.82));
    this.poly([iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)], opts.right || shade(color, 0.62));
    this.poly([iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], opts.top || shade(color, 1.18));
  }
  // Decal on the screen-left face (the y+d side): u runs along x, v is height.
  left(b, u0, u1, v0, v1, fill, opts) {
    const Y = b.y + b.d, z = b.z || 0;
    this.poly([iso(b.x + u0, Y, z + v1), iso(b.x + u1, Y, z + v1), iso(b.x + u1, Y, z + v0), iso(b.x + u0, Y, z + v0)], fill, opts);
  }
  // Decal on the screen-right face (the x+w side): u runs along y from the back.
  right(b, u0, u1, v0, v1, fill, opts) {
    const X = b.x + b.w, z = b.z || 0;
    this.poly([iso(X, b.y + u0, z + v1), iso(X, b.y + u1, z + v1), iso(X, b.y + u1, z + v0), iso(X, b.y + u0, z + v0)], fill, opts);
  }
  // A grid of windows on both visible faces. Every second-ish window also lights up at night.
  windows(b, cols, rows, glass, opts = {}) {
    const bottom = opts.bottom === undefined ? 4 : opts.bottom, top = opts.top === undefined ? 3 : opts.top;
    const rowH = (b.h - bottom - top) / rows;
    const sides = [[this.left.bind(this), b.w, cols], [this.right.bind(this), b.d, opts.colsRight || cols]];
    sides.forEach(([face, len, n], s) => {
      const colW = len / n;
      for (let c = 0; c < n; c++) {
        for (let r = 0; r < rows; r++) {
          const u0 = c * colW + colW * 0.2, u1 = c * colW + colW * 0.8;
          const v0 = bottom + r * rowH + rowH * 0.2, v1 = bottom + r * rowH + rowH * 0.82;
          face(b, u0, u1, v0, v1, glass, { stroke: false });
          if ((c * 3 + r * 5 + s) % 3 !== 2) face(b, u0, u1, v0, v1, '#ffd76a', { stroke: false, light: true });
        }
      }
    });
  }
  gableX(x, y, w, d, top, rise, color) {
    const o = 0.07;
    const X0 = x - o, X1 = x + w + o, Y0 = y - o, Y1 = y + d + o, M = y + d / 2;
    this.poly([iso(X0, Y0, top), iso(X1, Y0, top), iso(X1, M, top + rise), iso(X0, M, top + rise)], shade(color, 0.72));
    this.poly([iso(X1, Y0, top), iso(X1, Y1, top), iso(X1, M, top + rise)], '#efe3c8');
    this.poly([iso(X0, M, top + rise), iso(X1, M, top + rise), iso(X1, Y1, top), iso(X0, Y1, top)], color);
  }
  gableY(x, y, w, d, top, rise, color) {
    const o = 0.07;
    const X0 = x - o, X1 = x + w + o, Y0 = y - o, Y1 = y + d + o, M = x + w / 2;
    this.poly([iso(X0, Y0, top), iso(X0, Y1, top), iso(M, Y1, top + rise), iso(M, Y0, top + rise)], shade(color, 0.72));
    this.poly([iso(X0, Y1, top), iso(X1, Y1, top), iso(M, Y1, top + rise)], '#efe3c8');
    this.poly([iso(M, Y0, top + rise), iso(M, Y1, top + rise), iso(X1, Y1, top), iso(X1, Y0, top)], shade(color, 0.86));
  }
  cyl(x, y, r, h, color, z = 0) {
    const [cx, by] = iso(x, y, z), ty = by - h, rx = r * HW * 1.414, ry = r * HH * 1.414;
    [[cx - rx, ty - ry], [cx + rx, by + ry]].forEach((q) => this.see(q));
    const line = `stroke="${OUTLINE}" stroke-width="0.9"`;
    this.parts.push(`<path d="M${cx - rx} ${ty} V${by} A${rx} ${ry} 0 0 0 ${cx + rx} ${by} V${ty} Z" fill="${shade(color, 0.76)}" ${line}/>`);
    this.parts.push(`<ellipse cx="${cx}" cy="${ty}" rx="${rx}" ry="${ry}" fill="${shade(color, 1.2)}" ${line}/>`);
  }
  // A flat cross or square lying on a roof.
  flat(x, y, w, d, z, fill) {
    this.poly([iso(x, y, z), iso(x + w, y, z), iso(x + w, y + d, z), iso(x, y + d, z)], fill, { stroke: false });
  }
  svg() {
    const pad = 2;
    const x0 = Math.floor(this.min[0] - pad), y0 = Math.floor(this.min[1] - pad);
    const w = Math.ceil(this.max[0] + pad) - x0, h = Math.ceil(this.max[1] + pad) - y0;
    const lights = this.lights.length ? `\n<g class="lights">${this.lights.join('')}</g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}" data-ax="${-x0}" data-ay="${-y0}">\n${this.parts.join('\n')}${lights}\n</svg>\n`;
  }
}

function make(name, draw) {
  const a = new Art();
  draw(a);
  fs.writeFileSync(path.join(OUT, name + '.svg'), a.svg());
}

const GLASS = '#34506e';
const GLASS_BLUE = '#3b7fb8';

function door(a, b, color = '#6b4226') { a.left(b, b.w * 0.4, b.w * 0.62, 0, 10, color); }

// ---- homes -------------------------------------------------------------------------------

make('house-a', (a) => {
  const b = { x: -0.55, y: -0.5, w: 1.1, d: 1.0, h: 15 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#f2dcae');
  door(a, b);
  a.windows(b, 2, 1, GLASS, { colsRight: 2, bottom: 5, top: 3 });
  a.gableX(b.x, b.y, b.w, b.d, b.h, 13, '#d9553f');
});

make('house-b', (a) => {
  const b = { x: -0.5, y: -0.55, w: 1.0, d: 1.1, h: 14 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#cfe3e8');
  door(a, b, '#32566e');
  a.right(b, 0.2, 0.5, 5, 11, GLASS, { stroke: false });
  a.right(b, 0.2, 0.5, 5, 11, '#ffd76a', { stroke: false, light: true });
  a.right(b, 0.65, 0.95, 5, 11, GLASS, { stroke: false });
  a.box(-0.32, 0.02, 0.2, 0.2, 26, '#a6573f', 6);
  a.gableY(b.x, b.y, b.w, b.d, b.h, 12, '#3f7fc4');
});

make('house-c', (a) => {
  const b = { x: -0.52, y: -0.5, w: 1.04, d: 1.0, h: 26 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#f0b860');
  door(a, b, '#7a3f2b');
  a.windows(b, 2, 2, GLASS, { bottom: 5 });
  a.box(-0.56, -0.54, 1.12, 1.08, 3, '#b5553b', 26);
});

// ---- commercial --------------------------------------------------------------------------

make('tower-a', (a) => {
  const b = { x: -0.6, y: -0.6, w: 1.2, d: 1.2, h: 74 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#5fa7dc');
  a.windows(b, 4, 9, GLASS_BLUE, { bottom: 5, top: 4 });
  a.left(b, 0.46, 0.76, 0, 9, '#23405c');
  a.box(-0.42, -0.42, 0.84, 0.84, 5, '#d7e4ee', 74);
  a.flat(-0.22, -0.22, 0.44, 0.44, 79, '#e4574b');
  a.box(-0.03, -0.03, 0.06, 0.06, 13, '#9aa5b1', 79);
});

make('tower-b', (a) => {
  const b = { x: -0.58, y: -0.58, w: 1.16, d: 1.16, h: 40 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#c98a6b');
  a.windows(b, 3, 4, GLASS, { bottom: 6 });
  a.left(b, 0.42, 0.74, 0, 9, '#3c2a22');
  const c = { x: -0.42, y: -0.42, w: 0.84, d: 0.84, h: 22, z: 40 };
  a.box(c.x, c.y, c.w, c.d, c.h, '#d6a184', 40);
  a.windows(c, 2, 2, GLASS, { bottom: 2, top: 2 });
  a.box(-0.26, -0.26, 0.52, 0.52, 10, '#7f4e39', 62);
  a.box(-0.04, -0.04, 0.08, 0.08, 10, '#e0c15f', 72);
});

make('office', (a) => {
  const b = { x: -0.58, y: -0.52, w: 1.16, d: 1.04, h: 38 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#b9c6cf');
  a.windows(b, 3, 3, GLASS_BLUE, { bottom: 8, top: 3 });
  a.left(b, 0.38, 0.78, 0, 7, '#2e3d4a');
  a.box(-0.3, -0.25, 0.42, 0.34, 6, '#8a97a2', 38);
});

function stripes(a, x0, x1, y0, y1, zLow, zHigh, c1, c2, n) {
  for (let i = 0; i < n; i++) {
    const u0 = x0 + ((x1 - x0) * i) / n, u1 = x0 + ((x1 - x0) * (i + 1)) / n;
    a.poly([iso(u0, y0, zHigh), iso(u1, y0, zHigh), iso(u1, y1, zLow), iso(u0, y1, zLow)], i % 2 ? c2 : c1, { sw: 0.6 });
  }
}

make('stall', (a) => {
  const b = { x: -0.48, y: -0.36, w: 0.96, d: 0.72, h: 11 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#b0764a');
  a.left(b, 0.1, 0.86, 3, 9, '#51321f', { stroke: false });
  [[-0.3, 0.42, '#d9463e'], [-0.04, 0.46, '#f2b134'], [0.24, 0.42, '#66b04a']].forEach(([x, y, c]) => a.box(x, y, 0.2, 0.18, 6, c));
  stripes(a, -0.56, 0.56, -0.42, 0.56, 13, 22, '#ee5f4e', '#fff4e0', 6);
});

make('coffee', (a) => {
  const b = { x: -0.6, y: -0.48, w: 1.2, d: 0.96, h: 19 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#8a5a3c');
  a.left(b, 0.08, 0.42, 3, 13, GLASS, { stroke: false });
  a.left(b, 0.08, 0.42, 3, 13, '#ffd76a', { stroke: false, light: true });
  a.left(b, 0.5, 0.74, 0, 12, '#3b2417');
  a.left(b, 0.8, 1.12, 3, 13, GLASS, { stroke: false });
  a.right(b, 0.2, 0.76, 4, 13, GLASS, { stroke: false });
  a.right(b, 0.2, 0.76, 4, 13, '#ffd76a', { stroke: false, light: true });
  stripes(a, -0.66, 0.66, 0.5, 0.74, 11, 17, '#2e8b6e', '#f4efe3', 8);
  // the big cup on the roof
  a.cyl(0, 0, 0.26, 10, '#fff7ea', 19);
  a.cyl(0, 0, 0.19, 1, '#5a3620', 29);
  const [cx, cy] = iso(0.33, 0, 25);
  a.see([cx + 8, cy + 8]);
  a.parts.push(`<circle cx="${cx}" cy="${cy}" r="3.6" fill="none" stroke="#fff7ea" stroke-width="2.2"/>`);
});

// ---- industrial --------------------------------------------------------------------------

make('factory', (a) => {
  const b = { x: -0.95, y: -0.68, w: 1.9, d: 1.36, h: 20 };
  a.cyl(-0.62, -0.32, 0.16, 54, '#b4544a', 12);
  a.cyl(-0.14, -0.32, 0.14, 46, '#8d969f', 12);
  a.box(b.x, b.y, b.w, b.d, b.h, '#8e9aa5');
  a.windows(b, 5, 1, '#4a5864', { colsRight: 3, bottom: 8, top: 4 });
  a.right(b, 0.42, 0.94, 0, 12, '#535f6a');
  // saw-tooth roof
  for (let i = 0; i < 3; i++) {
    const x0 = b.x + (i * b.w) / 3, x1 = b.x + ((i + 1) * b.w) / 3;
    a.poly([iso(x0, b.y, 20), iso(x0, b.y + b.d, 20), iso(x0 + 0.1, b.y + b.d, 32), iso(x0 + 0.1, b.y, 32)], '#a6d3ea');
    a.poly([iso(x0 + 0.1, b.y, 32), iso(x0 + 0.1, b.y + b.d, 32), iso(x1, b.y + b.d, 20), iso(x1, b.y, 20)], '#c0c8ce');
  }
});

make('warehouse', (a) => {
  const b = { x: -0.72, y: -0.55, w: 1.44, d: 1.1, h: 17 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#b58f55');
  a.left(b, 0.2, 0.74, 0, 12, '#6d675f');
  for (let v = 2; v < 12; v += 2.5) a.left(b, 0.2, 0.74, v, v + 0.6, '#4f4a44', { stroke: false });
  a.left(b, 0.9, 1.26, 5, 11, GLASS, { stroke: false });
  a.left(b, 0.9, 1.26, 5, 11, '#ffd76a', { stroke: false, light: true });
  a.gableX(b.x, b.y, b.w, b.d, b.h, 10, '#5c7f96');
});

// ---- hazardous sites ---------------------------------------------------------------------

function redCross(a, cx, cy, z, s) {
  a.flat(cx - s, cy - s / 3, s * 2, (s * 2) / 3, z, '#d62f35');
  a.flat(cx - s / 3, cy - s, (s * 2) / 3, s * 2, z, '#d62f35');
}

make('clinic', (a) => {
  const b = { x: -0.92, y: -0.75, w: 1.84, d: 1.5, h: 30 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#f4f6f8');
  a.windows(b, 5, 2, '#5b89ad', { colsRight: 4, bottom: 11, top: 3 });
  a.left(b, 0.62, 1.22, 0, 10, '#2f6d94');
  a.left(b, 0.82, 1.02, 11, 19, '#d62f35', { stroke: false });
  a.left(b, 0.74, 1.1, 13.5, 16.5, '#d62f35', { stroke: false });
  a.box(-0.92, 0.75, 1.84, 0.12, 2, '#d62f35', 10);
  redCross(a, 0, 0, 30.1, 0.42);
});

make('lab', (a) => {
  a.cyl(-0.55, -0.4, 0.22, 28, '#d7e3e6');
  const b = { x: -0.78, y: -0.58, w: 1.56, d: 1.16, h: 22 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#7fc7c0');
  a.windows(b, 4, 1, '#2e6f6c', { colsRight: 3, bottom: 8, top: 4 });
  a.left(b, 0.62, 0.96, 0, 11, '#25504e');
  // a flask on the roof
  a.poly([iso(0.0, 0, 44), iso(0.1, 0, 44), iso(0.1, 0, 36), iso(0.36, 0, 24), iso(-0.26, 0, 24), iso(0.0, 0, 36)], '#e9fbff');
  a.poly([iso(0.27, 0, 27), iso(0.36, 0, 24), iso(-0.26, 0, 24), iso(-0.17, 0, 27)], '#6ad36e', { stroke: false });
});

make('workshop', (a) => {
  const b = { x: -0.82, y: -0.66, w: 1.64, d: 1.32, h: 20 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#d98b3f');
  a.left(b, 0.26, 1.0, 0, 14, '#4d4a45');
  for (let v = 2; v < 14; v += 3) a.left(b, 0.26, 1.0, v, v + 0.8, '#37342f', { stroke: false });
  a.right(b, 0.3, 0.95, 7, 15, GLASS, { stroke: false });
  a.right(b, 0.3, 0.95, 7, 15, '#ffd76a', { stroke: false, light: true });
  a.gableY(b.x, b.y, b.w, b.d, b.h, 9, '#5f6a73');
  a.cyl(0.72, 0.86, 0.13, 13, '#f0c52d');
  a.cyl(0.42, 0.9, 0.13, 13, '#3f4a55');
});

make('hazard-sign', (a) => {
  a.box(-0.03, -0.03, 0.06, 0.06, 14, '#59524a');
  const [cx, cy] = iso(0, 0, 25);
  a.poly([[cx, cy - 10], [cx + 10, cy + 8], [cx - 10, cy + 8]], '#ffd21f', { sw: 1.4 });
  a.poly([[cx - 1.4, cy - 3], [cx + 1.4, cy - 3], [cx + 0.8, cy + 3], [cx - 0.8, cy + 3]], '#20242e', { stroke: false });
  a.poly([[cx - 1.3, cy + 4.2], [cx + 1.3, cy + 4.2], [cx + 1.3, cy + 6.4], [cx - 1.3, cy + 6.4]], '#20242e', { stroke: false });
});

// Marks every disposal site, the place a truck finishes its route.
make('disposal-sign', (a) => {
  a.box(-0.03, -0.03, 0.06, 0.06, 15, '#59524a');
  const [cx, cy] = iso(0, 0, 26);
  a.see([cx - 12, cy - 12]); a.see([cx + 12, cy + 12]);
  a.parts.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="#0f9d8a" stroke="#20242e" stroke-width="1.4"/>`);
  a.parts.push(`<path d="M${cx - 2} ${cy - 7} h4 v6 h3.5 l-5.5 5.5 l-5.5 -5.5 h3.5 Z" fill="#fff"/>`);
  a.parts.push(`<rect x="${cx - 6.5}" y="${cy + 6}" width="13" height="2" rx="1" fill="#fff"/>`);
});

// ---- depot and disposal sites -------------------------------------------------------------

make('depot', (a) => {
  const W = '#8d8577', S = 1.4;
  a.flat(-S, -S, S * 2, S * 2, 0, '#a9a395');
  a.box(-S, -S, S * 2, 0.14, 11, W);
  a.box(-S, -S + 0.14, 0.14, S * 2 - 0.14, 11, W);
  const shed = { x: -1.15, y: -1.15, w: 1.5, d: 1.2, h: 26 };
  a.box(shed.x, shed.y, shed.w, shed.d, shed.h, '#3f7d58');
  a.left(shed, 0.15, 0.68, 0, 18, '#22302a');
  a.left(shed, 0.82, 1.35, 0, 18, '#22302a');
  a.right(shed, 0.2, 1.0, 12, 21, GLASS, { stroke: false });
  a.right(shed, 0.2, 1.0, 12, 21, '#ffd76a', { stroke: false, light: true });
  a.gableX(shed.x, shed.y, shed.w, shed.d, shed.h, 12, '#27593f');
  a.cyl(0.85, -0.85, 0.3, 20, '#c3c9cf');
  a.box(-1.0, 0.3, 0.42, 0.85, 7, '#67b84c', 1);
  a.box(-1.0, 1.0, 0.42, 0.22, 11, '#f3f3ee', 1);
  a.box(S - 0.14, -S + 0.14, 0.14, S * 2 - 0.14, 11, W);
  a.box(-S, S - 0.14, 1.0, 0.14, 11, W);
  a.box(0.55, S - 0.14, S - 0.55, 0.14, 11, W);
  // gate arch across the opening
  a.box(-0.42, S - 0.18, 0.14, 0.2, 25, '#e0b02f');
  a.box(0.42, S - 0.18, 0.14, 0.2, 25, '#e0b02f');
  a.box(-0.42, S - 0.18, 0.98, 0.2, 7, '#e0b02f', 25);
});

function trashBag(a, x, y, c = '#3b4048') { a.cyl(x, y, 0.13, 7, c); }

make('disposal-general', (a) => {
  const mound = '#7b6e58';
  a.cyl(-0.5, -0.45, 0.68, 11, mound);
  a.cyl(-0.5, -0.45, 0.42, 7, shade(mound, 1.12), 11);
  const b = { x: -0.2, y: -0.25, w: 1.25, d: 0.88, h: 18 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#6e7c86');
  a.left(b, 0.12, 1.13, 6, 10, '#ffcf3f', { stroke: false });
  a.box(-0.2, -0.25, 1.25, 0.88, 2, '#454e55', 18);
  trashBag(a, 1.15, 0.86);
  trashBag(a, 0.72, 0.98, '#4a505a');
  trashBag(a, 0.28, 0.96);
});

make('disposal-recyclable', (a) => {
  const b = { x: -0.95, y: -0.8, w: 1.5, d: 1.25, h: 26 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#2d81c9');
  a.left(b, 0.3, 1.2, 0, 15, '#17476f');
  a.gableX(b.x, b.y, b.w, b.d, b.h, 9, '#1c639f');
  // recycling arrows on the side
  const R = b.x + b.w;
  [[0.2, 0.55, 12, 17], [0.55, 0.9, 12, 17], [0.37, 0.72, 18, 23]].forEach(([u0, u1, v0, v1]) => {
    a.poly([iso(R, b.y + u0, v0), iso(R, b.y + u1, v0), iso(R, b.y + (u0 + u1) / 2, v1)], '#9ff0a2', { stroke: false });
  });
  [[0.5, 0.75, '#e8c53e'], [0.95, 0.55, '#d9d9d9'], [0.95, 1.05, '#73c368']].forEach(([x, y, c]) => a.box(x, y, 0.36, 0.36, 12, c));
});

make('disposal-compost', (a) => {
  const wood = '#94673c';
  a.box(-1.1, -0.95, 2.1, 0.12, 13, wood);
  a.box(-1.1, -0.83, 0.12, 1.75, 13, wood);
  a.cyl(-0.22, -0.1, 0.75, 13, '#5a3d24');
  a.cyl(-0.22, -0.1, 0.5, 9, '#6c4a2b', 13);
  a.cyl(-0.22, -0.1, 0.24, 6, '#7f5935', 22);
  [[0.1, 0.5], [-0.45, 0.55], [0.5, 0.1]].forEach(([x, y]) => a.cyl(x, y, 0.08, 3, '#73b84b', 3));
  a.box(0.88, -0.83, 0.12, 1.75, 13, wood);
  a.box(-0.98, 0.8, 1.86, 0.12, 8, wood);
});

// An incinerator: dark brick and fire, so it can't be mistaken for the white clinic pickup sites.
make('disposal-medical', (a) => {
  a.cyl(-0.82, -0.82, 0.24, 76, '#6d5a52', 8);
  a.cyl(-0.82, -0.82, 0.25, 8, '#d62f35', 72);
  const b = { x: -1.0, y: -0.72, w: 1.9, d: 1.5, h: 26 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#6e4a3f');
  // the furnace mouth, glowing day and night
  a.left(b, 0.32, 1.12, 0, 15, '#2a1a15');
  a.left(b, 0.42, 1.02, 0, 11, '#ff7a1a', { stroke: false });
  a.left(b, 0.54, 0.9, 0, 7, '#ffd23f', { stroke: false });
  // a small plate marks it as the medical waste site
  a.left(b, 1.3, 1.72, 11, 21, '#f4f6f8');
  a.left(b, 1.46, 1.56, 12.5, 19.5, '#d62f35', { stroke: false });
  a.left(b, 1.37, 1.65, 14.5, 17.5, '#d62f35', { stroke: false });
  a.box(-0.4, -0.3, 0.9, 0.9, 6, '#4f3a33', 26);
});

make('disposal-chemical', (a) => {
  a.cyl(-0.68, -0.68, 0.42, 30, '#f0c52d');
  a.cyl(0.25, -0.75, 0.38, 26, '#e3e6e9');
  a.cyl(-0.75, 0.22, 0.38, 26, '#e3e6e9');
  a.box(-0.65, -0.74, 1.0, 0.07, 2, '#515b64', 26);
  const b = { x: -0.25, y: -0.15, w: 1.2, d: 1.05, h: 17 };
  a.box(b.x, b.y, b.w, b.d, b.h, '#60707b');
  a.left(b, 0.12, 1.08, 5, 9, '#20242e', { stroke: false });
  for (let i = 0; i < 6; i++) a.left(b, 0.12 + i * 0.16, 0.2 + i * 0.16, 5, 9, '#ffd21f', { stroke: false });
  a.right(b, 0.25, 0.8, 0, 12, '#3a444c');
  const [cx, cy] = iso(-0.68, -0.28, 17);
  a.poly([[cx, cy - 7], [cx + 7, cy], [cx, cy + 7], [cx - 7, cy]], '#ffd21f', { sw: 1.1 });
  a.poly([[cx - 1, cy - 3], [cx + 1, cy - 3], [cx + 0.6, cy + 1], [cx - 0.6, cy + 1]], '#20242e', { stroke: false });
  a.poly([[cx - 1, cy + 2], [cx + 1, cy + 2], [cx + 1, cy + 4], [cx - 1, cy + 4]], '#20242e', { stroke: false });
});

// ---- trucks ------------------------------------------------------------------------------

const TO_GRID = {
  se: (u, v) => [u, v],
  nw: (u, v) => [-u, -v],
  sw: (u, v) => [-v, u],
  ne: (u, v) => [v, -u],
};

function truck(a, dir, c) {
  const pieces = [];
  const add = (u0, u1, v0, v1, z, h, color, opts) => {
    const [x0, y0] = TO_GRID[dir](u0, v0), [x1, y1] = TO_GRID[dir](u1, v1);
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), d = Math.abs(y1 - y0);
    pieces.push({ x, y, w, d, z, h, color, opts, depth: x + w / 2 + y + d / 2 + z * 0.02 });
  };
  const V = 0.25;
  // wheels
  [[-0.42, -0.22], [0.18, 0.38]].forEach(([u0, u1]) => {
    add(u0, u1, -V - 0.02, -V + 0.1, 0, 4, '#1c1f25');
    add(u0, u1, V - 0.1, V + 0.02, 0, 4, '#1c1f25');
  });
  add(-0.6, 0.52, -V + 0.02, V - 0.02, 2, 3, '#3a3f47');           // chassis
  add(-0.6, 0.12, -V, V, 5, 11, c.body);                           // waste body
  add(-0.6, 0.12, -V - 0.005, V + 0.005, 8.5, 2.8, c.band);        // stripe
  add(0.16, 0.56, -V, V, 5, 6, c.cab);                             // cab
  add(0.2, 0.52, -V + 0.03, V - 0.03, 11, 5, '#22364a');           // windscreen band
  add(0.16, 0.56, -V, V, 16, 1.5, shade(c.cab, 1.15));             // cab roof
  if (c.beacon) add(0.3, 0.4, -0.05, 0.05, 17.5, 3, '#ff7a1a');
  add(-0.5, 0.02, -0.14, 0.14, 16, 2, shade(c.body, 0.8));         // hatch
  pieces.sort((p, q) => p.depth - q.depth).forEach((p) => a.box(p.x, p.y, p.w, p.d, p.h, p.color, p.z));
}

['se', 'sw', 'ne', 'nw'].forEach((dir) => {
  make('truck-normal-' + dir, (a) => truck(a, dir, { body: '#4fae3f', band: '#f1f6e8', cab: '#f4f4ee' }));
  make('truck-hazard-' + dir, (a) => truck(a, dir, { body: '#f0c21f', band: '#20242e', cab: '#e2492f', beacon: true }));
});

console.log('Wrote ' + fs.readdirSync(OUT).filter((f) => f.endsWith('.svg')).length + ' sprites to ' + OUT);

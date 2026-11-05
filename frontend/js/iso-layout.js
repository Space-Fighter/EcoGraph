// Turns the city (nodes, roads, localities) into an isometric plan. It has no drawing code, so
// tools/check-iso-layout.js can test it in Node.
//
//   * every locality is a box of grid cells, placed near its real Dehradun position;
//   * every node has a "hub": the road cell where trucks stop. Its buildings stand on the 3 x 3
//     plot behind the hub, so all four sides of the hub stay free for roads;
//   * every road is routed along the two grid axes by A*. It may only cross another road at a
//     right angle while running straight, which is where the map draws a bridge.
const IsoLayout = (() => {
  const HALF_W = 20, HALF_H = 10;   // half a grid cell on screen, in world pixels
  const SLOT = 6;                   // a node's slot: 3 cells of plot, a hub, 2 cells for roads
  const PLOT = 3;
  const LOCALITY_GAP = 6;           // free cells kept between two locality boxes
  const CELLS_PER_KM = 2.6;        // starting spread of the localities
  const MERGE_RADIUS = 4;           // roads sharing an end may run together this close to it
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const ZONE_ORDER = { arterial: 0, industrial: 1, commercial: 2, residential: 3 };
  const NO_DIR = 4;

  const toWorld = (x, y) => ({ x: (x - y) * HALF_W, y: (x + y) * HALF_H });
  const toGrid = (wx, wy) => ({ x: (wx / HALF_W + wy / HALF_H) / 2, y: (wy / HALF_H - wx / HALF_W) / 2 });

  function compareIds(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }

  // ---- localities --------------------------------------------------------------------------

  // North stays up on screen: east/south kilometres are rotated into grid axes.
  function geoToGrid(lat, lng) {
    const east = (lng - 78.0) * 111.32 * Math.cos((30.33 * Math.PI) / 180) * CELLS_PER_KM;
    const south = -(lat - 30.33) * 111.19 * CELLS_PER_KM;
    return { x: (east + 2 * south) / 2, y: (2 * south - east) / 2 };
  }

  function buildBoxes(nodes, areas) {
    const byArea = new Map();
    nodes.forEach((n) => {
      const key = n.area || '(unassigned)';
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key).push(n);
    });
    return Array.from(byArea.keys()).sort(compareIds).map((name) => {
      const members = byArea.get(name).sort((a, b) => compareIds(a.id, b.id));
      const known = areas.find((a) => a.name === name);
      let lat = 0, lng = 0;
      if (known) { lat = known.lat; lng = known.lng; }
      else {
        const located = members.filter((n) => typeof n.lat === 'number' && typeof n.lng === 'number');
        located.forEach((n) => { lat += n.lat / located.length; lng += n.lng / located.length; });
        if (!located.length) { lat = 30.33; lng = 78.0; }
      }
      const cols = Math.ceil(Math.sqrt(members.length));
      const rows = Math.ceil(members.length / cols);
      const w = cols * SLOT + 1, h = rows * SLOT + 1;
      const c = geoToGrid(lat, lng);
      return { name, zone: known ? known.zone : 'arterial', members, cols, rows, w, h,
               x: c.x - w / 2, y: c.y - h / 2, x0: c.x - w / 2, y0: c.y - h / 2 };
    });
  }

  // One round of pushing overlapping boxes apart along the cheaper axis. Returns the worst overlap.
  function pushApart(boxes, gap) {
    let worst = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) + gap - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) + gap - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue;
        worst = Math.max(worst, Math.min(ox, oy));
        if (ox < oy) {
          const s = (a.x + a.w / 2 <= b.x + b.w / 2 ? 1 : -1) * ox / 2;
          a.x -= s; b.x += s;
        } else {
          const s = (a.y + a.h / 2 <= b.y + b.h / 2 ? 1 : -1) * oy / 2;
          a.y -= s; b.y += s;
        }
      }
    }
    return worst;
  }

  // Separates the boxes with a faint pull back home, so the city keeps its recognisable shape.
  // The last phase has no pull and one spare cell of gap, so rounding to whole cells stays clear.
  function separateBoxes(boxes) {
    for (let iter = 0; iter < 600; iter++) {
      if (pushApart(boxes, LOCALITY_GAP) < 0.05) break;
      boxes.forEach((b) => { b.x += (b.x0 - b.x) * 0.003; b.y += (b.y0 - b.y) * 0.003; });
    }
    for (let iter = 0; iter < 5000; iter++) {
      if (pushApart(boxes, LOCALITY_GAP + 1.01) === 0) break;
    }
    boxes.forEach((b) => { b.x = Math.round(b.x); b.y = Math.round(b.y); });
  }

  // ---- node slots --------------------------------------------------------------------------

  function assignSlots(boxes, edges) {
    const hub = new Map();
    boxes.forEach((box) => {
      const slots = [];
      for (let r = 0; r < box.rows; r++) {
        for (let c = 0; c < box.cols; c++) {
          slots.push({ x: box.x + c * SLOT + 1 + PLOT, y: box.y + r * SLOT + 1 + PLOT });
        }
      }
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      slots.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) || a.x - b.x || a.y - b.y);
      const rank = { junction: 0, depot: 1, bin: 2, home: 3 };
      const ordered = box.members.slice().sort((a, b) => (rank[a.type] - rank[b.type]) || compareIds(a.id, b.id));
      ordered.forEach((n, i) => hub.set(n.id, { x: slots[i].x, y: slots[i].y }));
      box.free = slots.slice(ordered.length);
    });

    // Shorten roads by swapping nodes inside each locality: fewer crossings and bridges later.
    const roadsAt = new Map();
    edges.forEach((e) => {
      [e.from, e.to].forEach((id) => {
        if (!roadsAt.has(id)) roadsAt.set(id, []);
        roadsAt.get(id).push(e);
      });
    });
    const cost = (id, at) => (roadsAt.get(id) || []).reduce((sum, e) => {
      const other = e.from === id ? hub.get(e.to) : hub.get(e.from);
      return other ? sum + Math.abs(other.x - at.x) + Math.abs(other.y - at.y) : sum;
    }, 0);
    for (let pass = 0; pass < 12; pass++) {
      let improved = false;
      boxes.forEach((box) => {
        for (let i = 0; i < box.members.length; i++) {
          for (let j = i + 1; j < box.members.length; j++) {
            const a = box.members[i].id, b = box.members[j].id;
            const pa = hub.get(a), pb = hub.get(b);
            const before = cost(a, pa) + cost(b, pb);
            hub.set(a, pb); hub.set(b, pa);
            if (cost(a, pb) + cost(b, pa) < before - 1e-9) improved = true;
            else { hub.set(a, pa); hub.set(b, pb); }
          }
        }
      });
      if (!improved) break;
    }
    return hub;
  }

  // ---- road router -------------------------------------------------------------------------

  class MinHeap {
    constructor() { this.keys = []; this.vals = []; }
    get size() { return this.keys.length; }
    push(key, val) {
      const k = this.keys, v = this.vals;
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (k[p] <= key) break;
        k[i] = k[p]; v[i] = v[p];
        i = p;
      }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.keys, v = this.vals;
      const top = v[0], lastK = k.pop(), lastV = v.pop();
      const n = k.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lastK) break;
          k[i] = k[c]; v[i] = v[c];
          i = c;
        }
        k[i] = lastK; v[i] = lastV;
      }
      return top;
    }
  }

  class Router {
    constructor(hubs, plotCells, bounds) {
      this.ox = bounds.x0; this.oy = bounds.y0;
      this.w = bounds.x1 - bounds.x0 + 1; this.h = bounds.y1 - bounds.y0 + 1;
      const n = this.w * this.h;
      this.blocked = new Uint8Array(n);
      this.isHub = new Uint8Array(n);
      this.occ = new Array(n);
      this.best = new Float64Array(n * 5);
      this.from = new Int32Array(n * 5);
      this.roads = [];
      plotCells.forEach(([x, y]) => { this.blocked[this.idx(x, y)] = 1; });
      hubs.forEach((p) => { this.isHub[this.idx(p.x, p.y)] = 1; });
    }

    idx(x, y) { return (y - this.oy) * this.w + (x - this.ox); }

    // Step cost of driving into a cell, or Infinity if this search level does not allow it.
    enterCost(cellIdx, x, y, dir, road, level) {
      if (this.blocked[cellIdx]) return level >= 2 ? 60 : Infinity;
      if (this.isHub[cellIdx]) return level >= 1 ? 40 : Infinity;
      const here = this.occ[cellIdx];
      if (here && here.length) {
        const axis = dir % 2;
        let extra = 0;
        for (let i = 0; i < here.length; i++) {
          const o = here[i], other = this.roads[o.road];
          const shared = [road.a, road.b].find((p) => p === other.a || p === other.b);
          if (shared && Math.abs(shared.x - x) + Math.abs(shared.y - y) <= MERGE_RADIUS) { extra += 0.4; continue; }
          if (o.axis !== -1 && o.axis !== axis && here.length === 1) { extra += 5; continue; }
          if (level === 0) return Infinity;
          extra += 18;
        }
        return 1 + extra;
      }
      let beside = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0] - this.ox, ny = y + DIRS[d][1] - this.oy;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const near = this.occ[ny * this.w + nx];
        if (near && near.length) beside = 0.7;
      }
      return 1 + beside;
    }

    // True when this cell must be driven straight through: a crossing, not a junction.
    mustGoStraight(cellIdx, x, y, road) {
      const here = this.occ[cellIdx];
      if (!here || !here.length) return false;
      return here.some((o) => {
        const other = this.roads[o.road];
        const shared = [road.a, road.b].find((p) => p === other.a || p === other.b);
        return !(shared && Math.abs(shared.x - x) + Math.abs(shared.y - y) <= MERGE_RADIUS);
      });
    }

    search(road, level) {
      const { a, b } = road;
      const start = this.idx(a.x, a.y), goal = this.idx(b.x, b.y);
      this.best.fill(Infinity);
      const heap = new MinHeap();
      const startState = start * 5 + NO_DIR;
      this.best[startState] = 0;
      this.from[startState] = -1;
      heap.push(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), startState);
      while (heap.size) {
        const state = heap.pop();
        const cell = Math.floor(state / 5), dir = state % 5;
        const y = this.oy + Math.floor(cell / this.w), x = this.ox + (cell % this.w);
        if (cell === goal) return this.unwind(state);
        const g = this.best[state];
        const straightOnly = dir !== NO_DIR && level === 0 && this.mustGoStraight(cell, x, y, road);
        for (let d = 0; d < 4; d++) {
          if (dir !== NO_DIR && (d + 2) % 4 === dir) continue;
          if (straightOnly && d !== dir) continue;
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx < this.ox || ny < this.oy || nx >= this.ox + this.w || ny >= this.oy + this.h) continue;
          const ni = this.idx(nx, ny);
          const step = ni === goal ? 1 : this.enterCost(ni, nx, ny, d, road, level);
          if (step === Infinity) continue;
          const ng = g + step + (dir !== NO_DIR && d !== dir ? 0.6 : 0);
          const ns = ni * 5 + d;
          if (ng >= this.best[ns]) continue;
          this.best[ns] = ng;
          this.from[ns] = state;
          heap.push(ng + Math.abs(nx - b.x) + Math.abs(ny - b.y), ns);
        }
      }
      return null;
    }

    unwind(state) {
      const out = [];
      for (let s = state; s !== -1; s = this.from[s]) {
        const cell = Math.floor(s / 5);
        out.push({ x: this.ox + (cell % this.w), y: this.oy + Math.floor(cell / this.w) });
      }
      return out.reverse();
    }

    add(road) {
      this.roads.push(road);
      const index = this.roads.length - 1;
      let cells = null, level = 0;
      for (; level <= 2 && !cells; level++) cells = this.search(road, level);
      road.level = level - 1;
      road.cells = cells || [road.a, road.b];
      road.cells.forEach((c, i) => {
        if (i === 0 || i === road.cells.length - 1) return;
        const p = road.cells[i - 1], n = road.cells[i + 1];
        const axis = p.y === c.y && n.y === c.y ? 0 : p.x === c.x && n.x === c.x ? 1 : -1;
        const k = this.idx(c.x, c.y);
        (this.occ[k] = this.occ[k] || []).push({ road: index, axis });
      });
    }

    // Cells where two roads pass straight through each other at a right angle.
    crossings() {
      const out = [];
      for (let k = 0; k < this.occ.length; k++) {
        const here = this.occ[k];
        if (!here || here.length < 2 || this.isHub[k]) continue;
        for (let i = 0; i < here.length; i++) {
          for (let j = i + 1; j < here.length; j++) {
            const lo = here[i], hi = here[j];
            if (lo.axis === -1 || hi.axis === -1 || lo.axis === hi.axis) continue;
            out.push({ x: this.ox + (k % this.w), y: this.oy + Math.floor(k / this.w),
                       axis: hi.axis, over: hi.road, under: lo.road });
          }
        }
      }
      return out;
    }
  }

  function corners(cells) {
    if (cells.length < 3) return cells.slice();
    const out = [cells[0]];
    for (let i = 1; i < cells.length - 1; i++) {
      const p = cells[i - 1], c = cells[i], n = cells[i + 1];
      if (!((p.x === c.x && c.x === n.x) || (p.y === c.y && c.y === n.y))) out.push(c);
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  // ---- entry point -------------------------------------------------------------------------

  function compute(city) {
    const nodes = city.nodes || [], areas = city.areas || [];
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (city.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

    const boxes = buildBoxes(nodes, areas);
    separateBoxes(boxes);
    const hubs = assignSlots(boxes, edges);

    const plotCells = [];
    const plots = [];
    nodes.forEach((n) => {
      if (n.type === 'junction') return;
      const h = hubs.get(n.id);
      plots.push({ id: n.id, hx: h.x, hy: h.y, cx: h.x - 2, cy: h.y - 2 });
      for (let dx = 1; dx <= PLOT; dx++) {
        for (let dy = 1; dy <= PLOT; dy++) plotCells.push([h.x - dx, h.y - dy]);
      }
    });

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    boxes.forEach((b) => {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    if (!boxes.length) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
    const margin = 8;
    const bounds = { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };

    const router = new Router(Array.from(hubs.values()), plotCells, bounds);
    const manhattan = (e) => {
      const a = hubs.get(e.from), b = hubs.get(e.to);
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    };
    const order = edges.slice().sort((p, q) =>
      (ZONE_ORDER[p.zone] - ZONE_ORDER[q.zone]) || (manhattan(p) - manhattan(q)) ||
      compareIds(p.from + '|' + p.to, q.from + '|' + q.to));
    order.forEach((e) => {
      router.add({ from: e.from, to: e.to, zone: e.zone, weight: e.weight, a: hubs.get(e.from), b: hubs.get(e.to) });
    });

    const roads = router.roads.map((r) => ({
      from: r.from, to: r.to, zone: r.zone, weight: r.weight, level: r.level,
      points: corners(r.cells), cells: r.cells,
    }));

    return {
      hubs,
      plots,
      roads,
      crossings: router.crossings(),
      localities: boxes.map((b) => ({ name: b.name, zone: b.zone, x: b.x, y: b.y, w: b.w, h: b.h })),
      bounds,
      nodeZones: new Map(nodes.map((n) => [n.id, n.zone])),
    };
  }

  return { compute, toWorld, toGrid, HALF_W, HALF_H };
})();

if (typeof module !== 'undefined') module.exports = IsoLayout;

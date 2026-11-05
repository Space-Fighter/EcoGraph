// Paints everything on the map that never moves (grass, locality ground, plots, roads, bridges,
// trees) into one canvas. The map then only has to draw a single texture for all of it.
const MapBake = (() => {
  const MAX_SIDE = 6144;    // longest canvas side; keeps memory sensible with two baked maps
  const PADDING = 180;      // grass around the city, in world pixels
  const ROAD_WIDTH = { arterial: 0.9, industrial: 0.68, commercial: 0.46, residential: 0.46 };
  // Road edges and locality borders share these, and the legend in style.css matches them.
  const ZONE_COLOR = { arterial: '#ffb300', commercial: '#38bdf8', industrial: '#a855f7', residential: '#ff6fae' };
  const EDGE_WIDTH = 0.11;  // the coloured edge on each side of a road, in grid cells
  const KERB_WIDTH = 0.05;  // the thin dark line outside it

  const PALETTES = {
    day: {
      grass: '#63b043', tuftDark: '#569d39', tuftLight: '#79c455', flower: '#fff2a8',
      locality: { residential: '#7cc45a', commercial: '#b5c98a', industrial: '#a9a78a', arterial: '#7cc45a' },
      plot: { residential: '#d9c690', commercial: '#c6c0ad', industrial: '#a29d8b', depot: '#9b9587', bin: '#a89c80', hazard: '#d9cda5' },
      plotEdge: '#6f6749',
      road: '#d2c9b2', roadDark: '#b2a78e', kerb: '#655c49', centre: '#f2ead2',
      bridge: '#e6dcc2', rail: '#7a4f2a', shadow: 'rgba(25, 40, 15, .4)',
      treeA: '#3f8f35', treeB: '#57ad43', trunk: '#6b4a2b',
    },
    night: {
      grass: '#18333a', tuftDark: '#142c33', tuftLight: '#1f3e45', flower: '#46686a',
      locality: { residential: '#1e4144', commercial: '#2f4150', industrial: '#333b47', arterial: '#1e4144' },
      plot: { residential: '#3b4655', commercial: '#3e4656', industrial: '#3a404d', depot: '#3a404c', bin: '#3e4250', hazard: '#49505d' },
      plotEdge: '#171d28',
      road: '#5a6484', roadDark: '#4b5473', kerb: '#1a2031', centre: '#ffe9a8',
      bridge: '#6f799a', rail: '#2e2433', shadow: 'rgba(0, 5, 15, .55)',
      treeA: '#123335', treeB: '#1a4344', trunk: '#20242c',
    },
  };

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function worldBounds(plan) {
    const { x0, y0, x1, y1 } = plan.bounds;
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => IsoLayout.toWorld(x, y));
    return {
      left: Math.min(...pts.map((p) => p.x)) - PADDING,
      right: Math.max(...pts.map((p) => p.x)) + PADDING,
      top: Math.min(...pts.map((p) => p.y)) - PADDING,
      bottom: Math.max(...pts.map((p) => p.y)) + PADDING,
    };
  }

  function stonePattern(ctx, pal) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = pal.road;
    g.fillRect(0, 0, 64, 64);
    const r = rng(11);
    g.strokeStyle = pal.roadDark;
    g.lineWidth = 1.5;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const ox = (y % 2) * 8;
        g.fillStyle = r() > 0.5 ? pal.road : pal.roadDark;
        g.globalAlpha = 0.55;
        g.fillRect(x * 16 + ox + 1, y * 16 + 1, 14, 14);
        g.globalAlpha = 1;
        g.strokeRect(x * 16 + ox + 1, y * 16 + 1, 14, 14);
      }
    }
    const p = ctx.createPattern(c, 'repeat');
    // 64 pattern pixels cover about one and a half cells once the grid transform applies.
    p.setTransform(new DOMMatrix().scale(1.5 / 64));
    return p;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function strokePath(ctx, points) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }

  function paintGrass(ctx, pal, W, H, r) {
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0, n = (W * H) / 900; i < n; i++) {
      const x = r() * W, y = r() * H, roll = r();
      ctx.fillStyle = roll < 0.5 ? pal.tuftDark : roll < 0.985 ? pal.tuftLight : pal.flower;
      ctx.beginPath();
      ctx.ellipse(x, y, roll < 0.985 ? 2 + r() * 7 : 1.5, roll < 0.985 ? 1 + r() * 3 : 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function paintRoads(ctx, plan, pal) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const order = plan.roads.slice().sort((a, b) => ROAD_WIDTH[a.zone] - ROAD_WIDTH[b.zone]);
    order.forEach((road) => {
      ctx.strokeStyle = pal.kerb;
      ctx.lineWidth = (ROAD_WIDTH[road.zone] || 0.46) + 2 * (EDGE_WIDTH + KERB_WIDTH);
      strokePath(ctx, road.points);
    });
    order.forEach((road) => {
      ctx.strokeStyle = ZONE_COLOR[road.zone] || pal.kerb;
      ctx.lineWidth = (ROAD_WIDTH[road.zone] || 0.46) + 2 * EDGE_WIDTH;
      strokePath(ctx, road.points);
    });
    const stone = stonePattern(ctx, pal);
    order.forEach((road) => {
      ctx.strokeStyle = stone;
      ctx.lineWidth = ROAD_WIDTH[road.zone] || 0.46;
      strokePath(ctx, road.points);
    });
    // a painted centre line marks the big roads
    ctx.strokeStyle = pal.centre;
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.34, 0.3]);
    plan.roads.filter((r) => r.zone === 'arterial').forEach((road) => strokePath(ctx, road.points));
    ctx.setLineDash([]);
  }

  function paintHubs(ctx, plan, pal) {
    const widest = new Map();
    plan.roads.forEach((r) => {
      [r.from, r.to].forEach((id) => widest.set(id, Math.max(widest.get(id) || 0, ROAD_WIDTH[r.zone] || 0.46)));
    });
    plan.hubs.forEach((h, id) => {
      const rad = (widest.get(id) || 0.46) / 2 + 0.16;
      ctx.fillStyle = pal.kerb;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad + 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.road;
      ctx.beginPath(); ctx.arc(h.x, h.y, rad, 0, Math.PI * 2); ctx.fill();
    });
  }

  function paintBridges(ctx, plan, pal) {
    plan.crossings.forEach((c) => {
      const over = plan.roads[c.over], under = plan.roads[c.under];
      const halfW = (ROAD_WIDTH[over.zone] || 0.46) / 2;
      const span = (ROAD_WIDTH[under.zone] || 0.46) / 2 + 0.2;
      const along = c.axis === 0 ? [1, 0] : [0, 1], side = c.axis === 0 ? [0, 1] : [1, 0];
      const quad = (l, w) => {
        ctx.beginPath();
        ctx.moveTo(c.x - along[0] * l - side[0] * w, c.y - along[1] * l - side[1] * w);
        ctx.lineTo(c.x + along[0] * l - side[0] * w, c.y + along[1] * l - side[1] * w);
        ctx.lineTo(c.x + along[0] * l + side[0] * w, c.y + along[1] * l + side[1] * w);
        ctx.lineTo(c.x - along[0] * l + side[0] * w, c.y - along[1] * l + side[1] * w);
        ctx.closePath();
      };
      ctx.save();
      ctx.translate(0.09, 0.09);
      ctx.fillStyle = pal.shadow;
      quad(span, halfW + 0.05); ctx.fill();
      ctx.restore();
      ctx.fillStyle = pal.bridge;
      quad(span, halfW + 0.05); ctx.fill();
      ctx.strokeStyle = ZONE_COLOR[over.zone] || pal.rail;
      ctx.lineWidth = 0.11;
      ctx.lineCap = 'butt';
      [-1, 1].forEach((s) => {
        const ox = side[0] * (halfW + 0.05) * s, oy = side[1] * (halfW + 0.05) * s;
        ctx.beginPath();
        ctx.moveTo(c.x - along[0] * span + ox, c.y - along[1] * span + oy);
        ctx.lineTo(c.x + along[0] * span + ox, c.y + along[1] * span + oy);
        ctx.stroke();
      });
    });
  }

  function plotKind(node) {
    if (node.type === 'depot') return 'depot';
    if (node.type === 'bin') return 'bin';
    if (node.hazardous) return 'hazard';
    return node.zone === 'commercial' || node.zone === 'industrial' ? node.zone : 'residential';
  }

  function paintTrees(ctx, plan, pal, toPx, r) {
    const taken = new Set();
    const mark = (x, y, radius) => {
      for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) taken.add((x + dx) + ',' + (y + dy));
    };
    plan.roads.forEach((road) => road.cells.forEach((c) => mark(c.x, c.y, 1)));
    plan.plots.forEach((p) => {
      for (let dx = 0; dx <= 4; dx++) for (let dy = 0; dy <= 4; dy++) taken.add((p.hx - dx) + ',' + (p.hy - dy));
    });
    plan.hubs.forEach((h) => mark(h.x, h.y, 1));
    const { x0, y0, x1, y1 } = plan.bounds;
    const trees = [];
    for (let y = y0 - 8; y <= y1 + 8; y++) {
      for (let x = x0 - 8; x <= x1 + 8; x++) {
        if (taken.has(x + ',' + y)) continue;
        if (r() < 0.085) trees.push({ x: x + r() - 0.5, y: y + r() - 0.5, s: 0.75 + r() * 0.6 });
      }
    }
    trees.sort((a, b) => a.x + a.y - b.x - b.y);
    trees.forEach((t) => {
      const { px, py } = toPx(t.x, t.y);
      const s = t.s;
      ctx.fillStyle = pal.shadow;
      ctx.beginPath(); ctx.ellipse(px + 3 * s, py + 1, 11 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.trunk;
      ctx.fillRect(px - 2 * s, py - 9 * s, 4 * s, 9 * s);
      ctx.fillStyle = pal.treeA;
      ctx.beginPath(); ctx.arc(px, py - 15 * s, 10 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.treeB;
      ctx.beginPath(); ctx.arc(px - 2.5 * s, py - 18 * s, 6.5 * s, 0, Math.PI * 2); ctx.fill();
    });
  }

  // light: 'day' or 'night'. nodes supply each plot's kind.
  function render(plan, nodes, light) {
    const pal = PALETTES[light];
    const b = worldBounds(plan);
    const worldW = b.right - b.left, worldH = b.bottom - b.top;
    const res = Math.min(2, MAX_SIDE / Math.max(worldW, worldH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(worldW * res); canvas.height = Math.ceil(worldH * res);
    const ctx = canvas.getContext('2d');
    const r = rng(20261105);

    const screen = () => ctx.setTransform(res, 0, 0, res, -b.left * res, -b.top * res);
    // In grid mode every drawing unit is one cell, skewed into the isometric view.
    const grid = () => ctx.setTransform(IsoLayout.HALF_W * res, IsoLayout.HALF_H * res,
                                        -IsoLayout.HALF_W * res, IsoLayout.HALF_H * res,
                                        -b.left * res, -b.top * res);

    ctx.setTransform(res, 0, 0, res, 0, 0);
    paintGrass(ctx, pal, worldW, worldH, r);

    grid();
    plan.localities.forEach((a) => {
      ctx.fillStyle = pal.locality[a.zone] || pal.locality.residential;
      roundedRect(ctx, a.x, a.y, a.w, a.h, 0.9);
      ctx.fill();
      ctx.strokeStyle = ZONE_COLOR[a.zone] || pal.plotEdge;
      ctx.lineWidth = 0.24;
      ctx.stroke();
    });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    plan.plots.forEach((p) => {
      const kind = plotKind(byId.get(p.id));
      ctx.fillStyle = pal.plot[kind];
      roundedRect(ctx, p.hx - 3.5, p.hy - 3.5, 3, 3, 0.28);
      ctx.fill();
      ctx.strokeStyle = pal.plotEdge;
      ctx.lineWidth = 0.05;
      ctx.stroke();
      // the short drive from the buildings to the road stop
      ctx.strokeStyle = pal.plot[kind];
      ctx.lineWidth = 0.5;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(p.hx - 0.7, p.hy - 0.7);
      ctx.lineTo(p.hx, p.hy);
      ctx.stroke();
    });

    paintRoads(ctx, plan, pal);
    paintHubs(ctx, plan, pal);
    paintBridges(ctx, plan, pal);

    screen();
    paintTrees(ctx, plan, pal, (x, y) => {
      const w = IsoLayout.toWorld(x, y);
      return { px: w.x, py: w.y };
    }, r);

    return { canvas, left: b.left, top: b.top, worldW, worldH };
  }

  return { render, ZONE_COLOR };
})();

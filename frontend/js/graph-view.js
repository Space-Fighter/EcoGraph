// City view: an isometric grass city drawn with PixiJS. iso-layout.js plans it, map-bake.js paints
// the ground once, and this file adds what changes: buildings, status bubbles, labels and trucks.
const GraphView = (() => {
  const MAX_ZOOM = 2.4;
  const FOLLOW_ZOOM = 1.15;
  const LABEL_ZOOM = 0.62;        // node IDs appear once zoomed in this far
  const ROAD_LABEL_ZOOM = 1.0;    // road lengths appear once zoomed in this far
  const TRUCK_SPEED = 220;        // world pixels per second at 1x, easy to follow by eye
  const QUIET_DAY_S = 4;          // how long a day with no trucks lasts at 1x
  const NIGHT_PASS_S = 6;         // how long dusk to dawn lasts between two days at 1x
  const CATCH_UP_HOURS_PER_S = 14;     // fast-forward to morning when a day starts
  const HOLD_AFTER_DAY_MS = 350;
  const NIGHT_TINT = 0x8a97d6;
  const ROUTE_COLOR = { day: 0x1668e3, night: 0x6fb1ff };
  const GRASS_COLOR = { day: 0x63b043, night: 0x18333a };
  const HAZARD_COLOR = 0xf0322f;

  let app = null, container = null;
  let city = { nodes: [], edges: [], areas: [] };
  let nodeById = new Map();
  let plan = null;
  let world, groundSprite, groundNight, warmOverlay, trailLayer, objectLayer, roadLabelLayer, labelLayer, signLayer, fillLayer, bubbleLayer;
  let groundTextures = [];        // baked day and night ground
  let buildings = [];             // { sprite, lights }
  let hotspots = [];              // hover/click rectangles for buildings
  let nodeLabels = [], roadLabels = [], signs = [];
  const bubbles = new Map();      // node id -> { sprite, phase }
  const fillBars = new Map();     // node id -> the bar drawn over the fullest nodes

  const cam = { x: 0, y: 0, zoom: 1, minZoom: 0.2 };
  let followId = null;
  let autoFit = true;             // keep the whole city framed until the camera is moved
  let tabHidden = false;
  let paused = false;
  let speed = 1;                  // playback multiplier from the speed slider
  let clock = 9;                  // hours; keeps counting up, so 33 means 09:00 the next day
  let lastMorning = 6;
  let pass = null;                // the night between two days: { end, resolve }
  let lastSky = null;
  let clockListeners = [];
  let lastClockReport = null;

  // The day being played.
  let day = null;                 // { trucks: [...], elapsed, duration, resolve, onArrive }
  let truckRuns = [];             // kept after the day ends, until the next day clears them
  let followListeners = [];

  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  // ---- which buildings stand on a plot ------------------------------------------------------

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Offsets from the plot's centre, in grid cells. The first place is at the back.
  const SPOT = { back: [-0.72, -0.72], right: [0.72, -0.5], left: [-0.5, 0.72], front: [0.62, 0.62], centre: [0, 0] };

  function hazardBuilding(n) {
    const text = (n.name + ' ' + (n.wasteDescription || '')).toLowerCase();
    if (/lab|diagnostic|blood/.test(text)) return 'lab';
    if (/clinic|hospital|surgical|syringe|medical/.test(text)) return 'clinic';
    if (/paint|solvent|battery|acid|chemical|workshop/.test(text)) return 'workshop';
    return n.binType === 'medical' ? 'clinic' : 'workshop';
  }

  // Each collection point stands for a whole cluster, so it is drawn as a small group of buildings.
  function clusterFor(n) {
    const h = hash(n.id);
    const pick = (list) => list[h % list.length];
    if (n.type === 'depot') return [['depot', SPOT.centre]];
    if (n.type === 'bin') {
      const name = 'bin-' + n.binType;
      return [[Sprites.info(name) ? name : 'bin-general', SPOT.centre], ['disposal-sign', [1.15, 1.15]]];
    }
    if (n.hazardous) return [[hazardBuilding(n), [-0.12, -0.12]], ['hazard-sign', [1.15, 1.15]]];
    if (n.zone === 'commercial') {
      return pick([
        [['tower-a', SPOT.back], ['coffee', SPOT.right], ['stall', SPOT.left]],
        [['tower-b', SPOT.back], ['stall', SPOT.right], ['coffee', SPOT.left]],
        [['tower-a', SPOT.back], ['office', SPOT.right], ['coffee', SPOT.left]],
        [['office', SPOT.back], ['tower-b', SPOT.right], ['stall', SPOT.front]],
      ]);
    }
    if (n.zone === 'industrial') {
      return pick([
        [['factory', [-0.35, -0.45]], ['warehouse', [0.5, 0.75]]],
        [['warehouse', [-0.6, -0.65]], ['factory', [0.3, 0.45]]],
      ]);
    }
    const a = ['house-a', 'house-b', 'house-c'];
    const at = (i) => a[(h + i) % a.length];
    return [[at(0), SPOT.back], [at(1), SPOT.right], [at(2), SPOT.left], [at(h % 2 + 1), SPOT.front]];
  }

  // ---- scene --------------------------------------------------------------------------------

  function label(text, opts = {}) {
    const t = new PIXI.Text({
      text,
      resolution: 3,
      style: {
        fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
        fontSize: opts.size || 10,
        fontWeight: opts.weight || '600',
        fill: opts.fill || '#ffffff',
        stroke: { color: opts.stroke || '#1b2415', width: opts.strokeWidth === undefined ? 3 : opts.strokeWidth, join: 'round' },
      },
    });
    t.anchor.set(0.5);
    return t;
  }

  function woodSign(text, zone) {
    const g = new PIXI.Container();
    const t = label(text, { size: 12, weight: '700', fill: '#fff4d8', stroke: '#3f2610', strokeWidth: 2 });
    const w = t.width + 18, h = 21;
    const board = new PIXI.Graphics();
    board.rect(-w * 0.28, 0, 3, 13).fill(0x4c2f16);
    board.rect(w * 0.28 - 3, 0, 3, 13).fill(0x4c2f16);
    board.roundRect(-w / 2, -h, w, h, 5).fill(0x96663a).stroke({ width: 2, color: 0x4c2f16 });
    board.roundRect(-w / 2 + 2, -h + 2, w - 4, 3, 2).fill({ color: 0xffe3b3, alpha: 0.45 });
    board.roundRect(-w / 2 + 2, -5, w - 4, 3.5, 1.5).fill(MapBake.ZONE_COLOR[zone] || 0xffffff);  // the area's zone colour
    t.position.set(0, -h / 2);
    g.addChild(board, t);
    return g;
  }

  function clearScene() {
    [objectLayer, labelLayer, roadLabelLayer, signLayer, fillLayer, bubbleLayer].forEach((layer) => {
      layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    });
    buildings = []; hotspots = []; nodeLabels = []; roadLabels = []; signs = [];
    bubbles.clear();
    fillBars.clear();
    groundTextures.forEach((t) => t.destroy(true));
    groundTextures = [];
  }

  function buildObjects() {
    plan.plots.forEach((p) => {
      const node = nodeById.get(p.id);
      let tallest = 0, widest = 0;
      clusterFor(node).forEach(([name, off]) => {
        const at = IsoLayout.toWorld(p.cx + off[0], p.cy + off[1]);
        const holder = new PIXI.Container();
        holder.position.set(at.x, at.y);
        holder.zIndex = at.y;
        const body = Sprites.make(name);
        holder.addChild(body);
        let lights = null;
        if (Sprites.info(name).lights) {
          lights = Sprites.make(name, 'lights');
          holder.addChild(lights);
        }
        objectLayer.addChild(holder);
        buildings.push({ body, lights });
        tallest = Math.max(tallest, Sprites.info(name).ay + (at.y - IsoLayout.toWorld(p.cx, p.cy).y) * -1);
        widest = Math.max(widest, Sprites.info(name).w);
      });
      const c = IsoLayout.toWorld(p.cx, p.cy);
      hotspots.push({ id: p.id, cx: c.x, top: c.y - tallest, bottom: c.y, half: widest / 2, depth: c.y, hx: p.hx, hy: p.hy });
      node._bubbleY = c.y - tallest - 4;
      node._bubbleX = c.x;
    });
    plan.hubs.forEach((h, id) => {
      const node = nodeById.get(id);
      const w = IsoLayout.toWorld(h.x, h.y);
      if (node.type === 'junction') {
        hotspots.push({ id, cx: w.x, top: w.y - 14, bottom: w.y + 14, half: 18, depth: w.y });
        node._bubbleY = w.y; node._bubbleX = w.x;
      }
      const text = label(id, { size: 9.5 });
      text.position.set(w.x, w.y + 13);
      labelLayer.addChild(text);
      nodeLabels.push(text);
    });
    plan.roads.forEach((r) => {
      if (typeof r.weight !== 'number') return;
      const cells = r.cells, mid = cells[Math.floor(cells.length / 2)];
      const w = IsoLayout.toWorld(mid.x, mid.y);
      const t = label(r.weight.toFixed(1) + ' km', { size: 9, fill: '#fff7dc', stroke: '#3a3323' });
      t.position.set(w.x, w.y - 8);
      roadLabelLayer.addChild(t);
      roadLabels.push(t);
    });
    plan.localities.forEach((a) => {
      const w = IsoLayout.toWorld(a.x + 0.4, a.y + 0.4);  // the locality's far corner, behind its buildings
      const s = woodSign(a.name, a.zone);
      s.position.set(w.x, w.y);
      signLayer.addChild(s);
      signs.push(s);
    });
  }

  // The ground is baked twice, and the night copy fades in over the day copy.
  function bakeGround() {
    [[groundSprite, 'day'], [groundNight, 'night']].forEach(([sprite, name]) => {
      const b = MapBake.render(plan, city.nodes, name);
      const texture = new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: b.canvas, autoGenerateMipmaps: true }) });
      groundTextures.push(texture);
      sprite.texture = texture;
      sprite.position.set(b.left, b.top);
      sprite.width = b.worldW;
      sprite.height = b.worldH;
      warmOverlay.clear().rect(b.left, b.top, b.worldW, b.worldH).fill(0xff8a3c);
    });
  }

  // ---- day and night ------------------------------------------------------------------------

  function smooth(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // night: 0 by day, 1 in the dark. warm: the orange glow around sunrise and sunset.
  function skyAt(hours) {
    const h = ((hours % 24) + 24) % 24;
    return {
      night: h < 12 ? 1 - smooth(4.5, 7, h) : smooth(17.5, 20, h),
      warm: Math.max(0, 1 - Math.abs(h - 18.6) / 1.7, 1 - Math.abs(h - 5.6) / 1.4),
    };
  }

  function mixColor(a, b, t) {
    const ch = (shift) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  function paintLight(force) {
    const sky = skyAt(clock);
    if (!force && lastSky && Math.abs(sky.night - lastSky.night) < 0.004 && Math.abs(sky.warm - lastSky.warm) < 0.004) return;
    lastSky = sky;
    const tint = mixColor(0xffffff, NIGHT_TINT, sky.night);
    buildings.forEach(({ body, lights }) => {
      body.tint = tint;
      if (lights) { lights.alpha = sky.night; lights.visible = sky.night > 0.01; }
    });
    truckRuns.forEach((t) => {
      t.sprite.tint = mixColor(0xffffff, 0xc4cbf0, sky.night);
      t.glow.alpha = sky.night * 0.55;
    });
    groundNight.alpha = sky.night;
    warmOverlay.alpha = sky.warm * 0.22;
    app.renderer.background.color = mixColor(GRASS_COLOR.day, GRASS_COLOR.night, sky.night);
  }

  function reportClock() {
    const minutes = Math.floor(clock * 12) * 5;   // five-minute steps are plenty for a label
    if (minutes === lastClockReport) return;
    lastClockReport = minutes;
    clockListeners.forEach((fn) => fn(((clock % 24) + 24) % 24));
  }

  // Before noon a day can start from this morning; after that it waits for the next sunrise.
  const nextMorning = (hours) => Math.ceil((hours - 12) / 24) * 24 + 6;

  // The clock only runs while a day is playing, so paused and idle both hold the time still.
  function stepClock(dt) {
    if (paused) return;
    if (day) {
      // From the time the day started at, through to evening when the last truck finishes.
      const evening = day.morning + 12;
      const target = day.startClock + (evening - day.startClock) * day.progress;
      if (clock < target) clock = Math.min(target, clock + CATCH_UP_HOURS_PER_S * dt);
    } else if (pass) {
      clock = Math.min(pass.end, clock + (12 / NIGHT_PASS_S) * speed * dt);
      if (clock >= pass.end) finishPass();
    }
    paintLight();
    reportClock();
  }

  function finishPass() {
    if (!pass) return;
    const p = pass;
    pass = null;
    p.resolve();
  }

  // Dusk through to the next dawn, played after a day's trucks have finished.
  function nightPass() {
    if (!app) return Promise.resolve();
    const end = lastMorning + 24;
    if (tabHidden) {
      clock = end;
      return Promise.resolve();
    }
    return new Promise((resolve) => { pass = { end, resolve }; });
  }

  function rebuildScene() {
    finishDay();
    finishPass();
    clearTrucks();
    clearScene();
    nodeById = new Map(city.nodes.map((n) => [n.id, n]));
    plan = IsoLayout.compute(city);
    buildObjects();
    bakeGround();
    paintLight(true);
    syncZoomDetail();
  }

  // Heavy work on a big city: let the "rebuilding" sign paint before the page is blocked.
  async function rebuildWithNotice() {
    const notice = document.getElementById('map-busy');
    notice.hidden = false;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    try {
      rebuildScene();
      fitAll();
    } finally {
      notice.hidden = true;
    }
  }

  // ---- camera -------------------------------------------------------------------------------

  function viewSize() { return { w: container.clientWidth, h: container.clientHeight }; }

  function applyCamera() {
    const { w, h } = viewSize();
    world.scale.set(cam.zoom);
    world.position.set(w / 2 - cam.x * cam.zoom, h / 2 - cam.y * cam.zoom);
  }

  function syncZoomDetail() {
    const z = cam.zoom;
    nodeLabels.forEach((t) => { t.visible = z >= LABEL_ZOOM; });
    roadLabels.forEach((t) => { t.visible = z >= ROAD_LABEL_ZOOM; });
    const signScale = Math.min(2.4, Math.max(1, 0.82 / z));
    signs.forEach((s) => s.scale.set(signScale));
    const bubbleScale = Math.min(1.7, Math.max(0.85, 0.85 / z));
    bubbles.forEach((b) => b.sprite.scale.set(b.baseX * bubbleScale, b.baseY * bubbleScale));
    const barScale = Math.min(3.4, Math.max(0.9, 0.9 / z));
    fillBars.forEach((bar) => bar.scale.set(barScale));
    truckRuns.forEach((t) => { t.scale = Math.min(1.8, Math.max(1, 0.7 / z)); t.dirty = true; });
  }

  function cityRect() {
    const pts = [];
    plan.localities.forEach((a) => {
      [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]].forEach(([x, y]) => pts.push(IsoLayout.toWorld(x, y)));
    });
    if (!pts.length) return { x0: -100, x1: 100, y0: -100, y1: 100 };
    return {
      x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)) - 70, y1: Math.max(...pts.map((p) => p.y)),
    };
  }

  // Zooms and centres so that every node is on screen at once.
  function fitAll() {
    if (!app || !plan) return;
    app.resize();
    const r = cityRect();
    const { w, h } = viewSize();
    if (w < 2 || h < 2) return;
    const zoom = Math.min((w - 40) / (r.x1 - r.x0), (h - 40) / (r.y1 - r.y0));
    cam.minZoom = zoom * 0.7;
    cam.zoom = Math.min(MAX_ZOOM, zoom);
    cam.x = (r.x0 + r.x1) / 2;
    cam.y = (r.y0 + r.y1) / 2;
    setFollow(null);
    autoFit = true;
    applyCamera();
    syncZoomDetail();
  }

  function updateCamera(dt) {
    const truck = followId && truckRuns.find((t) => t.id === followId);
    if (!truck) return;
    const k = 1 - Math.exp(-dt * 3.2);
    cam.x += (truck.x - cam.x) * k;
    cam.y += (truck.y - cam.y) * k;
    const before = cam.zoom;
    cam.zoom += (Math.max(cam.minZoom, FOLLOW_ZOOM) - cam.zoom) * k;
    applyCamera();
    if (Math.abs(cam.zoom - before) > 1e-4) syncZoomDetail();
  }

  // ---- truck routes -------------------------------------------------------------------------

  function roadPolyline(a, b) {
    const road = roadIndex().get(key(a, b));
    let cells;
    if (road) cells = road.from === a ? road.points : road.points.slice().reverse();
    else {
      const ha = plan.hubs.get(a), hb = plan.hubs.get(b);
      if (!ha || !hb) return [];
      cells = [ha, hb];
    }
    return cells.map((c) => IsoLayout.toWorld(c.x, c.y));
  }

  let roadIndexCache = null, roadIndexFor = null;
  function roadIndex() {
    if (roadIndexFor !== plan) {
      roadIndexFor = plan;
      roadIndexCache = new Map(plan.roads.map((r) => [key(r.from, r.to), r]));
    }
    return roadIndexCache;
  }

  // Joins the truck's hop-by-hop path into one line, remembering where along it each node falls.
  function routeOf(run) {
    const points = [];
    const stops = [];
    let total = 0;
    const push = (p) => {
      const last = points[points.length - 1];
      if (last) {
        const d = Math.hypot(p.x - last.x, p.y - last.y);
        if (d < 0.01) return;
        total += d;
      }
      points.push({ x: p.x, y: p.y, at: total });
    };
    (run.segments || []).forEach((seg) => {
      const path = seg.path || [];
      for (let i = 0; i < path.length; i++) {
        if (i === 0 && path.length === 1) {
          const hub = plan.hubs.get(path[0]);
          if (hub) { push(IsoLayout.toWorld(hub.x, hub.y)); stops.push({ at: total, id: path[0] }); }
          continue;
        }
        if (i === 0) {
          const hub = plan.hubs.get(path[0]);
          if (hub) push(IsoLayout.toWorld(hub.x, hub.y));
          stops.push({ at: total, id: path[0] });
          continue;
        }
        if (path[i - 1] !== path[i]) roadPolyline(path[i - 1], path[i]).forEach(push);
        stops.push({ at: total, id: path[i] });
      }
    });
    return { points, stops, total };
  }

  function facing(dx, dy) {
    if (dx >= 0) return dy >= 0 ? 'se' : 'ne';
    return dy >= 0 ? 'sw' : 'nw';
  }

  function makeTruck(run) {
    const route = routeOf(run);
    if (route.points.length < 1) return null;
    const kind = run.kind === 'hazard' ? 'hazard' : 'normal';
    const holder = new PIXI.Container();
    const ring = new PIXI.Graphics();
    ring.ellipse(0, 0, 25, 13).stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
    ring.ellipse(0, 0, 21, 10.5).fill({ color: kind === 'hazard' ? 0xffd21f : 0x7dd3ff, alpha: 0.4 });
    ring.visible = false;
    const glow = new PIXI.Graphics();
    glow.ellipse(0, 0, 34, 17).fill(0xffe9a8);
    glow.alpha = 0;
    const sprite = Sprites.make('truck-' + kind + '-se');
    const tag = label(run.id, { size: 9.5, fill: '#ffffff', stroke: kind === 'hazard' ? '#7a1010' : '#0d3b6e' });
    tag.position.set(0, -32);
    holder.addChild(glow, ring, sprite, tag);
    objectLayer.addChild(holder);
    const trail = new PIXI.Graphics();
    trailLayer.addChild(trail);
    const first = route.points[0];
    holder.position.set(first.x, first.y);
    return {
      id: run.id, kind, run, route, holder, glow, ring, sprite, tag, trail,
      x: first.x, y: first.y, dir: 'se', seg: 0, dist: 0, nextStop: 0, done: route.total <= 0,
      scale: 1, dirty: true,
    };
  }

  function clearTrucks() {
    truckRuns.forEach((t) => {
      t.holder.destroy({ children: true });
      t.trail.destroy();
    });
    truckRuns = [];
  }

  function drawTrail(t) {
    const g = t.trail;
    g.clear();
    const pts = t.route.points;
    if (t.seg === 0 && t.dist <= 0) return;
    const color = t.kind === 'hazard' ? HAZARD_COLOR : ROUTE_COLOR[skyAt(clock).night > 0.5 ? 'night' : 'day'];
    const focused = followId === t.id;
    const width = focused ? 7 : 4.5;
    const alpha = focused ? 0.95 : 0.65;
    if (t.kind === 'hazard') {
      const DASH = 16, GAP = 11;
      for (let i = 0; i <= t.seg && i < pts.length - 1; i++) {
        const a = pts[i], b = i === t.seg ? { x: t.x, y: t.y } : pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.01) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        let start = (DASH + GAP - (a.at % (DASH + GAP))) % (DASH + GAP) - DASH;
        for (let s = start; s < len; s += DASH + GAP) {
          const from = Math.max(0, s), to = Math.min(len, s + DASH);
          if (to <= from) continue;
          g.moveTo(a.x + ux * from, a.y + uy * from).lineTo(a.x + ux * to, a.y + uy * to);
        }
      }
    } else {
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= t.seg && i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.lineTo(t.x, t.y);
    }
    g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
  }

  function placeTruck(t) {
    const pts = t.route.points;
    while (t.seg < pts.length - 2 && pts[t.seg + 1].at <= t.dist) t.seg++;
    const a = pts[t.seg], b = pts[Math.min(t.seg + 1, pts.length - 1)];
    const span = b.at - a.at;
    const f = span > 0 ? Math.min(1, (t.dist - a.at) / span) : 0;
    t.x = a.x + (b.x - a.x) * f;
    t.y = a.y + (b.y - a.y) * f;
    if (span > 0) {
      const dir = facing(b.x - a.x, b.y - a.y);
      if (dir !== t.dir) {
        t.dir = dir;
        const name = 'truck-' + t.kind + '-' + dir;
        const e = Sprites.info(name);
        t.sprite.texture = e.day;
        t.sprite.anchor.set(e.ax / e.w, e.ay / e.h);
        t.sprite.width = e.w; t.sprite.height = e.h;
      }
    }
    t.holder.position.set(t.x, t.y);
    t.holder.zIndex = t.y + 1;
    t.holder.scale.set(t.scale);
    t.ring.visible = followId === t.id;
    t.dirty = false;
    drawTrail(t);
  }

  function stepTrucks(dt) {
    if (!day || paused) return;
    day.elapsed += dt;
    day.trucks.forEach((t) => {
      if (t.done) return;
      t.dist = Math.min(t.route.total, t.dist + TRUCK_SPEED * speed * dt);
      while (t.nextStop < t.route.stops.length && t.route.stops[t.nextStop].at <= t.dist + 0.01) {
        const id = t.route.stops[t.nextStop].id;
        t.nextStop++;
        if (t.homes.has(id)) truckArrived(id);
      }
      if (t.dist >= t.route.total) t.done = true;
      placeTruck(t);
    });
    // Morning is when the trucks leave and evening is when the last one finishes.
    if (day.longest > 0) {
      day.progress = Math.max(...day.trucks.map((t) => t.dist)) / day.longest;
    } else {
      day.quiet = Math.min(QUIET_DAY_S, day.quiet + speed * dt);
      day.progress = day.quiet / QUIET_DAY_S;
    }
    if (day.progress >= 1) {
      if (day.holdUntil === null) day.holdUntil = day.elapsed + HOLD_AFTER_DAY_MS / 1000;
      if (day.elapsed >= day.holdUntil) finishDay();
    }
  }

  function finishDay() {
    if (!day) return;
    const d = day;
    day = null;
    d.trucks.forEach((t) => {
      t.dist = t.route.total;
      t.route.stops.forEach((s) => { if (t.homes.has(s.id)) truckArrived(s.id); });
      if (t.route.points.length > 1) placeTruck(t);
      t.done = true;
    });
    d.resolve();
  }

  // Plays every truck of one day at once. Resolves when all have finished (or the day is cut short).
  function animateDay(runs) {
    if (!app) return Promise.resolve();
    finishDay();
    clearTrucks();
    return new Promise((resolve) => {
      const trucks = [];
      runs.forEach((run) => {
        const t = makeTruck(run);
        if (!t) return;
        t.homes = new Set(run.homes || []);
        t.scale = Math.min(1.8, Math.max(1, 0.7 / cam.zoom));
        trucks.push(t);
        placeTruck(t);
      });
      truckRuns = trucks;
      paintLight(true);
      const moving = trucks.filter((t) => t.route.total > 0);
      lastMorning = nextMorning(clock);
      if (tabHidden) {
        trucks.forEach((t) => { t.route.stops.forEach((s) => { if (t.homes.has(s.id)) truckArrived(s.id); }); });
        setFollow(null);
        clock = lastMorning + 12;
        resolve();
        return;
      }
      day = { trucks, elapsed: 0, morning: lastMorning, startClock: Math.max(clock, lastMorning), progress: 0, quiet: 0, holdUntil: null, resolve,
              longest: moving.length ? Math.max(...moving.map((t) => t.route.total)) : 0 };
      if (moving.length) {
        autoFit = false;
        setFollow(moving[Math.floor(Math.random() * moving.length)].id);
      } else {
        setFollow(null);
      }
    });
  }

  function setFollow(id) {
    if (followId === id) return;
    const prev = truckRuns.find((t) => t.id === followId);
    followId = id;
    if (prev) placeTruck(prev);
    const next = truckRuns.find((t) => t.id === id);
    if (next) placeTruck(next);
    followListeners.forEach((fn) => fn(id));
  }

  // Follow a truck on request. Lasts until the current day ends.
  function follow(id) {
    if (truckRuns.some((t) => t.id === id)) setFollow(id);
  }

  function onFollowChange(fn) { followListeners.push(fn); }

  function setPaused(value) { paused = !!value; }

  function setSpeed(value) { speed = value; }

  function onClockChange(fn) { clockListeners.push(fn); fn(((clock % 24) + 24) % 24); }

  // Ends playback at once and clears the routes from the map.
  function clearRoute() {
    finishDay();
    finishPass();
    clearTrucks();
    setFollow(null);
  }

  // ---- status bubbles -----------------------------------------------------------------------

  function setBubble(id, kind) {
    const node = nodeById.get(id);
    if (!node || node._bubbleY === undefined) return;
    const old = bubbles.get(id);
    if (old && old.kind === kind) return;
    if (old) { old.sprite.destroy(); bubbles.delete(id); }
    const sprite = Sprites.make(kind === 'overflow' ? 'bubble-overflow' : 'bubble-due');
    sprite.position.set(node._bubbleX, node._bubbleY);
    bubbleLayer.addChild(sprite);
    bubbles.set(id, { sprite, kind, phase: hash(id) % 100 / 16, baseX: sprite.scale.x, baseY: sprite.scale.y, y: node._bubbleY });
    syncZoomDetail();
  }

  function clearBubble(id) {
    const b = bubbles.get(id);
    if (!b) return;
    b.sprite.destroy();
    bubbles.delete(id);
  }

  function truckArrived(id) {
    clearBubble(id);
    const bar = fillBars.get(id);
    if (bar) { bar.destroy({ children: true }); fillBars.delete(id); }
  }

  // Draws a fill bar over each listed node: [{ id, percent, status }], using the same colours as
  // the Database view (green ok, amber due, red overflowing).
  function setFillBars(rows) {
    if (!plan) return;
    fillBars.forEach((bar) => bar.destroy({ children: true }));
    fillBars.clear();
    const W = 46, H = 8;
    const colors = { ok: 0x2fae5a, due: 0xf0a020, overflow: 0xe03131 };
    rows.forEach(({ id, percent, status }) => {
      const node = nodeById.get(id);
      if (!node || node._bubbleY === undefined) return;
      const bar = new PIXI.Container();
      const g = new PIXI.Graphics();
      g.roundRect(-W / 2, -H / 2, W, H, 4).fill(0x20242e).stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
      const fill = (W - 3) * Math.min(1, Math.max(0, percent / 100));
      if (fill > 1) g.roundRect(-W / 2 + 1.5, -H / 2 + 1.5, fill, H - 3, 2.5).fill(colors[status] || colors.ok);
      const text = label(percent.toFixed(0) + '%', { size: 10, weight: '700' });
      text.position.set(0, -H / 2 - 7);
      bar.addChild(g, text);
      bar.position.set(node._bubbleX, node._bubbleY + 10);
      fillLayer.addChild(bar);
      fillBars.set(id, bar);
    });
    syncZoomDetail();
  }

  function markDue(ids, overflowIds) {
    if (!plan) return;
    const over = new Set(overflowIds || []);
    const wanted = new Set(ids);
    over.forEach((id) => wanted.add(id));
    Array.from(bubbles.keys()).forEach((id) => { if (!wanted.has(id)) clearBubble(id); });
    wanted.forEach((id) => setBubble(id, over.has(id) ? 'overflow' : 'due'));
  }

  // ---- pointer: pan, zoom, hover, click ------------------------------------------------------

  function toWorldPoint(ev) {
    const rect = app.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const { w, h } = viewSize();
    return { px, py, x: cam.x + (px - w / 2) / cam.zoom, y: cam.y + (py - h / 2) / cam.zoom };
  }

  function truckAt(p) {
    let best = null, bestD = 34 / Math.min(1, cam.zoom);
    truckRuns.forEach((t) => {
      const d = Math.hypot(p.x - t.x, p.y - (t.y - 10));
      if (d < bestD) { bestD = d; best = t; }
    });
    return best;
  }

  // What the pointer is on, most specific first: a status bubble always names its own node, then
  // the ground of a plot, then a building rising above its plot (the nearest one wins).
  function hotspotAt(p) {
    for (const [id, b] of bubbles) {
      const scale = b.sprite.scale.y / b.baseY;
      if (Math.hypot(p.x - b.sprite.x, p.y - (b.sprite.y - 24 * scale)) <= 20 * scale) {
        return hotspots.find((h) => h.id === id) || null;
      }
    }
    const g = IsoLayout.toGrid(p.x, p.y);
    const onPlot = hotspots.find((h) => h.hx !== undefined && g.x >= h.hx - 3.5 && g.x <= h.hx + 0.5 &&
                                        g.y >= h.hy - 3.5 && g.y <= h.hy + 0.5);
    if (onPlot) return onPlot;
    let best = null;
    hotspots.forEach((h) => {
      if (Math.abs(p.x - h.cx) > h.half || p.y < h.top || p.y > h.bottom) return;
      if (!best || h.depth > best.depth) best = h;
    });
    return best;
  }

  // The server finishes a day's pickups before its trucks are drawn. While a bubble waits for its
  // truck, say so rather than showing the emptied level that the bubble seems to contradict.
  function fillLine(id, row) {
    const b = bubbles.get(id);
    if (b && row.status === 'ok') {
      return (b.kind === 'overflow' ? 'Overflowing this morning' : 'Due this morning') + ' · truck on the way';
    }
    return row.percentFull.toFixed(0) + '% full · ' + row.status;
  }

  function kindOf(n) {
    if (n.type === 'home') return n.hazardous ? 'hazardous site' : 'household / business cluster';
    if (n.type === 'bin') return 'disposal site (' + (n.binType || 'bin') + ')';
    return n.type;
  }

  let tipFor = null;

  function showTip(lines, px, py) {
    const tip = document.getElementById('node-tip');
    tip.replaceChildren();
    lines.forEach((text, i) => {
      const el = document.createElement(i === 0 ? 'b' : 'div');
      el.textContent = text;
      tip.appendChild(el);
    });
    tip.style.left = Math.max(90, Math.min(viewSize().w - 90, px)) + 'px';
    tip.style.top = Math.max(50, py - 14) + 'px';
    tip.hidden = false;
  }

  function hideTip() {
    tipFor = null;
    document.getElementById('node-tip').hidden = true;
  }

  function hoverAt(ev) {
    const p = toWorldPoint(ev);
    const truck = truckAt(p);
    if (truck) {
      tipFor = 'truck:' + truck.id;
      const load = truck.run.kind === 'normal' ? truck.run.load.toFixed(0) + ' / ' + truck.run.capacity.toFixed(0) + ' kg'
                                              : truck.run.load.toFixed(0) + ' kg';
      showTip([truck.id + ' (' + truck.kind + ')', load + ' · ' + truck.run.cost.toFixed(1) + ' km',
               'Stops: ' + (truck.run.homes.join(', ') || 'none'), 'Click to follow'], p.px, p.py);
      return true;
    }
    const spot = hotspotAt(p);
    if (!spot) { hideTip(); return false; }
    const n = nodeById.get(spot.id);
    if (tipFor !== 'node:' + spot.id) {
      tipFor = 'node:' + spot.id;
      const lines = [(n.name || n.id) + ' (' + n.id + ')', (n.area ? n.area + ' · ' : '') + kindOf(n)];
      showTip(lines, p.px, p.py);
      if (n.type === 'home' || n.type === 'bin') {
        DatabaseView.fillOf(n.id).then((row) => {
          if (row && tipFor === 'node:' + spot.id) {
            showTip(lines.concat([fillLine(n.id, row)]), p.px, p.py);
          }
        }).catch(() => {});
      }
    } else {
      document.getElementById('node-tip').style.left = Math.max(90, Math.min(viewSize().w - 90, p.px)) + 'px';
      document.getElementById('node-tip').style.top = Math.max(50, p.py - 14) + 'px';
    }
    return false;
  }

  function setupPointer() {
    const canvas = app.canvas;
    let drag = null;
    canvas.addEventListener('pointerdown', (ev) => {
      drag = { x: ev.clientX, y: ev.clientY, moved: false };
      canvas.setPointerCapture(ev.pointerId);
      hideTip();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!drag) {
        canvas.style.cursor = hoverAt(ev) ? 'pointer' : '';
        return;
      }
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      drag.x = ev.clientX; drag.y = ev.clientY;
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      autoFit = false;
      setFollow(null);
      applyCamera();
    });
    canvas.addEventListener('pointerup', (ev) => {
      const clicked = drag && !drag.moved;
      drag = null;
      if (!clicked) return;
      const truck = truckAt(toWorldPoint(ev));
      if (truck) setFollow(truck.id);
    });
    canvas.addEventListener('pointerleave', hideTip);
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const before = toWorldPoint(ev);
      cam.zoom = Math.max(cam.minZoom, Math.min(MAX_ZOOM, cam.zoom * Math.exp(-ev.deltaY * 0.0012)));
      const { w, h } = viewSize();
      cam.x = before.x - (before.px - w / 2) / cam.zoom;
      cam.y = before.y - (before.py - h / 2) / cam.zoom;
      autoFit = false;
      setFollow(null);
      hideTip();
      applyCamera();
      syncZoomDetail();
    }, { passive: false });
  }

  // ---- frame loop ---------------------------------------------------------------------------

  function tick(ticker) {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    stepTrucks(dt);
    stepClock(dt);
    updateCamera(dt);
    const now = performance.now() / 1000;
    bubbles.forEach((b) => { b.sprite.y = b.y + Math.sin(now * 2.4 + b.phase) * 3; });
  }

  // ---- public -------------------------------------------------------------------------------

  async function init(el, graph) {
    container = el;
    city = { nodes: graph.nodes.slice(), edges: graph.edges.slice(), areas: graph.areas || [] };
    app = new PIXI.Application();
    await app.init({
      resizeTo: container,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      background: GRASS_COLOR.day,
      preference: 'webgl',
      eventMode: 'none',
    });
    container.appendChild(app.canvas);
    await Sprites.load();

    world = new PIXI.Container();
    groundSprite = new PIXI.Sprite();
    groundNight = new PIXI.Sprite();
    warmOverlay = new PIXI.Graphics();
    trailLayer = new PIXI.Container();
    roadLabelLayer = new PIXI.Container();
    objectLayer = new PIXI.Container();
    objectLayer.sortableChildren = true;
    labelLayer = new PIXI.Container();
    signLayer = new PIXI.Container();
    fillLayer = new PIXI.Container();
    bubbleLayer = new PIXI.Container();
    world.addChild(groundSprite, groundNight, trailLayer, roadLabelLayer, objectLayer, warmOverlay, labelLayer, signLayer, fillLayer, bubbleLayer);
    app.stage.addChild(world);

    rebuildScene();
    setupPointer();
    app.ticker.add(tick);
    fitAll();
    new ResizeObserver(() => {
      if (tabHidden) return;
      if (autoFit) fitAll();
      else { app.resize(); applyCamera(); }
    }).observe(container);
    return app;
  }

  // Appends freshly generated nodes and roads, then plans the map again so everything has room.
  async function addElements(nodes, edges) {
    if (!app) return;
    city.nodes = city.nodes.concat(nodes);
    city.edges = city.edges.concat(edges);
    await rebuildWithNotice();
  }

  // Replaces everything from a fresh /graph response (after a reset).
  async function rebuild(graph) {
    if (!app) return;
    city = { nodes: graph.nodes.slice(), edges: graph.edges.slice(), areas: graph.areas || city.areas };
    await rebuildWithNotice();
  }

  // The map is hidden while the Database tab is open. A day in progress finishes at once so the
  // simulation keeps moving, and drawing stops.
  function setVisible(visible) {
    if (!app) return;
    tabHidden = !visible;
    if (visible) {
      app.ticker.start();
      if (autoFit) fitAll();
      else { app.resize(); applyCamera(); }
    } else {
      finishDay();
      finishPass();
      app.ticker.stop();
    }
  }

  function resize() {
    if (app) { app.resize(); applyCamera(); }
  }

  // Current drawing position of every real node.
  function nodePositions() {
    return Array.from(plan.hubs.entries()).map(([id, h]) => ({ id, ...IsoLayout.toWorld(h.x, h.y) }));
  }

  const stats = () => ({ nodes: city.nodes.length, roads: plan.roads.length, bridges: plan.crossings.length, zoom: cam.zoom, followId, paused, speed, clock, sky: skyAt(clock),
                         trucks: truckRuns.map((t) => ({ id: t.id, x: t.x, y: t.y, done: t.done, dist: t.dist, total: t.route.total })),
                         camera: { x: cam.x, y: cam.y }, bubbleSpots: Array.from(bubbles.entries()).map(([id, b]) => ({ id, kind: b.kind, x: b.sprite.x, y: b.sprite.y, scale: b.sprite.scale.y / b.baseY })),
                         bubbles: Array.from(bubbles.keys()), fillBars: Array.from(fillBars.keys()) });

  return { init, addElements, rebuild, fitAll, nodePositions, animateDay, nightPass, clearRoute, markDue, resize,
           setFillBars, setVisible, setPaused, setSpeed, follow, onFollowChange, onClockChange, stats };
})();

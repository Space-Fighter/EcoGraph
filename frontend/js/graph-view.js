// City view. With Leaflet available, Leaflet owns pan/zoom and the lat/lng projection (no map
// tiles are drawn), and Cytoscape is a transparent overlay whose node positions are
// re-projected from lat/lng whenever the map moves. Without Leaflet (offline CDN, or ?plain=1)
// Cytoscape draws on its own canvas using a simple projection of the same coordinates.
const GraphView = (() => {
  // Cytoscape cannot read CSS variables, so the palette is mirrored here per theme.
  // Zone fill colours match --res/--com/--ind/--art in style.css (used by the legend).
  const THEMES = {
    light: {
      zone: { residential: '#8fd19e', commercial: '#8fb8e8', industrial: '#b8b8b8', arterial: '#f0efe9' },
      edge: { residential: '#5aa56b', commercial: '#5b8fd0', industrial: '#8a8a8a', arterial: '#c3c0b4' },
      text: '#1c1c1c', nodeBorder: '#555555', depotBorder: '#143769',
      edgeLabel: '#444444', edgeLabelBg: '#ffffff',
      due: '#f59e0b', route: '#143769', hazard: '#d62828',
    },
    dark: {
      zone: { residential: '#4f9e63', commercial: '#4d7fc2', industrial: '#7d8591', arterial: '#566070' },
      edge: { residential: '#3f7d50', commercial: '#3d65a0', industrial: '#5f6670', arterial: '#4a5362' },
      text: '#e6e9ee', nodeBorder: '#aab4c3', depotBorder: '#8ab4f8',
      edgeLabel: '#c5cdd9', edgeLabelBg: '#11161d',
      due: '#fbbf24', route: '#7db3ff', hazard: '#ef5350',
    },
  };
  const NODE_LABEL_ZOOM = 13;  // node ids are drawn from this map zoom upwards
  const LABEL_ZOOM = 14;       // edge distances are drawn from this map zoom upwards
  const AREA_LABEL_ZOOM = 0;   // locality names stay visible at every zoom (no basemap to orient by)

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function buildStyle(t) {
    return [
      { selector: 'node', style: {
          label: 'data(label)', 'font-size': 11, 'text-valign': 'bottom', 'text-margin-y': 4, color: t.text,
          'text-background-color': t.edgeLabelBg, 'text-background-opacity': 0.7, 'text-background-padding': 1,
          'background-color': (n) => t.zone[n.data('zone')] || '#ddd',
          'border-width': 2, 'border-color': t.nodeBorder, width: 22, height: 22 } },
      { selector: 'node[type="depot"]', style: { shape: 'rectangle', width: 32, height: 32, 'border-width': 3, 'border-color': t.depotBorder, 'font-weight': 'bold' } },
      { selector: 'node[type="home"]', style: { shape: 'ellipse' } },
      { selector: 'node[type="bin"]', style: { shape: 'triangle', width: 28, height: 28 } },
      { selector: 'node[type="junction"]', style: { shape: 'ellipse', width: 11, height: 11, 'font-size': 9 } },
      { selector: 'edge', style: {
          width: 3, 'line-color': (e) => t.edge[e.data('zone')] || '#bbb',
          'font-size': 9, color: t.edgeLabel,
          'text-background-color': t.edgeLabelBg, 'text-background-opacity': 0.85, 'text-background-padding': 2,
          'curve-style': 'straight' } },
      { selector: 'edge.labeled', style: { label: 'data(label)' } },
      { selector: 'node.nolabel', style: { 'text-opacity': 0, 'text-background-opacity': 0 } },
      { selector: 'node.due', style: { 'border-color': t.due, 'border-width': 5 } },
      { selector: 'node.overflow', style: { 'border-color': t.hazard, 'border-width': 6 } },
      { selector: 'node.visited', style: { 'border-color': t.route, 'border-width': 5 } },
      { selector: 'edge.route', style: { 'line-color': t.route, width: 6, 'z-index': 10 } },
      { selector: 'edge.hazard-edge', style: { 'line-color': t.hazard, 'line-style': 'dashed', width: 6, 'z-index': 10 } },
      { selector: 'node.hazard-visited', style: { 'border-color': t.hazard, 'border-width': 5 } },
    ];
  }

  // Re-skins the canvas without touching positions or highlighted routes.
  function applyTheme() {
    if (cy) cy.style(buildStyle(THEMES[currentTheme()]));
    drawAreas();
  }

  let cy = null;
  let map = null;            // Leaflet map, or null in plain mode
  let areaLayer = null;      // locality circles + labels
  let hoverLayer = null;     // invisible markers that give nodes hover tooltips
  let areas = [];
  let spread = {};           // per node: pixel offset that keeps overlapping nodes apart
  const hoverMarkers = {};   // node id -> Leaflet marker carrying its tooltip
  let edgeCount = 0;
  let animationToken = 0;    // bumping this cancels an animation in progress

  const el = (id) => document.getElementById(id);

  // Plain-mode projection: equirectangular around Dehradun, 1 km ~ 60 px.
  function plainPoint(lat, lng) {
    const kmPerDegLat = 111.19;
    const kmPerDegLng = 111.32 * Math.cos(30.3 * Math.PI / 180);
    return { x: (lng - 78.0) * kmPerDegLng * 60, y: -(lat - 30.33) * kmPerDegLat * 60 };
  }

  function pointFor(lat, lng) {
    if (map) {
      const p = map.latLngToContainerPoint([lat, lng]);
      return { x: p.x, y: p.y };
    }
    return plainPoint(lat, lng);
  }

  // Real coordinates put many nodes almost on top of each other (a locality is ~1 km across,
  // the whole city ~20 km). Each node keeps its true position as an anchor, but nodes closer
  // than MIN_GAP pixels are pushed apart so every node stays visible and hoverable. The offsets
  // are in pixels at the current zoom, so they are recomputed when the zoom changes and simply
  // carried along while panning. At high zoom nodes are naturally far apart and offsets vanish.
  const MIN_GAP = 30;

  function recomputeSpread() {
    spread = {};
    if (!map || !cy) return;
    const nodes = cy.nodes().toArray();
    const n = nodes.length;
    const x0 = new Float64Array(n), y0 = new Float64Array(n);
    const x = new Float64Array(n), y = new Float64Array(n);
    nodes.forEach((nd, i) => {
      const p = pointFor(nd.data('lat'), nd.data('lng'));
      x0[i] = x[i] = p.x;
      y0[i] = y[i] = p.y;
    });

    for (let iter = 0; iter < 300; iter++) {
      const grid = new Map();
      for (let i = 0; i < n; i++) {
        const key = Math.floor(x[i] / MIN_GAP) + ',' + Math.floor(y[i] / MIN_GAP);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(x[i] / MIN_GAP), cyy = Math.floor(y[i] / MIN_GAP);
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cyy - 1; gy <= cyy + 1; gy++) {
            const cell = grid.get(gx + ',' + gy);
            if (!cell) continue;
            for (const j of cell) {
              if (j <= i) continue;
              let dx = x[j] - x[i], dy = y[j] - y[i];
              let d = Math.hypot(dx, dy);
              if (d >= MIN_GAP) continue;
              if (d < 1e-6) {  // identical position: separate along a deterministic angle
                const a = i * 2.399963;
                dx = Math.cos(a); dy = Math.sin(a); d = 1;
              }
              const push = (MIN_GAP - Math.hypot(x[j] - x[i], y[j] - y[i])) / 2;
              const ux = dx / d, uy = dy / d;
              x[i] -= ux * push; y[i] -= uy * push;
              x[j] += ux * push; y[j] += uy * push;
              worst = Math.max(worst, push);
            }
          }
        }
      }
      // A weak pull back to the true position keeps each cluster compact and recognisable.
      for (let i = 0; i < n; i++) {
        x[i] += (x0[i] - x[i]) * 0.004;
        y[i] += (y0[i] - y[i]) * 0.004;
      }
      if (worst < 0.2) break;
    }

    nodes.forEach((nd, i) => {
      spread[nd.id()] = { dx: x[i] - x0[i], dy: y[i] - y0[i] };
      const m = hoverMarkers[nd.id()];  // tooltip target follows the displaced node
      if (m) m.setLatLng(map.containerPointToLatLng([x[i], y[i]]));
    });
  }

  function syncPositions() {
    if (!cy || !map) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const p = pointFor(n.data('lat'), n.data('lng'));
        const o = spread[n.id()];
        n.position(o ? { x: p.x + o.dx, y: p.y + o.dy } : p);
      });
    });
  }

  function allBounds() {
    return L.latLngBounds(cy.nodes().map((n) => [n.data('lat'), n.data('lng')]));
  }

  function spreadFits() {
    const c = map.getContainer();
    const w = c.clientWidth, h = c.clientHeight;
    return cy.nodes().every((n) => {
      const p = n.position();
      return p.x > 25 && p.x < w - 25 && p.y > 25 && p.y < h - 110;  // room for the 3-row legend
    });
  }

  // Zooms/centres so that every node (including the pushed-apart ones) is on screen at once.
  function fitAll() {
    if (!cy) return;
    if (!map) { cy.fit(undefined, 40); return; }
    map.invalidateSize();
    map.fitBounds(allBounds(), { padding: [60, 60], animate: false });
    recomputeSpread();
    syncPositions();
    for (let i = 0; i < 10 && !spreadFits(); i++) {
      map.setZoom(map.getZoom() - 0.25, { animate: false });
      recomputeSpread();
      syncPositions();
    }
    syncLabels();
  }

  function syncLabels() {
    if (!cy) return;
    const show = !map || map.getZoom() >= LABEL_ZOOM;
    cy.edges().forEach((e) => e.toggleClass('labeled', show));
    cy.nodes().forEach((n) => n.toggleClass('nolabel', !!map && map.getZoom() < NODE_LABEL_ZOOM));
    if (map) map.getContainer().classList.toggle('zoom-low', map.getZoom() < AREA_LABEL_ZOOM);
  }

  function nodeElement(n) {
    return {
      group: 'nodes',
      data: { id: n.id, label: n.id, type: n.type, zone: n.zone, lat: n.lat, lng: n.lng },
      position: pointFor(n.lat, n.lng),
    };
  }

  function edgeElement(e) {
    return {
      group: 'edges',
      data: { id: 'e' + (edgeCount++), source: e.from, target: e.to, weight: e.weight, zone: e.zone,
              label: e.weight.toFixed(1) + ' km' },
    };
  }

  function addHover(n) {
    if (!map) return;
    const kind = n.type === 'home' ? (n.hazardous ? 'hazardous site' : 'cluster') : n.type;
    const m = L.circleMarker([n.lat, n.lng], { radius: 12, stroke: false, fill: true, fillOpacity: 0 });
    m.bindTooltip(n.name + ' (' + n.id + ')<br>' + n.area + ' · ' + kind, { direction: 'top', offset: [0, -8] });
    hoverLayer.addLayer(m);
    hoverMarkers[n.id] = m;
  }

  function drawAreas() {
    if (!map || !areaLayer) return;
    areaLayer.clearLayers();
    const colors = THEMES[currentTheme()].edge;
    areas.forEach((a) => {
      const color = colors[a.zone] || '#888';
      const circle = L.circle([a.lat, a.lng], {
        radius: a.radiusKm * 1000, color, weight: 1.5, fillColor: color, fillOpacity: 0.12, interactive: false,
      });
      circle.bindTooltip(a.name, { permanent: true, direction: 'center', className: 'area-label', interactive: false });
      areaLayer.addLayer(circle);
    });
  }

  function init(container, graph) {
    areas = graph.areas || [];
    const usePlain = typeof L === 'undefined' || /[?&]plain=1/.test(location.search);
    document.querySelector('.canvas-wrap').classList.toggle('map-mode', !usePlain);

    if (!usePlain) {
      // No tile layer: the map is only a pan/zoom/projection surface on the plain background.
      // (Without tiles Leaflet needs explicit zoom limits.)
      map = L.map('map', { zoomControl: true, zoomAnimation: false, zoomSnap: 0.25, attributionControl: false,
                           minZoom: 9, maxZoom: 19 });
      areaLayer = L.layerGroup().addTo(map);
      hoverLayer = L.layerGroup().addTo(map);
      map.fitBounds(L.latLngBounds(graph.nodes.map((n) => [n.lat, n.lng])), { padding: [60, 60] });
    }

    cy = cytoscape({
      container,
      elements: [],
      layout: { name: 'preset' },
      wheelSensitivity: 0.3,
      userPanningEnabled: !map,
      userZoomingEnabled: !map,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: buildStyle(THEMES[currentTheme()]),
    });
    cy.add(graph.nodes.map(nodeElement));
    cy.add(graph.edges.map(edgeElement));
    graph.nodes.forEach(addHover);

    if (map) {
      map.on('move zoom viewreset resize', syncPositions);
      map.on('zoomend', () => { recomputeSpread(); syncPositions(); syncLabels(); });
      drawAreas();
    } else {
      cy.fit(undefined, 40);
    }
    syncPositions();
    syncLabels();
    if (map) {
      // The container may not have its final size yet (CSS / layout still settling): measure
      // again on the next frame and refit, otherwise the map renders in a corner of the panel.
      // (timers, not requestAnimationFrame: browsers pause rAF in background tabs)
      setTimeout(fitAll, 50);
      window.addEventListener('load', fitAll);
      window.addEventListener('resize', () => { map.invalidateSize(); syncPositions(); });
    }
    return cy;
  }

  // Appends freshly generated nodes/edges without rebuilding (keeps the current view).
  function addElements(nodes, edges) {
    if (!cy) return;
    cy.add(nodes.map(nodeElement));
    cy.add(edges.map(edgeElement));
    nodes.forEach(addHover);
    fitAll();  // new nodes must be visible too
  }

  // Replaces everything from a fresh /graph response (after a reset).
  function rebuild(graph) {
    if (!cy) return;
    animationToken++;
    cy.elements().remove();
    if (hoverLayer) hoverLayer.clearLayers();
    Object.keys(hoverMarkers).forEach((k) => delete hoverMarkers[k]);
    areas = graph.areas || areas;
    edgeCount = 0;
    cy.add(graph.nodes.map(nodeElement));
    cy.add(graph.edges.map(edgeElement));
    graph.nodes.forEach(addHover);
    drawAreas();
    fitAll();
  }

  function edgeBetween(a, b) {
    const hit = cy.edges().filter((e) => {
      const s = e.source().id(), t = e.target().id();
      return (s === a && t === b) || (s === b && t === a);
    });
    return hit.length ? hit[0] : null;
  }

  function clearRoute() {
    animationToken++;
    cy.elements().removeClass('route hazard-edge visited hazard-visited');
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Walks every hop of every segment, highlighting edges one after another. Total
  // animation time is capped so long routes do not drag.
  async function animateRoute(segments, kind) {
    clearRoute();
    const token = animationToken;
    const edgeClass = kind === 'hazard' ? 'hazard-edge' : 'route';
    const nodeClass = kind === 'hazard' ? 'hazard-visited' : 'visited';

    let hops = 0;
    segments.forEach((s) => { hops += Math.max(0, s.path.length - 1); });
    const delay = Math.max(80, Math.min(450, 7000 / Math.max(1, hops)));

    for (const seg of segments) {
      if (seg.path.length) cy.getElementById(seg.path[0]).addClass(nodeClass);
      for (let i = 0; i < seg.path.length - 1; i++) {
        if (token !== animationToken) return;
        const edge = edgeBetween(seg.path[i], seg.path[i + 1]);
        if (edge) edge.addClass(edgeClass);
        cy.getElementById(seg.path[i + 1]).addClass(nodeClass);
        await sleep(delay);
      }
    }
  }

  function markDue(ids, overflowIds) {
    cy.nodes().removeClass('due overflow');
    ids.forEach((id) => cy.getElementById(id).addClass('due'));
    (overflowIds || []).forEach((id) => cy.getElementById(id).addClass('overflow'));
  }

  // Needed after the canvas was hidden (Database tab) and shown again.
  function resize() {
    if (!cy) return;
    if (map) {
      map.invalidateSize();
      cy.resize();
      recomputeSpread();
      syncPositions();
    } else {
      cy.resize();
      cy.fit(undefined, 40);
    }
  }

  // Current on-screen centre of every node (used by tests / debugging).
  function nodePositions() {
    return cy.nodes().map((n) => ({ id: n.id(), x: n.position('x'), y: n.position('y') }));
  }

  return { init, addElements, rebuild, fitAll, nodePositions, animateRoute, clearRoute, markDue, resize, applyTheme };
})();

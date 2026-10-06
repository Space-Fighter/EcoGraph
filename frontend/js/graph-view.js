// City view: a clean schematic drawn with Cytoscape (no map underneath, so positions do not
// have to match real coordinates).
//   * every locality is a labelled box (a Cytoscape compound node) with its name ABOVE it;
//   * nodes inside a box sit on an even sunflower pattern, junction first so it ends up in the
//     middle of the star of roads around it;
//   * the boxes start where the localities really are in Dehradun and are then pushed apart,
//     so the overall shape is familiar but nothing overlaps.
const GraphView = (() => {
  // Cytoscape cannot read CSS variables, so the palette is mirrored here per theme.
  // Zone fill colours match --res/--com/--ind/--art in style.css (used by the legend).
  const THEMES = {
    light: {
      zone: { residential: '#8fd19e', commercial: '#8fb8e8', industrial: '#b8b8b8', arterial: '#f0efe9' },
      edge: { residential: '#4f9a62', commercial: '#4a82cc', industrial: '#7d7d7d', arterial: '#a39f90' },
      text: '#1c1c1c', nodeBorder: '#555555', depotBorder: '#143769',
      edgeLabel: '#444444', bg: '#ffffff', areaLabel: '#143769',
      due: '#f59e0b', route: '#143769', hazard: '#d62828',
    },
    dark: {
      zone: { residential: '#4f9e63', commercial: '#4d7fc2', industrial: '#7d8591', arterial: '#566070' },
      edge: { residential: '#5fb375', commercial: '#6a9be0', industrial: '#8f98a5', arterial: '#8691a4' },
      text: '#e6e9ee', nodeBorder: '#aab4c3', depotBorder: '#8ab4f8',
      edgeLabel: '#c5cdd9', bg: '#11161d', areaLabel: '#8ab4f8',
      due: '#fbbf24', route: '#7db3ff', hazard: '#ef5350',
    },
  };

  // Layout constants (pixels in the unzoomed drawing)
  const NODE_GAP = 60;                   // distance between neighbouring nodes in a locality
  const RING = NODE_GAP / 1.9;           // sunflower scale that gives ~NODE_GAP spacing
  const BUBBLE_PAD = 44;                 // room for the box padding and the name above it
  const BUBBLE_GAP = 26;                 // free space kept between two locality boxes
  const PX_PER_KM = 34;                  // where boxes start (real geography, scaled)
  const GOLDEN_ANGLE = 2.399963229728653;
  const EDGE_LABEL_ZOOM = 1.0;           // km labels on roads appear once zoomed in this far
  const TYPE_RANK = { junction: 0, depot: 1, bin: 2, home: 3 };

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function buildStyle(t) {
    return [
      { selector: 'node', style: {
          label: 'data(label)', 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 3, color: t.text,
          'text-background-color': t.bg, 'text-background-opacity': 0.75, 'text-background-padding': 1,
          'background-color': (n) => t.zone[n.data('zone')] || '#ddd',
          'border-width': 2, 'border-color': t.nodeBorder, width: 22, height: 22 } },
      { selector: 'node[type="depot"]', style: { shape: 'rectangle', width: 32, height: 32, 'border-width': 3, 'border-color': t.depotBorder, 'font-weight': 'bold' } },
      { selector: 'node[type="home"]', style: { shape: 'ellipse' } },
      { selector: 'node[type="bin"]', style: { shape: 'triangle', width: 28, height: 28 } },
      { selector: 'node[type="junction"]', style: { shape: 'ellipse', width: 12, height: 12, 'font-size': 9 } },
      // a locality box: tinted by zone, name above it, never under a node
      { selector: 'node:parent', style: {
          shape: 'round-rectangle', padding: 22, 'background-opacity': 0.13,
          'background-color': (n) => t.edge[n.data('zone')] || '#888',
          'border-width': 1.5, 'border-color': (n) => t.edge[n.data('zone')] || '#888', 'border-opacity': 0.8,
          label: 'data(label)', 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -5,
          'font-size': 13, 'font-weight': 'bold', color: t.areaLabel,
          'text-background-color': t.bg, 'text-background-opacity': 0.9, 'text-background-padding': 3,
          'text-background-shape': 'roundrectangle' } },
      { selector: 'edge', style: {
          width: 3, 'line-color': (e) => t.edge[e.data('zone')] || '#bbb', opacity: 0.95,
          'font-size': 9, color: t.edgeLabel,
          // road lengths run along the road and sit just above it, away from the node names
          'edge-text-rotation': 'autorotate', 'text-margin-y': -7,
          'text-background-color': t.bg, 'text-background-opacity': 0.85, 'text-background-padding': 1,
          'curve-style': 'straight' } },
      { selector: 'edge.labeled', style: { label: 'data(label)' } },
      { selector: 'node.due', style: { 'border-color': t.due, 'border-width': 5 } },
      { selector: 'node.overflow', style: { 'border-color': t.hazard, 'border-width': 6 } },
      { selector: 'node.visited', style: { 'border-color': t.route, 'border-width': 5 } },
      { selector: 'edge.route', style: { 'line-color': t.route, width: 6, opacity: 1, 'z-index': 10 } },
      { selector: 'edge.hazard-edge', style: { 'line-color': t.hazard, 'line-style': 'dashed', width: 6, opacity: 1, 'z-index': 10 } },
      { selector: 'node.hazard-visited', style: { 'border-color': t.hazard, 'border-width': 5 } },
    ];
  }

  let cy = null;
  let areas = [];            // localities from the server: name, zone, lat, lng
  let edgeCount = 0;
  let labelsOn = false;
  let animationToken = 0;    // bumping this cancels an animation in progress

  // Re-skins the canvas without touching positions or highlighted routes.
  function applyTheme() {
    if (cy) cy.style(buildStyle(THEMES[currentTheme()]));
  }

  // ---- layout -------------------------------------------------------------------------

  function project(lat, lng) {
    const kmPerDegLat = 111.19;
    const kmPerDegLng = 111.32 * Math.cos(30.33 * Math.PI / 180);
    return { x: (lng - 78.0) * kmPerDegLng * PX_PER_KM, y: -(lat - 30.33) * kmPerDegLat * PX_PER_KM };
  }

  function byTypeThenId(a, b) {
    const ra = TYPE_RANK[a.data('type')], rb = TYPE_RANK[b.data('type')];
    if (ra !== rb) return ra - rb;
    return a.id().localeCompare(b.id(), undefined, { numeric: true });
  }

  // Pushes locality boxes apart until none overlap, with a faint pull back to where they
  // really are so the city keeps a recognisable shape.
  function separateBubbles(groups) {
    for (let iter = 0; iter < 400; iter++) {
      let worst = 0;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i], b = groups[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const need = a.r + b.r + BUBBLE_GAP;
          if (d >= need) continue;
          if (d < 1e-6) { const ang = (i * 7 + j) * GOLDEN_ANGLE; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
          const push = (need - Math.hypot(b.x - a.x, b.y - a.y)) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
          worst = Math.max(worst, push);
        }
      }
      groups.forEach((g) => { g.x += (g.x0 - g.x) * 0.004; g.y += (g.y0 - g.y) * 0.004; });
      if (worst < 0.3) break;
    }
  }

  function runLayout() {
    if (!cy) return;
    const byArea = {};
    cy.nodes(':childless').forEach((n) => {
      const key = n.data('area') || '(unassigned)';
      (byArea[key] = byArea[key] || []).push(n);
    });

    const groups = Object.keys(byArea).map((name) => {
      const nodes = byArea[name].sort(byTypeThenId);
      const known = areas.find((a) => a.name === name);
      let lat = 0, lng = 0;
      if (known) { lat = known.lat; lng = known.lng; }
      else { nodes.forEach((n) => { lat += n.data('lat') / nodes.length; lng += n.data('lng') / nodes.length; }); }
      const c = project(lat, lng);
      return { name, nodes, x: c.x, y: c.y, x0: c.x, y0: c.y,
               r: RING * Math.sqrt(nodes.length) + NODE_GAP / 2 + BUBBLE_PAD };
    });

    separateBubbles(groups);

    cy.batch(() => {
      groups.forEach((g) => {
        g.nodes.forEach((n, i) => {
          const rr = RING * Math.sqrt(i + 0.5), th = i * GOLDEN_ANGLE;
          n.position({ x: g.x + rr * Math.cos(th), y: g.y + rr * Math.sin(th) });
        });
      });
    });
  }

  // ---- elements -----------------------------------------------------------------------

  function areaId(name) { return 'area:' + name; }

  function areaZone(name) {
    const a = areas.find((x) => x.name === name);
    return a ? a.zone : 'arterial';
  }

  function nodeElement(n) {
    const kind = n.type === 'home' ? (n.hazardous ? 'hazardous site' : 'household / business cluster')
               : n.type === 'bin' ? 'disposal site (' + (n.binType || 'bin') + ')'
               : n.type;
    return {
      group: 'nodes',
      data: { id: n.id, label: n.id, type: n.type, zone: n.zone, lat: n.lat, lng: n.lng,
              name: n.name || n.id, area: n.area || '', kind, parent: n.area ? areaId(n.area) : undefined },
    };
  }

  function edgeElement(e) {
    return {
      group: 'edges',
      data: { id: 'e' + (edgeCount++), source: e.from, target: e.to, weight: e.weight, zone: e.zone,
              label: e.weight.toFixed(1) + ' km' },
    };
  }

  // Locality boxes that do not exist yet (parents must exist before their children).
  function areaElements(nodes) {
    const seen = new Set();
    const out = [];
    nodes.forEach((n) => {
      if (!n.area || seen.has(n.area) || cy.getElementById(areaId(n.area)).nonempty()) return;
      seen.add(n.area);
      out.push({ group: 'nodes', data: { id: areaId(n.area), label: n.area, zone: areaZone(n.area), isArea: true } });
    });
    return out;
  }

  function addAll(nodes, edges) {
    cy.add(areaElements(nodes));
    cy.add(nodes.map(nodeElement));
    cy.add(edges.map(edgeElement));
  }

  // ---- view ---------------------------------------------------------------------------

  // Road lengths ("2.4 km") are only drawn once zoomed in enough to read them.
  function syncLabels(force) {
    if (!cy) return;
    const show = cy.zoom() >= EDGE_LABEL_ZOOM;
    if (show === labelsOn && force !== true) return;
    labelsOn = show;
    cy.edges().toggleClass('labeled', show);
  }

  // Zooms/centres so that every node is on screen at once.
  function fitAll() {
    if (!cy) return;
    cy.resize();
    cy.fit(cy.elements(), 36);
    syncLabels(true);  // new edges (after adding nodes) need the label state applied too
  }

  function setupTooltip(container) {
    const tip = document.getElementById('node-tip');
    if (!tip) return;
    const hide = () => { tip.hidden = true; };
    cy.on('mouseover', 'node:childless', (e) => {
      const n = e.target;
      tip.replaceChildren();
      const title = document.createElement('b');
      title.textContent = n.data('name') + ' (' + n.id() + ')';
      const sub = document.createElement('div');
      sub.textContent = (n.data('area') ? n.data('area') + ' · ' : '') + n.data('kind');
      tip.append(title, sub);
      const p = n.renderedPosition();
      tip.style.left = (container.offsetLeft + p.x) + 'px';
      tip.style.top = (container.offsetTop + p.y - 20) + 'px';
      tip.hidden = false;
    });
    cy.on('mouseout', 'node:childless', hide);
    cy.on('viewport', hide);
  }

  function init(container, graph) {
    areas = graph.areas || [];
    cy = cytoscape({
      container,
      elements: [],
      layout: { name: 'preset' },
      wheelSensitivity: 0.3,
      minZoom: 0.15,
      maxZoom: 3,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: buildStyle(THEMES[currentTheme()]),
    });
    addAll(graph.nodes, graph.edges);
    runLayout();
    setupTooltip(container);
    cy.on('zoom', syncLabels);
    fitAll();
    window.addEventListener('resize', () => { cy.resize(); });
    return cy;
  }

  // Appends freshly generated nodes/edges and re-lays-out so boxes make room for them.
  function addElements(nodes, edges) {
    if (!cy) return;
    addAll(nodes, edges);
    runLayout();
    fitAll();  // new nodes must be visible too
  }

  // Removes nodes (their roads go with them) and any locality box left empty, then re-lays-out.
  function removeNodes(ids) {
    if (!cy) return;
    ids.forEach((id) => cy.getElementById(id).remove());
    cy.nodes(':parent').forEach((p) => { if (p.children().empty()) p.remove(); });
    runLayout();
    fitAll();
  }

  // Replaces everything from a fresh /graph response (after a reset).
  function rebuild(graph) {
    if (!cy) return;
    animationToken++;
    cy.elements().remove();
    areas = graph.areas || areas;
    edgeCount = 0;
    addAll(graph.nodes, graph.edges);
    runLayout();
    fitAll();
  }

  // ---- routes and highlighting --------------------------------------------------------

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
    if (cy) fitAll();
  }

  // Current drawing position of every real node, not the locality boxes (used by tests).
  function nodePositions() {
    return cy.nodes(':childless').map((n) => ({ id: n.id(), x: n.position('x'), y: n.position('y') }));
  }

  return { init, addElements, removeNodes, rebuild, fitAll, nodePositions, animateRoute, clearRoute, markDue, resize, applyTheme };
})();

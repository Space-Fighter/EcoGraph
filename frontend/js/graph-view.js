// Cytoscape canvas: rendering, zone styling and route animation.
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

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function buildStyle(t) {
    return [
      { selector: 'node', style: {
          label: 'data(label)', 'font-size': 11, 'text-valign': 'bottom', 'text-margin-y': 4, color: t.text,
          'background-color': (n) => t.zone[n.data('zone')] || '#ddd',
          'border-width': 2, 'border-color': t.nodeBorder, width: 30, height: 30 } },
      { selector: 'node[type="depot"]', style: { shape: 'rectangle', width: 40, height: 40, 'border-width': 3, 'border-color': t.depotBorder, 'font-weight': 'bold' } },
      { selector: 'node[type="home"]', style: { shape: 'ellipse' } },
      { selector: 'node[type="bin"]', style: { shape: 'triangle', width: 36, height: 36 } },
      { selector: 'node[type="junction"]', style: { shape: 'ellipse', width: 14, height: 14, 'font-size': 9 } },
      { selector: 'edge', style: {
          width: 3, 'line-color': (e) => t.edge[e.data('zone')] || '#bbb',
          label: 'data(label)', 'font-size': 9, color: t.edgeLabel,
          'text-background-color': t.edgeLabelBg, 'text-background-opacity': 0.85, 'text-background-padding': 2,
          'curve-style': 'bezier' } },
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
  }

  let cy = null;
  let animationToken = 0;  // bumping this cancels an animation in progress

  function init(container, graph) {
    const elements = [];
    graph.nodes.forEach((n) => {
      elements.push({
        group: 'nodes',
        data: { id: n.id, label: n.id, type: n.type, zone: n.zone },
        position: { x: n.x, y: n.y },
      });
    });
    graph.edges.forEach((e, i) => {
      elements.push({
        group: 'edges',
        data: { id: 'e' + i, source: e.from, target: e.to, weight: e.weight, zone: e.zone, label: String(e.weight) },
      });
    });

    cy = cytoscape({
      container,
      elements,
      layout: { name: 'preset', padding: 40 },
      wheelSensitivity: 0.3,
      style: buildStyle(THEMES[currentTheme()]),
    });
    cy.fit(undefined, 40);
    return cy;
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
    const delay = Math.max(120, Math.min(450, 7000 / Math.max(1, hops)));

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
    cy.resize();
    cy.fit(undefined, 40);
  }

  return { init, animateRoute, clearRoute, markDue, resize, applyTheme };
})();

// Checks the isometric plan: run with `node tools/check-iso-layout.js [server-city.json]`.
// Reports road quality for the default city and for a large city, and fails on broken output.
const path = require('path');
const IsoLayout = require('../frontend/js/iso-layout.js');
const city = require(process.argv[2] || path.join('..', 'server', 'data', 'city.json'));

let failures = 0;
function check(ok, message) {
  if (!ok) { failures++; console.log('  FAIL: ' + message); }
}

function report(label, data) {
  const start = Date.now();
  const plan = IsoLayout.compute(data);
  const ms = Date.now() - start;
  const levels = [0, 0, 0];
  plan.roads.forEach((r) => { levels[r.level]++; });
  console.log(`${label}: ${data.nodes.length} nodes, ${plan.roads.length} roads, ${plan.crossings.length} bridges, ` +
              `fallback roads ${levels[1]}+${levels[2]}, ${ms} ms`);

  check(plan.roads.length === data.edges.length, 'every road is routed');
  const seenHub = new Set();
  plan.hubs.forEach((p) => {
    const key = p.x + ',' + p.y;
    check(!seenHub.has(key), 'two nodes share hub ' + key);
    seenHub.add(key);
  });
  const blocked = new Set();
  plan.plots.forEach((p) => {
    for (let dx = 1; dx <= 3; dx++) for (let dy = 1; dy <= 3; dy++) blocked.add((p.hx - dx) + ',' + (p.hy - dy));
  });
  plan.hubs.forEach((p) => check(!blocked.has(p.x + ',' + p.y), 'a hub sits on a plot'));
  plan.roads.forEach((r) => {
    const a = plan.hubs.get(r.from), b = plan.hubs.get(r.to);
    const first = r.cells[0], last = r.cells[r.cells.length - 1];
    check(first.x === a.x && first.y === a.y && last.x === b.x && last.y === b.y, `${r.from}-${r.to} ends at its hubs`);
    r.cells.forEach((c, i) => {
      if (i) check(Math.abs(c.x - r.cells[i - 1].x) + Math.abs(c.y - r.cells[i - 1].y) === 1, `${r.from}-${r.to} stays on grid axes`);
      if (r.level < 2) check(!blocked.has(c.x + ',' + c.y), `${r.from}-${r.to} drives through a building`);
    });
  });
  plan.localities.forEach((a, i) => plan.localities.slice(i + 1).forEach((b) => {
    const clear = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    check(clear, `${a.name} overlaps ${b.name}`);
  }));
  const span = Math.max(plan.bounds.x1 - plan.bounds.x0, plan.bounds.y1 - plan.bounds.y0);
  check(span < 40 + 9 * Math.sqrt(data.nodes.length) * 3, 'city stays compact, span ' + span);
  const again = IsoLayout.compute(data);
  check(JSON.stringify(again.roads) === JSON.stringify(plan.roads), 'layout is deterministic');
  return plan;
}

report('default city', city);

// A city grown the way the city builder grows it: extra nodes joined to their locality's junction.
const big = { areas: city.areas, nodes: city.nodes.slice(), edges: city.edges.map((e) => ({ ...e })) };
for (let i = 0; i < 200; i++) {
  const area = city.areas[i % city.areas.length];
  const anchor = city.nodes.find((n) => n.area === area.name && n.type === 'junction') || city.nodes.find((n) => n.area === area.name);
  const id = 'X' + i;
  big.nodes.push({ id, type: 'home', area: area.name, zone: area.zone, lat: area.lat, lng: area.lng });
  big.edges.push({ from: id, to: anchor.id, zone: area.zone, weight: 1 });
  if (i % 3 === 0) big.edges.push({ from: id, to: big.nodes[big.nodes.length - 2].id, zone: area.zone, weight: 1 });
}
report('large city', big);

if (failures) { console.log(failures + ' problem(s) found'); process.exit(1); }
console.log('All iso layout checks passed');

// "City builder": add random nodes, or reset to the original city, so the simulation
// can be stress-tested. The city lives on the server, so added nodes survive a page refresh
// until the city is reset.
const CityBuilder = (() => {
  const $ = (id) => document.getElementById(id);
  let total = 0;
  let added = 0;

  function showCount() {
    $('builder-count').textContent = '(' + total + ' nodes' + (added ? ', ' + added + ' added' : '') + ')';
    const status = $('status');  // keep the header badge's node count in step
    if (status.classList.contains('ok')) status.textContent = 'connected - ' + total + ' nodes';
  }

  function say(text, isError) {
    const box = $('builder-msg');
    box.textContent = text;
    box.classList.toggle('error', !!isError);
  }

  function setBusy(busy) {
    ['builder-add', 'builder-reset'].forEach((id) => { $(id).disabled = busy; });
    if (!busy) showCount();
  }

  // "home-haz" -> { type: 'home', hazardous: true }
  function parseType(value) {
    const hazardous = value.endsWith('-haz');
    return { type: hazardous ? value.slice(0, -4) : value, hazardous };
  }

  function readParams() {
    const { type, hazardous } = parseType($('builder-type').value);
    const raw = parseInt($('builder-count-input').value, 10);
    const count = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : 1;
    return { type, hazardous, count };
  }

  async function refreshViews() {
    await ScheduleView.refresh();
    await DatabaseView.refreshIfVisible();
  }

  async function add() {
    const params = readParams();
    setBusy(true);
    try {
      const res = await Api.generateNodes(params);
      GraphView.addElements(res.nodes, res.edges);
      total = res.totalNodes;
      added += res.nodes.length;
      const where = Array.from(new Set(res.nodes.map((n) => n.area))).join(', ');
      say('Added ' + res.nodes.length + ' (' + res.nodes.map((n) => n.id).slice(0, 6).join(', ') +
          (res.nodes.length > 6 ? ', …' : '') + ') in ' + where + '.');
      $('builder-note').textContent = '';
      await refreshViews();
    } catch (e) {
      say(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  // Original city back, simulation restarted at day 0.
  async function resetCity() {
    if (SimulationView.isRunning()) {
      say('Stop the simulation first, then reset the city.', true);
      return;
    }
    const ok = window.confirm('Reset the city?\n\nEverything you added is removed, the original city is restored, ' +
                              'and the simulation restarts at day 0.');
    if (!ok) return;
    setBusy(true);
    try {
      await SimulationView.reset();  // calls CityBuilder.reset() with the fresh city
    } finally {
      setBusy(false);
    }
  }

  // Called after a reset, with the original city.
  function reset(graph) {
    total = graph.nodes.length;
    added = 0;
    showCount();
    $('builder-note').textContent = '';
    say('Reset: back to the original city and day 0.');
  }

  function init(graph) {
    total = graph.nodes.length;
    added = graph.nodes.filter((n) => n.generated).length;
    showCount();
    if (added) {
      // The city is kept by the server, so a page refresh does not clear what was added.
      $('builder-note').textContent = added + ' added node(s) from earlier are still here: the server keeps ' +
                                      'them until you press Reset city.';
    }
    $('builder-add').addEventListener('click', add);
    $('builder-reset').addEventListener('click', resetCity);
  }

  return { init, reset };
})();

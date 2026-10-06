// Simulation panel: step or play through days under the chosen fleet limits, animating
// each truck's route on the map.
const SimulationView = (() => {
  const $ = (id) => document.getElementById(id);
  let running = false;
  let stopRequested = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clampInt(id, min, max, fallback) {
    const v = parseInt($(id).value, 10);
    return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  }

  function params() {
    return {
      days: 1,
      autoCollect: $('sim-auto').checked,
      mode: $('sim-mode').value,
      normalTrucks: clampInt('fleet-normal', 0, 20, 2),
      normalCapacity: clampInt('fleet-capacity', 1, 100000, 200),
      hazardTrucks: clampInt('fleet-hazard', 0, 10, 1),
    };
  }

  function showStatus(sim) {
    $('sim-day').textContent = 'Day ' + sim.day;
    $('sim-date').textContent = '(' + sim.date + ')';
  }

  function setBusy(busy) {
    running = busy;
    ['sim-step', 'sim-play', 'sim-reset', 'sim-days', 'sim-auto', 'sim-mode',
     'fleet-normal', 'fleet-capacity', 'fleet-hazard'].forEach((id) => { $(id).disabled = busy; });
    $('sim-stop').disabled = !busy;
  }

  function line(parts, cls) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = parts;
    return span;
  }

  function addHistory(d) {
    const li = document.createElement('li');
    const head = document.createElement('b');
    head.textContent = 'Day ' + d.day + ' (' + d.date + ')';
    li.appendChild(head);

    const summary = [d.due.length + ' due'];
    if (d.emptiedBins.length) summary.push('bins emptied: ' + d.emptiedBins.join(', '));
    if (d.totalCost) summary.push('total distance ' + d.totalCost.toFixed(1) + ' km');
    li.appendChild(line(summary.join(' · ')));

    d.trucks.forEach((t) => {
      const load = t.kind === 'normal' ? ' (' + t.load.toFixed(0) + '/' + t.capacity.toFixed(0) + ' kg)' : ' (' + t.load.toFixed(0) + ' kg)';
      const dest = t.kind === 'hazard' ? ' -> ' + t.bin : '';
      li.appendChild(line(t.id + ': ' + t.homes.join(', ') + load + dest + ', ' + t.cost.toFixed(1) + ' km', 'truck'));
    });
    if (d.carriedOver.length) li.appendChild(line('Waiting for a free truck: ' + d.carriedOver.join(', '), 'alert'));
    if (d.overflowIds.length) li.appendChild(line('Overflowing this morning: ' + d.overflowIds.join(', '), 'alert'));
    if (d.failed.length) li.appendChild(line('Unreachable: ' + d.failed.join(', '), 'alert'));

    const list = $('sim-history');
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 60) list.removeChild(list.lastChild);
  }

  async function refreshViews() {
    await ScheduleView.refresh();
    await DatabaseView.refreshIfVisible();
  }

  // One day at a time so each day's trucks can be animated before the next day starts.
  async function run(days) {
    stopRequested = false;
    setBusy(true);
    try {
      for (let i = 0; i < days && !stopRequested; i++) {
        const res = await Api.advance(params());
        const d = res.days[0];
        showStatus(res.simulation);
        addHistory(d);
        await refreshViews();
        for (const truck of d.trucks) {
          if (stopRequested) break;
          await GraphView.animateRoute(truck.segments, truck.kind === 'hazard' ? 'hazard' : 'normal');
        }
        if (days > 1) await sleep(500);
      }
    } catch (e) {
      const li = document.createElement('li');
      li.appendChild(line(e.message, 'alert'));
      $('sim-history').insertBefore(li, $('sim-history').firstChild);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    try {
      const res = await Api.resetSimulation();
      GraphView.clearRoute();
      const graph = await Api.getGraph();  // generated nodes are gone: redraw the original city
      GraphView.rebuild(graph);
      CityBuilder.reset(graph);
      $('sim-history').replaceChildren();
      showStatus(res.simulation);
      await refreshViews();
    } catch (e) {
      alert(e.message);
    }
  }

  async function init() {
    $('sim-step').addEventListener('click', () => run(1));
    $('sim-play').addEventListener('click', () => run(clampInt('sim-days', 1, 60, 1)));
    $('sim-stop').addEventListener('click', () => { stopRequested = true; GraphView.clearRoute(); });
    $('sim-reset').addEventListener('click', reset);
    $('sim-stop').disabled = true;
    showStatus(await Api.getSimulation());
  }

  return { init, isRunning: () => running };
})();

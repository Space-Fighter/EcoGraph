// Simulation panel: step or play through days, animating each day's routes on the map.
const SimulationView = (() => {
  const $ = (id) => document.getElementById(id);
  let running = false;
  let stopRequested = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function showStatus(sim) {
    $('sim-day').textContent = 'Day ' + sim.day;
    $('sim-date').textContent = '(' + sim.date + ')';
  }

  function setBusy(busy) {
    running = busy;
    ['sim-step', 'sim-play', 'sim-reset', 'sim-days', 'sim-auto'].forEach((id) => { $(id).disabled = busy; });
    $('sim-stop').disabled = !busy;
  }

  function addHistory(d) {
    const li = document.createElement('li');
    const head = document.createElement('b');
    head.textContent = 'Day ' + d.day + ' (' + d.date + ')';
    const body = document.createElement('span');
    const parts = [d.due.length + ' due'];
    if (d.overflowCount) parts.push(d.overflowCount + ' overflowing');
    const picked = d.collected.concat(d.hazardCollected);
    if (picked.length) parts.push('collected ' + picked.join(', '));
    if (d.emptiedBins.length) parts.push('emptied ' + d.emptiedBins.join(', '));
    if (d.routeCost) parts.push('route cost ' + d.routeCost.toFixed(1));
    if (d.hazardCost) parts.push('hazard cost ' + d.hazardCost.toFixed(1));
    if (d.failed.length) parts.push('FAILED ' + d.failed.join(', '));
    body.textContent = parts.join(' · ');
    li.append(head, body);
    const list = $('sim-history');
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 60) list.removeChild(list.lastChild);
  }

  async function refreshViews() {
    await ScheduleView.refresh();
    await DatabaseView.refreshIfVisible();
  }

  // Advances one day at a time so every day can be animated before the next begins.
  async function run(days) {
    const auto = $('sim-auto').checked;
    stopRequested = false;
    setBusy(true);
    try {
      for (let i = 0; i < days && !stopRequested; i++) {
        const res = await Api.advance(1, auto);
        const d = res.days[0];
        showStatus(res.simulation);
        addHistory(d);
        await refreshViews();
        if (d.segments.length) await GraphView.animateRoute(d.segments, 'normal');
        if (d.hazardSegments.length) await GraphView.animateRoute(d.hazardSegments, 'hazard');
        if (days > 1) await sleep(500);
      }
    } catch (e) {
      addHistory({ day: '?', date: '', due: [], overflowCount: 0, collected: [], hazardCollected: [], emptiedBins: [], failed: [], routeCost: 0, hazardCost: 0 });
      $('sim-history').firstChild.lastChild.textContent = e.message;
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    try {
      const res = await Api.resetSimulation();
      GraphView.clearRoute();
      $('sim-history').replaceChildren();
      showStatus(res.simulation);
      await refreshViews();
    } catch (e) {
      alert(e.message);
    }
  }

  async function init() {
    $('sim-step').addEventListener('click', () => run(1));
    $('sim-play').addEventListener('click', () => run(Math.max(1, Math.min(60, parseInt($('sim-days').value, 10) || 1))));
    $('sim-stop').addEventListener('click', () => { stopRequested = true; GraphView.clearRoute(); });
    $('sim-reset').addEventListener('click', reset);
    $('sim-stop').disabled = true;
    showStatus(await Api.getSimulation());
  }

  return { init, isRunning: () => running };
})();

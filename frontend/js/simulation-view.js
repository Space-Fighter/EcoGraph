// Simulation panel: step or play through days under the chosen fleet limits. All of a day's trucks
// drive at once on the map, the camera follows one of them, and playback can be paused.
const SimulationView = (() => {
  const $ = (id) => document.getElementById(id);
  let running = false;
  let stopRequested = false;
  let paused = false;
  let resumeWaiters = [];

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
    $('sim-pause').disabled = !busy;
    if (!busy) setPaused(false);
  }

  function setPaused(value) {
    paused = value;
    GraphView.setPaused(value);
    $('sim-pause').textContent = value ? 'Resume' : 'Pause';
    $('sim-pause').setAttribute('aria-pressed', String(value));
    if (!value) {
      resumeWaiters.forEach((fn) => fn());
      resumeWaiters = [];
    }
  }

  function untilResumed() {
    return paused ? new Promise((r) => resumeWaiters.push(r)) : Promise.resolve();
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
      const dest = t.kind === 'hazard'
        ? ' -> ' + t.bin + (t.exposureKm > 0 ? ' (' + t.exposureKm.toFixed(1) + ' km through populated roads)' : '')
        : '';
      li.appendChild(line(t.id + ': ' + t.homes.join(', ') + load + dest + ', ' + t.cost.toFixed(1) + ' km', 'truck'));
    });
    if (d.carriedOver.length) li.appendChild(line('Waiting for a free truck: ' + d.carriedOver.join(', '), 'alert'));
    if (d.overflowIds.length) li.appendChild(line('Overflowing this morning: ' + d.overflowIds.join(', '), 'alert'));
    if (d.failed.length) li.appendChild(line('Unreachable: ' + d.failed.join(', '), 'alert'));

    const list = $('sim-history');
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 60) list.removeChild(list.lastChild);
  }

  function renderTrucks(trucks, following) {
    const list = $('truck-list');
    list.replaceChildren();
    if (!trucks.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No trucks went out on this day.';
      list.appendChild(li);
      return;
    }
    trucks.forEach((t) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'truck-row' + (t.id === following ? ' following' : '');
      btn.dataset.truck = t.id;
      btn.title = 'Follow ' + t.id + ' on the map';
      const img = document.createElement('img');
      img.src = 'assets/sprites/truck-' + (t.kind === 'hazard' ? 'hazard' : 'normal') + '-se.svg';
      img.alt = '';
      const text = document.createElement('span');
      const name = document.createElement('b');
      const load = t.kind === 'normal' ? t.load.toFixed(0) + '/' + t.capacity.toFixed(0) + ' kg' : t.load.toFixed(0) + ' kg';
      name.textContent = t.id + ' · ' + load;
      const stops = document.createElement('small');
      stops.textContent = (t.homes.length ? t.homes.join(', ') : 'no stops') + (t.bin ? ' → ' + t.bin : '');
      text.append(name, stops);
      const km = document.createElement('span');
      km.className = 'km';
      km.textContent = t.cost.toFixed(1) + ' km';
      btn.append(img, text, km);
      btn.addEventListener('click', () => GraphView.follow(t.id));
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function markFollowing(id) {
    document.querySelectorAll('.truck-row').forEach((b) => b.classList.toggle('following', b.dataset.truck === id));
    $('truck-follow-note').textContent = id ? '(following ' + id + ')' : '';
  }

  async function refreshViews() {
    await ScheduleView.refresh();
    await DatabaseView.refreshIfVisible();
  }

  const PHASES = [[5, 'Night'], [7, 'Sunrise'], [12, 'Morning'], [17.5, 'Afternoon'], [20, 'Sunset'], [24, 'Night']];

  function showClock(hours) {
    const h = Math.floor(hours), m = Math.floor((hours - h) * 12) * 5;
    $('sim-time').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    const phase = PHASES.find((p) => hours < p[0]);
    $('sim-phase').textContent = phase ? phase[1] : 'Night';
    $('sky-icon').classList.toggle('night', hours < 6 || hours >= 19);
    Backdrop.setHours(hours);
  }

  // The slider is in doublings: 0 is 1x, -2 is 0.25x. The choice is remembered per browser.
  function applySpeed(power) {
    const speed = Math.pow(2, power);
    GraphView.setSpeed(speed);
    const text = speed >= 1 ? speed.toFixed(speed % 1 ? 1 : 0) : speed.toFixed(2).replace(/0$/, '');
    $('sim-speed-label').textContent = text + 'x';
  }

  function setupSpeed() {
    const slider = $('sim-speed');
    try {
      const saved = localStorage.getItem('eco-speed');
      if (saved !== null && Number.isFinite(+saved)) slider.value = saved;
    } catch (e) { /* storage blocked: use the default */ }
    applySpeed(+slider.value);
    slider.addEventListener('input', () => {
      applySpeed(+slider.value);
      try { localStorage.setItem('eco-speed', slider.value); } catch (e) { /* keep it for this visit only */ }
    });
  }

  // One day at a time. The server has finished the day's collections before its reply arrives, so
  // the map holds the morning's bubbles and clears each one as its truck gets there.
  async function run(days) {
    stopRequested = false;
    setBusy(true);
    try {
      for (let i = 0; i < days && !stopRequested; i++) {
        await untilResumed();
        if (stopRequested) break;
        ScheduleView.holdMap(true);
        const before = await Api.getDatabase();
        const res = await Api.advance(params());
        const d = res.days[0];
        showStatus(res.simulation);
        addHistory(d);
        await refreshViews();
        // Bins are emptied at the start of the day with no truck, so they get no bubble to wait on.
        const emptied = new Set(d.emptiedBins);
        const waiting = (ids) => ids.filter((id) => !emptied.has(id));
        GraphView.markDue(waiting(d.due), waiting(d.overflowIds));
        ScheduleView.showMorningBars(before.nodes, d);
        const playing = GraphView.animateDay(d.trucks);
        renderTrucks(d.trucks, null);
        await playing;
        ScheduleView.holdMap(false);
        if (!stopRequested) await GraphView.nightPass();
      }
    } catch (e) {
      const li = document.createElement('li');
      li.appendChild(line(e.message, 'alert'));
      $('sim-history').insertBefore(li, $('sim-history').firstChild);
    } finally {
      ScheduleView.holdMap(false);
      setBusy(false);
    }
  }

  async function reset() {
    try {
      const res = await Api.resetSimulation();
      GraphView.clearRoute();
      const graph = await Api.getGraph();  // generated nodes are gone: redraw the original city
      await GraphView.rebuild(graph);
      CityBuilder.reset(graph);
      $('sim-history').replaceChildren();
      const list = $('truck-list');
      list.replaceChildren();
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Trucks appear here once a day is played.';
      list.appendChild(li);
      showStatus(res.simulation);
      await refreshViews();
    } catch (e) {
      alert(e.message);
    }
  }

  async function init() {
    $('sim-step').addEventListener('click', () => run(1));
    $('sim-play').addEventListener('click', () => run(clampInt('sim-days', 1, 60, 1)));
    $('sim-pause').addEventListener('click', () => setPaused(!paused));
    $('sim-stop').addEventListener('click', () => {
      stopRequested = true;
      setPaused(false);
      GraphView.clearRoute();
    });
    $('sim-reset').addEventListener('click', reset);
    $('sim-stop').disabled = true;
    GraphView.onFollowChange(markFollowing);
    GraphView.onClockChange(showClock);
    setupSpeed();
    showStatus(await Api.getSimulation());
  }

  return { init, reset, isRunning: () => running };
})();

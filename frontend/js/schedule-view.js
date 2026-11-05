// Polls /schedule, flags due nodes on the canvas and mirrors them in the sidebar list.
const ScheduleView = (() => {
  const POLL_MS = 30000;
  const TOP_FILLED = 10;
  let timer = null;
  let listeners = [];
  let mapHeld = false;
  let latest = null;

  function onUpdate(fn) { listeners.push(fn); }

  // The fullest homes and bins get a fill bar on the map.
  function showFullest(rows) {
    const top = rows.slice().sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id, undefined, { numeric: true }));
    GraphView.setFillBars(top.slice(0, TOP_FILLED));
  }

  const collectable = (nodes) => nodes.filter((n) => typeof n.percentFull === 'number');

  async function paintFillBars() {
    const db = await Api.getDatabase();
    if (mapHeld) return;  // a day started meanwhile, and its own bars are already up
    showFullest(collectable(db.nodes).map((n) => ({ id: n.id, percent: n.percentFull, status: n.status })));
  }

  // The bars for the start of a day: the previous levels plus one more day of filling. The server
  // has already done the pickups by now, so its current levels would give the result away.
  function showMorningBars(previousNodes, day) {
    const emptied = new Set(day.emptiedBins);
    const due = new Set(day.due);
    const over = new Set(day.overflowIds);
    showFullest(collectable(previousNodes).filter((n) => !emptied.has(n.id) && n.capacity > 0).map((n) => ({
      id: n.id,
      percent: n.percentFull + (100 * n.fillRate) / n.capacity,
      status: over.has(n.id) ? 'overflow' : due.has(n.id) ? 'due' : 'ok',
    })));
  }

  function paintMap(schedule) {
    GraphView.markDue(schedule.due.map((d) => d.id), schedule.overflow || []);
    paintFillBars().catch(() => { /* the next poll will try again */ });
  }

  // While a day plays out, the side list updates straight away but the map keeps its bubbles,
  // so a bubble lasts until its truck arrives. Releasing the hold shows the latest schedule.
  function holdMap(hold) {
    mapHeld = hold;
    if (!hold && latest) paintMap(latest);
  }

  function render(schedule) {
    latest = schedule;
    document.getElementById('schedule-date').textContent = '(' + schedule.date + ')';
    const list = document.getElementById('due-list');
    list.replaceChildren();
    if (!schedule.due.length) {
      const li = document.createElement('li');
      li.textContent = 'Nothing is due right now.';
      list.appendChild(li);
    }
    schedule.due.forEach((d) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = d.id + ' (' + d.type + ')';
      const late = document.createElement('span');
      late.textContent = '+' + d.overdueByDays.toFixed(1) + ' d overdue';
      li.append(name, late);
      list.appendChild(li);
    });
    if (!mapHeld) paintMap(schedule);
  }

  async function refresh() {
    const schedule = await Api.getSchedule();
    render(schedule);
    listeners.forEach((fn) => fn(schedule));
    return schedule;
  }

  function start() {
    stop();
    timer = setInterval(() => refresh().catch(() => {}), POLL_MS);
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { refresh, start, stop, onUpdate, holdMap, showMorningBars };
})();

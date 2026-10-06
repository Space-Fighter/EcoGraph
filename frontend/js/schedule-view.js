// Polls /schedule, flags due nodes on the canvas and mirrors them in the sidebar list.
const ScheduleView = (() => {
  const POLL_MS = 30000;
  let timer = null;
  let listeners = [];

  function onUpdate(fn) { listeners.push(fn); }

  function render(schedule) {
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
    GraphView.markDue(schedule.due.map((d) => d.id), schedule.overflow || []);
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

  return { refresh, start, stop, onUpdate };
})();

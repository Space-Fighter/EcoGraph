// Tells the other views when the city's state may have changed, on a timer and after each update.
const ScheduleView = (() => {
  const POLL_MS = 30000;
  let timer = null;
  let listeners = [];

  function onUpdate(fn) { listeners.push(fn); }

  async function refresh() {
    listeners.forEach((fn) => fn());
  }

  function start() {
    stop();
    timer = setInterval(() => refresh().catch(() => {}), POLL_MS);
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { refresh, start, stop, onUpdate };
})();

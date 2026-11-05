// Boot sequence: wait for the server -> map -> controls -> schedule polling.
document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const splash = document.getElementById('splash');
  const splashMsg = document.getElementById('splash-msg');
  const RETRY_MS = 3000;

  Glass.init();

  // A sleeping free-tier server can take a while to answer, so keep trying rather than fail.
  async function waitForCity() {
    for (;;) {
      try {
        return await Api.getGraph();
      } catch (e) {
        status.textContent = 'waiting for the server…';
        splashMsg.textContent = 'Waking the server… this can take up to a minute.';
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
  }

  try {
    if (!window.PIXI) throw new Error('Could not load the map library. Check the internet connection and reload.');
    const graph = await waitForCity();
    splashMsg.textContent = 'Building the city…';
    await GraphView.init(document.getElementById('cy'), graph);
    document.getElementById('fit-all').addEventListener('click', () => GraphView.fitAll());
    CityBuilder.init(graph);
    DatabaseView.init();
    await SimulationView.init();
    await ScheduleView.refresh();
    ScheduleView.start();
    status.textContent = 'connected - ' + graph.nodes.length + ' nodes';
    status.className = 'status ok';
    splash.classList.add('done');
    setTimeout(() => { splash.hidden = true; }, 400);
  } catch (e) {
    status.textContent = e.message;
    status.className = 'status err';
    splashMsg.textContent = e.message;
    document.querySelector('.splash-bar').hidden = true;
  }
});

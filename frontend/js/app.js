// Boot sequence: graph -> canvas -> controls -> schedule polling.
document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  Theme.init();  // the toggle works even if the server is unreachable
  try {
    const graph = await Api.getGraph();
    GraphView.init(document.getElementById('cy'), graph);
    document.getElementById('fit-all').addEventListener('click', () => GraphView.fitAll());
    CityBuilder.init(graph);
    DatabaseView.init();
    await SimulationView.init();
    await ScheduleView.refresh();
    ScheduleView.start();
    status.textContent = 'connected - ' + graph.nodes.length + ' nodes';
    status.className = 'status ok';
  } catch (e) {
    status.textContent = e.message;
    status.className = 'status err';
  }
});

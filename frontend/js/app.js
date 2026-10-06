// Boot sequence: graph -> canvas -> controls -> schedule polling.
document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  try {
    const graph = await Api.getGraph();
    GraphView.init(document.getElementById('cy'), graph);
    Controls.init(graph);
    await ScheduleView.refresh();
    ScheduleView.start();
    status.textContent = 'connected - ' + graph.nodes.length + ' nodes';
    status.className = 'status ok';
  } catch (e) {
    status.textContent = e.message;
    status.className = 'status err';
  }
});

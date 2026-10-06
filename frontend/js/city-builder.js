// "City builder": add random nodes of any type so the simulation can be stress-tested.
const CityBuilder = (() => {
  const $ = (id) => document.getElementById(id);
  let total = 0;
  let added = 0;

  function showCount() {
    $('builder-count').textContent = '(' + total + ' nodes' + (added ? ', ' + added + ' added' : '') + ')';
  }

  function say(text, isError) {
    const box = $('builder-msg');
    box.textContent = text;
    box.classList.toggle('error', !!isError);
  }

  // "home-haz" -> { type: 'home', hazardous: true }
  function parseType(value) {
    const hazardous = value.endsWith('-haz');
    return { type: hazardous ? value.slice(0, -4) : value, hazardous };
  }

  async function add() {
    const { type, hazardous } = parseType($('builder-type').value);
    const raw = parseInt($('builder-count-input').value, 10);
    const count = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : 1;
    $('builder-add').disabled = true;
    try {
      const res = await Api.generateNodes({ type, count, hazardous });
      GraphView.addElements(res.nodes, res.edges);
      total = res.totalNodes;
      added += res.nodes.length;
      showCount();
      const where = Array.from(new Set(res.nodes.map((n) => n.area))).join(', ');
      say('Added ' + res.nodes.length + ' (' + res.nodes.map((n) => n.id).slice(0, 6).join(', ') +
          (res.nodes.length > 6 ? ', …' : '') + ') in ' + where + '.');
      await ScheduleView.refresh();
      await DatabaseView.refreshIfVisible();
    } catch (e) {
      say(e.message, true);
    } finally {
      $('builder-add').disabled = false;
    }
  }

  // Called after a simulation reset, which discards every generated node.
  function reset(graph) {
    total = graph.nodes.length;
    added = 0;
    showCount();
    say('Reset: back to the original city.');
  }

  function init(graph) {
    total = graph.nodes.length;
    added = 0;
    showCount();
    $('builder-add').addEventListener('click', add);
  }

  return { init, reset };
})();

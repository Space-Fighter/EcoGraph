// Sidebar: home selection, mode toggle, waste classification and hazard dispatch.
const Controls = (() => {
  let graph = null;
  let dueIds = [];
  let lastRouteHomes = [];

  const $ = (id) => document.getElementById(id);

  function selectedHomes() {
    return Array.from(document.querySelectorAll('#home-list input:checked')).map((i) => i.value);
  }

  function mode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  function showResult(lines, total, warnings) {
    const box = $('result');
    box.replaceChildren();
    lines.forEach((l) => {
      const div = document.createElement('div');
      div.className = 'seg';
      div.textContent = l;
      box.appendChild(div);
    });
    if (total !== undefined) {
      const t = document.createElement('div');
      t.className = 'total';
      t.textContent = 'Total cost: ' + total.toFixed(1);
      box.appendChild(t);
    }
    (warnings || []).forEach((w) => {
      const div = document.createElement('div');
      div.className = 'warn';
      div.textContent = w;
      box.appendChild(div);
    });
  }

  function showError(e) {
    showResult([], undefined, [e.message]);
  }

  function segLines(segments) {
    return segments.map((s) => s.label + '  [' + s.path.join(' > ') + ']  cost ' + s.cost.toFixed(1));
  }

  function buildHomeList() {
    const list = $('home-list');
    list.replaceChildren();
    const select = $('hazard-location');
    select.replaceChildren();
    graph.nodes.filter((n) => n.type === 'home').forEach((n) => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = n.id;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(n.id));
      if (n.hazardous) {
        const t = document.createElement('span');
        t.className = 'tag haz';
        t.textContent = 'hazard';
        label.appendChild(t);
      }
      const due = document.createElement('span');
      due.className = 'tag due';
      due.dataset.due = n.id;
      due.hidden = true;
      due.textContent = 'due';
      label.appendChild(due);
      label.title = n.wasteDescription || '';
      list.appendChild(label);

      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.id + (n.hazardous ? ' (hazardous)' : '') + ' - ' + (n.wasteDescription || '');
      select.appendChild(opt);
    });
  }

  function updateDue(schedule) {
    dueIds = schedule.due.filter((d) => d.type === 'home').map((d) => d.id);
    document.querySelectorAll('[data-due]').forEach((el) => { el.hidden = !dueIds.includes(el.dataset.due); });
  }

  async function computeRoute() {
    const homes = selectedHomes();
    if (!homes.length) { showResult([], undefined, ['Select at least one home.']); return; }
    try {
      const r = await Api.postRoute(homes, mode());
      const warnings = [];
      if (r.skippedHazardous.length) {
        warnings.push('Hazardous homes removed from this run: ' + r.skippedHazardous.join(', ') + '. Use "Dispatch hazard truck".');
      }
      if (r.unreachable.length) warnings.push('Unreachable: ' + r.unreachable.join(', '));
      showResult(segLines(r.segments), r.totalCost, warnings);
      lastRouteHomes = homes.filter((h) => !r.skippedHazardous.includes(h));
      $('btn-collect').disabled = lastRouteHomes.length === 0;
      await GraphView.animateRoute(r.segments, 'normal');
    } catch (e) { showError(e); }
  }

  async function markCollected() {
    try {
      await Api.postCollect(lastRouteHomes);
      $('btn-collect').disabled = true;
      await ScheduleView.refresh();
      await DatabaseView.refreshIfVisible();
      showResult(['Marked collected: ' + lastRouteHomes.join(', ')]);
    } catch (e) { showError(e); }
  }

  async function classify() {
    const text = $('waste-input').value.trim();
    const out = $('classify-result');
    out.className = 'note';
    if (!text) { out.textContent = 'Type a waste description first.'; return; }
    try {
      const c = await Api.postClassify(text);
      out.textContent = c.hazardous
        ? 'HAZARDOUS (' + c.binType + ') - needs immediate zone-restricted pickup.'
        : 'Non-hazardous: ' + c.binType + ' bin.';
      if (c.hazardous) out.className = 'note haz';
    } catch (e) { out.textContent = e.message; }
  }

  async function dispatchHazard() {
    const id = $('hazard-location').value;
    if (!id) return;
    try {
      const h = await Api.postRouteHazard(id);
      showResult(segLines(h.segments), h.totalCost,
        ['Avoided zones: ' + h.forbiddenZones.join(', ') + ' - delivered to ' + h.binId]);
      await GraphView.animateRoute(h.segments, 'hazard');
    } catch (e) { showError(e); }
  }

  function init(g) {
    graph = g;
    buildHomeList();
    ScheduleView.onUpdate(updateDue);
    $('btn-route').addEventListener('click', computeRoute);
    $('btn-collect').addEventListener('click', markCollected);
    $('btn-classify').addEventListener('click', classify);
    $('waste-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') classify(); });
    $('btn-hazard').addEventListener('click', dispatchHazard);
    $('btn-due').addEventListener('click', () => {
      document.querySelectorAll('#home-list input').forEach((cb) => { cb.checked = dueIds.includes(cb.value); });
    });
  }

  return { init };
})();

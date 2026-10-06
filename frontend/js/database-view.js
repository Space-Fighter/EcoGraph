// "Database" tab: node table (sortable / filterable), locality and zone summaries, collection log.
const DatabaseView = (() => {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let sort = { key: 'id', dir: 1 };
  let active = false;

  const NODE_COLS = [
    ['id', 'ID'], ['name', 'Name'], ['area', 'Locality'], ['type', 'Type'], ['zone', 'Zone'],
    ['lat', 'Lat'], ['lng', 'Lng'], ['binType', 'Bin type'], ['waste', 'Waste'],
    ['fillRate', 'Fill rate (kg/day)'], ['capacity', 'Capacity (kg)'], ['fillLevel', 'Fill level (kg)'],
    ['percentFull', '% full'], ['lastCollected', 'Last collected'], ['daysSinceCollected', 'Days since'],
    ['intervalDays', 'Interval (d)'], ['nextDue', 'Next due'], ['overdueByDays', 'Overdue (d)'],
    ['status', 'Status'], ['connections', 'Connected to'],
  ];

  function cell(text, cls) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  const num = (v, d) => (typeof v === 'number' ? v.toFixed(d === undefined ? 1 : d) : '');

  function pill(status) {
    const span = document.createElement('span');
    span.className = 'pill ' + (status === 'n/a' ? 'na' : status);
    span.textContent = status;
    return span;
  }

  function header(table, cols, sortable) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    cols.forEach(([key, label]) => {
      const th = document.createElement('th');
      th.textContent = label;
      if (sortable) {
        if (sort.key === key) { th.className = 'sorted'; th.dataset.dir = sort.dir > 0 ? '▲' : '▼'; }
        th.addEventListener('click', () => {
          sort = { key, dir: sort.key === key ? -sort.dir : 1 };
          renderNodes();
        });
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  function filteredNodes() {
    const q = $('db-search').value.trim().toLowerCase();
    const type = $('db-type').value, zone = $('db-zone').value, status = $('db-status').value;
    const rows = data.nodes.filter((n) => {
      if (type && n.type !== type) return false;
      if (zone && n.zone !== zone) return false;
      if (status && n.status !== status) return false;
      const haystack = [n.id, n.name, n.area, n.waste, n.zone, n.binType].join(' ').toLowerCase();
      if (q && !haystack.includes(q)) return false;
      return true;
    });
    const k = sort.key;
    rows.sort((a, b) => {
      const av = Array.isArray(a[k]) ? a[k].length : a[k];
      const bv = Array.isArray(b[k]) ? b[k].length : b[k];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;   // rows without the field always sink
      if (bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sort.dir;
    });
    return rows;
  }

  function renderNodes() {
    const table = $('db-nodes');
    table.replaceChildren();
    header(table, NODE_COLS, true);
    const tbody = document.createElement('tbody');
    filteredNodes().forEach((n) => {
      const tr = document.createElement('tr');
      const collectable = n.type === 'home' || n.type === 'bin';
      tr.appendChild(cell(n.id));
      tr.appendChild(cell(n.name || ''));
      tr.appendChild(cell(n.area || ''));
      tr.appendChild(cell(n.type));
      tr.appendChild(cell(n.zone));
      tr.appendChild(cell(num(n.lat, 4), 'num'));
      tr.appendChild(cell(num(n.lng, 4), 'num'));
      tr.appendChild(cell(n.binType || ''));
      const waste = cell((n.waste || '') + (n.hazardous ? '  [HAZARDOUS]' : ''));
      tr.appendChild(waste);
      tr.appendChild(cell(num(n.fillRate), 'num'));
      tr.appendChild(cell(num(n.capacity, 0), 'num'));
      tr.appendChild(cell(num(n.fillLevel), 'num'));

      const pctCell = document.createElement('td');
      if (collectable) {
        const bar = document.createElement('span');
        bar.className = 'bar';
        const fill = document.createElement('i');
        fill.className = n.status;
        fill.style.width = Math.min(100, n.percentFull) + '%';
        bar.appendChild(fill);
        pctCell.append(bar, document.createTextNode(' ' + num(n.percentFull, 0) + '%'));
      }
      tr.appendChild(pctCell);

      tr.appendChild(cell(n.lastCollected || ''));
      tr.appendChild(cell(num(n.daysSinceCollected), 'num'));
      tr.appendChild(cell(num(n.intervalDays), 'num'));
      tr.appendChild(cell(n.nextDue || ''));
      tr.appendChild(cell(collectable ? num(n.overdueByDays) : '', 'num'));
      const st = document.createElement('td');
      st.appendChild(pill(n.status));
      tr.appendChild(st);
      tr.appendChild(cell(n.connections.join(', ')));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // Summary table for a grouping of nodes: zones (key "zone") or localities (key "area").
  function renderGroups(tableId, rows, key, label) {
    const table = $(tableId);
    table.replaceChildren();
    header(table, [[key, label], ['nodes', 'Nodes'], ['collectable', 'Homes + bins'], ['due', 'Due'],
                   ['overflow', 'Overflowing'], ['avgPercentFull', 'Avg % full'], ['totalFillRate', 'Total fill rate (kg/day)']], false);
    const tbody = document.createElement('tbody');
    rows.forEach((z) => {
      const tr = document.createElement('tr');
      tr.appendChild(cell(z[key]));
      tr.appendChild(cell(z.nodes, 'num'));
      tr.appendChild(cell(z.collectable, 'num'));
      tr.appendChild(cell(z.due, 'num'));
      tr.appendChild(cell(z.overflow, 'num'));
      tr.appendChild(cell(num(z.avgPercentFull, 0) + '%', 'num'));
      tr.appendChild(cell(num(z.totalFillRate), 'num'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function renderLog() {
    const table = $('db-log');
    table.replaceChildren();
    header(table, [['day', 'Day'], ['date', 'Date'], ['id', 'Location'], ['type', 'Type'], ['action', 'Action'],
                   ['truck', 'Truck'], ['overdueByDays', 'Overdue (d)'], ['percentFull', '% full when collected']], false);
    const tbody = document.createElement('tbody');
    if (!data.log.length) {
      const tr = document.createElement('tr');
      const td = cell('No collections yet. Run the simulation with auto-collect switched on.');
      td.colSpan = 8;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    data.log.forEach((e) => {
      const tr = document.createElement('tr');
      tr.appendChild(cell(e.day, 'num'));
      tr.appendChild(cell(e.date));
      tr.appendChild(cell(e.id));
      tr.appendChild(cell(e.type));
      tr.appendChild(cell(e.action));
      tr.appendChild(cell(e.truck || '-'));
      tr.appendChild(cell(num(e.overdueByDays), 'num'));
      tr.appendChild(cell(num(e.percentFull, 0) + '%', 'num'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  async function refresh() {
    data = await Api.getDatabase();
    $('db-asof').textContent = 'As of day ' + data.simulation.day + ' (' + data.simulation.date + ')';
    renderNodes();
    renderGroups('db-localities', data.localities, 'area', 'Locality');
    renderGroups('db-zones', data.zones, 'zone', 'Zone');
    renderLog();
  }

  function showTab(name) {
    active = name === 'db';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('cy').hidden = active;
    $('map').hidden = active;
    $('fit-all').hidden = active;
    document.querySelector('.legend').hidden = active;
    $('db-panel').hidden = !active;
    if (active) refresh().catch((e) => { $('db-asof').textContent = e.message; });
    else GraphView.resize();
  }

  function init() {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    ['db-search', 'db-type', 'db-zone', 'db-status'].forEach((id) => {
      $(id).addEventListener('input', () => { if (data) renderNodes(); });
    });
  }

  // Called by other modules after the data changed (simulation step, collection...).
  function refreshIfVisible() { return active ? refresh() : Promise.resolve(); }

  return { init, refresh, refreshIfVisible };
})();

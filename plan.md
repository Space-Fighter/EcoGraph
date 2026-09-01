# EcoGraph — Detailed Technical Plan

**Team ID:** DSCPP-III-2026-T186
**Project:** ECO GRAPH – Graph Based Algorithmic Waste Management
**Team:** Tejas Jain (2028228, SEC-A) · Yash Nigam (2028289, SEC-H) · Apoorv Negi (2027640, SEC-D)
**Mentor:** Navneet Rajput
**Source:** [PBL PROPOSAL.md](PBL PROPOSAL.md)

This is the full technical design: architecture, data structures, algorithms, API contracts, JSON schemas, and file-by-file breakdown — not just a task list. Section 12 keeps the phased task/owner breakdown for planning and reporting purposes.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Frontend)                       │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────┐ │
│  │ Cytoscape.js  │  │ Control Panel │  │ Waste Input / Toggle │ │
│  │ graph canvas  │  │ (mode toggle, │  │ (classify + hazard   │ │
│  │ + animation   │  │  home select) │  │  trigger)             │ │
│  └───────┬───────┘  └───────┬───────┘  └──────────┬───────────┘ │
│          └──────────────────┴─────────────────────┘             │
│                       fetch() JSON over HTTP                     │
└──────────────────────────────┬────────────────────────────────--┘
                                │  same-origin, served by C++ server
┌───────────────────────────── ▼ ───────────────────────────────---┐
│                    C++ Backend (single process)                  │
│                                                                   │
│  ┌─────────────┐   ┌──────────────────┐   ┌───────────────────┐ │
│  │ HTTP Layer  │──▶│  Route Handlers   │──▶│   Domain Layer    │ │
│  │(cpp-httplib)│   │ (controllers/*.cc)│   │ Graph, Router,     │ │
│  │             │◀──│  JSON in/out      │◀──│ Classifier,        │ │
│  └─────────────┘   └──────────────────┘   │ Scheduler          │ │
│                                             └─────────┬─────────┘ │
│                                                        │           │
│                                             ┌──────────▼─────────┐│
│                                             │  In-memory state:  ││
│                                             │  Graph (adjacency  ││
│                                             │  list), waste rules││
│                                             │  table, schedule   ││
│                                             │  state (fill-rate, ││
│                                             │  last-collected)   ││
│                                             └──────────┬─────────┘│
│                                                        │           │
│                                             ┌──────────▼─────────┐│
│                                             │ JSON config files  ││
│                                             │ city.json,         ││
│                                             │ waste_rules.json   ││
│                                             │ (loaded at startup)││
│                                             └────────────────────┘│
└────────────────────────────────────────────────────────────────--┘
```

**Key architectural decisions:**
- **Single persistent process** owns the graph and all state in memory (no per-request re-parsing, no DB round trip in the base version) — matches the proposal's "persistent HTTP server" requirement and keeps Dijkstra calls fast.
- **Layered backend:** HTTP layer (routing/parsing only) → Controllers (validate request, call domain layer, shape response) → Domain layer (pure C++ classes with no HTTP/JSON knowledge, independently unit-testable) → in-memory state.
- **Same-origin serving:** the C++ server serves both the static frontend and the JSON API, avoiding CORS entirely.
- **Stateless requests, stateful server:** each HTTP request is stateless, but the server process itself holds graph + schedule state across requests (mutated by `/route` completions and schedule updates).

---

## 2. Repository / File Layout

```
/server
  /include
    node.hpp              // Node, Edge, ZoneType definitions
    graph.hpp             // Graph class declaration
    dijkstra.hpp           // shortestPath(), constrainedShortestPath()
    waste_classifier.hpp   // classifyWaste()
    scheduler.hpp          // Scheduler class
    router.hpp             // RouteBuilder (priority/FIFO modes)
    json_convert.hpp       // to_json/from_json helpers (nlohmann adl_serializer)
  /src
    graph.cpp
    dijkstra.cpp
    waste_classifier.cpp
    scheduler.cpp
    router.cpp
    controllers.cpp        // HTTP handlers, one function per endpoint
    main.cpp                // server bootstrap, loads config, registers routes
  /third_party
    httplib.h               // vendored cpp-httplib
    json.hpp                 // vendored nlohmann/json
  /data
    city.json                 // graph configuration (nodes, edges, zones, fill-rates)
    waste_rules.json          // keyword -> bin type / hazard mapping
  /tests
    test_dijkstra.cpp
    test_constrained_dijkstra.cpp
    test_classifier.cpp
    test_scheduler.cpp
    test_router.cpp
  CMakeLists.txt

/frontend
  index.html
  /css
    style.css
  /js
    api.js                  // fetch wrappers for all 5 endpoints
    graph-view.js            // Cytoscape.js setup, styling, animation
    controls.js               // mode toggle, home selection, waste input
    schedule-view.js           // due-location polling + flagging
    app.js                      // wires everything together on load

/docs
  architecture-diagram.png
  demo-screenshots/

plan.md
PBL PROPOSAL.md
PBL TEAM INFO.md
instructions.md
```

---

## 3. Core Domain Model

### 3.1 `ZoneType` enum
```cpp
enum class ZoneType { Residential, Commercial, Industrial, Arterial };
```
`Arterial` = road-only junction nodes with no dwelling, always passable by hazardous routes.

### 3.2 `NodeType` enum
```cpp
enum class NodeType { Depot, Home, Junction, Bin };
```

### 3.3 `Node` struct
```cpp
struct Node {
    std::string id;              // unique, e.g. "H3", "B1", "J7", "DEPOT"
    NodeType type;
    ZoneType zone;
    double x, y;                 // coordinates for frontend layout (optional, else auto-layout)

    // Home/Bin-only fields (ignored for Depot/Junction):
    double fillRate = 0.0;        // units/day, e.g. 4.5
    double capacity = 100.0;      // fill units at which location is "full"
    std::time_t lastCollected = 0; // epoch seconds
    std::string binType = "";      // for Bin nodes: "recyclable" | "compost" | "general" | "medical" | "chemical"
};
```

### 3.4 `Edge` struct (stored inside adjacency list, not globally indexed)
```cpp
struct Edge {
    std::string to;
    double weight;        // travel cost (time or distance)
    ZoneType zone;         // zone tag of the edge/road segment itself
};
```

### 3.5 `Graph` class
```cpp
class Graph {
public:
    void loadFromJson(const std::string& path);
    void addNode(const Node& n);
    void addEdge(const std::string& from, const std::string& to, double weight, ZoneType zone, bool bidirectional = true);

    const Node& getNode(const std::string& id) const;
    Node& getNodeMutable(const std::string& id);              // for updating fillRate/lastCollected
    const std::vector<Edge>& neighbors(const std::string& id) const;
    std::vector<std::string> nodeIdsByType(NodeType type) const;

    nlohmann::json toJson() const;                              // for GET /graph

private:
    std::unordered_map<std::string, Node> nodes_;
    std::unordered_map<std::string, std::vector<Edge>> adjacency_;
};
```
- Backing store: `unordered_map<string, vector<Edge>>` → O(1) average node lookup, O(degree) edge iteration — matches proposal's "Hash map (unordered_map)" concept.
- Loaded once at startup from `data/city.json`; mutated in-place only for `fillRate`/`lastCollected` updates after a collection.

---

## 4. Algorithms

### 4.1 Plain Dijkstra — `shortestPath`
```cpp
struct PathResult {
    std::vector<std::string> path;   // ordered node IDs, source..destination
    double cost;                       // total weight, or -1 if unreachable
};

PathResult shortestPath(const Graph& g, const std::string& source, const std::string& dest);
```
**Algorithm:**
1. `dist[source] = 0`, all others `infinity`; `prev` map empty.
2. Min-heap `priority_queue<pair<double,string>, vector<...>, greater<...>>` seeded with `(0, source)`.
3. Standard relaxation loop: pop min, skip if stale (`dist` improved since push), for each neighbor `v` via edge `(u,v,w)`: if `dist[u]+w < dist[v]`, update `dist[v]`, `prev[v]=u`, push `(dist[v], v)`.
4. Stop early when `dest` is popped (optimization).
5. Reconstruct path by walking `prev` backward from `dest` to `source` into a `vector<string>`, then `reverse()`.

**Complexity:** O((V+E) log V) with binary heap. Matches proposal concept "Dijkstra's algorithm + min-heap priority queue" and "Path reconstruction (vector/stack)".

**Validation plan:** hand-computed shortest paths on a fixed 10-node test graph (in `tests/test_dijkstra.cpp`), checked with exact expected cost and path sequence.

### 4.2 Constrained Dijkstra — `constrainedShortestPath`
```cpp
PathResult constrainedShortestPath(
    const Graph& g, const std::string& source, const std::string& dest,
    const std::unordered_set<ZoneType>& forbiddenZones);
```
Identical to 4.1 except: during relaxation, **skip any edge whose `zone` is in `forbiddenZones`**, and skip any neighbor node whose `zone` is in `forbiddenZones` unless it is the destination itself (hazardous waste must still be able to reach a bin that happens to sit in an otherwise-forbidden zone edge boundary — but per proposal, hazardous bins are industrial-zoned so this edge case is mostly moot; documented as a known simplification).

Called with `forbiddenZones = {Residential, Commercial}` for all hazardous dispatches. If no path exists under the constraint, `cost = -1` and the API returns HTTP 422 with a descriptive error (see §6.5).

### 4.3 Waste Classification — `classifyWaste`
```cpp
struct ClassificationResult {
    std::string binType;   // "recyclable" | "compost" | "general" | "medical" | "chemical"
    bool hazardous;
};
ClassificationResult classifyWaste(const std::string& description);
```
**Design:** rule table loaded from `data/waste_rules.json`:
```json
{
  "medical":     { "keywords": ["syringe", "bandage", "needle", "blood", "gauze"], "hazardous": true },
  "chemical":    { "keywords": ["solvent", "acid", "battery", "paint", "pesticide"], "hazardous": true },
  "recyclable":  { "keywords": ["plastic", "bottle", "can", "glass", "paper", "cardboard"], "hazardous": false },
  "compost":     { "keywords": ["food", "organic", "vegetable", "fruit", "leaves"], "hazardous": false },
  "general":     { "keywords": [], "hazardous": false }
}
```
**Matching order:** lowercase + tokenize the description, check `medical` and `chemical` keyword sets **first** (hazard takes priority even if a description also contains a recyclable keyword, e.g. "plastic syringe" → medical/hazardous), then recyclable, then compost; fallback to `general` if nothing matches. Implemented as a simple linear scan over category→keyword lists (small, fixed-size data — no need for a trie/Aho-Corasick at this scale, documented as a conscious simplicity choice).

### 4.4 Scheduler — interval + due-check
```cpp
class Scheduler {
public:
    double computeInterval(const Node& n) const;      // days
    bool isDue(const Node& n, std::time_t now) const;
    std::vector<std::string> getDueLocations(const Graph& g, std::time_t now) const;
    void markCollected(Graph& g, const std::string& nodeId, std::time_t now);
};
```
**Interval formula:** `interval_days = capacity / fillRate`, clamped to `[1, 14]` days (e.g. fillRate 20/day, capacity 100 → 5-day interval; fillRate 2/day → 14-day cap so nothing is starved of visits entirely).

**Due check:** `now >= lastCollected + interval_days * 86400`.

**`getDueLocations`:** iterates all Home/Bin nodes, and for scheduling priority, pushes due locations into a **max-heap keyed by overdue-ness** = `(now - (lastCollected + interval*86400))`, so the most-overdue locations sort first — matches proposal's "Priority queue (min-heap/max-heap, by urgency)" concept. Hazardous pickups (flagged via `/classify`) always outrank scheduled items and are dispatched through `/route/hazard` immediately rather than entering this heap.

**`markCollected`:** called by the route-completion flow (or manually via a debug endpoint) to reset `lastCollected = now` on the visited node.

### 4.5 Route Builder — Priority vs FIFO modes
```cpp
struct RouteSegment { std::vector<std::string> path; double cost; std::string label; };
struct RouteResult { std::vector<RouteSegment> segments; double totalCost; };

RouteResult buildPriorityRoute(const Graph& g, const std::vector<std::string>& homeIds);
RouteResult buildFifoRoute(const Graph& g, const std::vector<std::string>& homeIds);
```
- **Priority mode:** `current = depot`; for each home in the given order: segment = `shortestPath(current, home)`; append; find nearest matching bin for that home's typical waste (nearest bin by a second Dijkstra call from home to each candidate bin, take min) → segment `home → bin`; append; `current = bin`. Repeat.
- **FIFO mode:** segment chain `depot → home1 → home2 → ... → homeN` (each leg its own Dijkstra call so intermediate weights are accurate even if homes aren't adjacent), then `homeN → bin1 → bin2 → ... → binM` sequentially disposing everything collected.
- Both use a `std::queue<string>` to hold pending homes in FIFO mode (explicit proposal concept: "Queue (FIFO)").
- Hazardous homes are filtered out **before** either builder runs (checked via a pre-pass calling `classifyWaste` on each home's declared waste description) and routed separately via `constrainedShortestPath`.

---

## 5. JSON Config Schemas

### 5.1 `data/city.json`
```json
{
  "nodes": [
    { "id": "DEPOT", "type": "depot", "zone": "industrial", "x": 0, "y": 0 },
    { "id": "J1", "type": "junction", "zone": "arterial", "x": 10, "y": 5 },
    { "id": "H1", "type": "home", "zone": "residential", "x": 20, "y": 10,
      "fillRate": 5.0, "capacity": 50, "lastCollected": 1767000000 },
    { "id": "B1", "type": "bin", "zone": "industrial", "x": 5, "y": -5,
      "binType": "general", "fillRate": 15.0, "capacity": 300, "lastCollected": 1767000000 }
  ],
  "edges": [
    { "from": "DEPOT", "to": "J1", "weight": 4.2, "zone": "arterial" },
    { "from": "J1", "to": "H1", "weight": 3.1, "zone": "residential" },
    { "from": "H1", "to": "B1", "weight": 6.0, "zone": "industrial" }
  ]
}
```
Edges default to bidirectional unless a `"directed": true` field is present (kept simple: all sample-data edges bidirectional).

### 5.2 `data/waste_rules.json` — shown in §4.3.

---

## 6. REST API Contract

All bodies are `application/json`. All responses include `"ok": true/false`.

### 6.1 `GET /graph`
**Response 200:**
```json
{ "ok": true, "nodes": [ /* Node objects incl. zone, fillRate, lastCollected */ ],
  "edges": [ { "from": "...", "to": "...", "weight": 3.1, "zone": "residential" } ] }
```

### 6.2 `POST /route`
**Request:**
```json
{ "homeIds": ["H1", "H4", "H2"], "mode": "priority" }
```
`mode` ∈ `"priority" | "fifo"`.
**Response 200:**
```json
{ "ok": true, "mode": "priority", "totalCost": 34.7,
  "segments": [
    { "label": "depot->H1", "path": ["DEPOT","J1","H1"], "cost": 7.3 },
    { "label": "H1->B1",    "path": ["H1","B1"],          "cost": 6.0 }
  ] }
```
**Errors:** 400 if `homeIds` empty or unknown id; 400 if `mode` invalid.

### 6.3 `POST /classify`
**Request:** `{ "description": "used plastic syringe" }`
**Response 200:** `{ "ok": true, "binType": "medical", "hazardous": true }`

### 6.4 `POST /route/hazard`
**Request:** `{ "locationId": "H1" }`
**Response 200:**
```json
{ "ok": true, "path": ["H1","J1","DEPOT_HAZARD_BIN"], "cost": 9.4,
  "forbiddenZones": ["residential", "commercial"] }
```
**Error 422** (no valid constrained path exists): `{ "ok": false, "error": "no_hazard_route", "message": "No path avoiding residential/commercial zones exists from H1" }`

### 6.5 `GET /schedule`
**Response 200:**
```json
{ "ok": true, "date": "2026-09-01",
  "due": [
    { "id": "H1", "type": "home", "overdueByDays": 1.4 },
    { "id": "B1", "type": "bin",  "overdueByDays": 0.2 }
  ] }
```
Sorted descending by `overdueByDays` (max-heap order, per §4.4).

### 6.6 Error format (uniform across endpoints)
```json
{ "ok": false, "error": "<machine_code>", "message": "<human readable>" }
```
HTTP status: 400 (bad request/validation), 404 (unknown node id), 422 (unsatisfiable constraint), 500 (unexpected).

---

## 7. HTTP Layer Details

- **Framework:** cpp-httplib `Server`; routes registered in `main.cpp`:
  ```cpp
  svr.Get("/graph", handleGetGraph);
  svr.Post("/route", handlePostRoute);
  svr.Post("/classify", handlePostClassify);
  svr.Post("/route/hazard", handlePostRouteHazard);
  svr.Get("/schedule", handleGetSchedule);
  svr.set_mount_point("/", "./frontend");   // static file serving
  ```
- Each handler: parse `req.body` with `nlohmann::json::parse` (wrapped in try/catch → 400 on malformed JSON), validate fields, call domain layer, serialize response, set `res.set_content(j.dump(), "application/json")`.
- Global state (the `Graph` instance, `Scheduler`) held in `main.cpp` and passed to controllers by reference/pointer captured in lambdas — no global mutable singletons.
- CORS not needed (same-origin), but a permissive header is added for local dev convenience (`Access-Control-Allow-Origin: *`) if frontend is ever iterated on via a separate dev server (e.g. Vite/live-server) during development.

---

## 8. Frontend Architecture

- **`api.js`:** thin `fetch` wrappers, one function per endpoint (`getGraph()`, `postRoute(homeIds, mode)`, `postClassify(desc)`, `postRouteHazard(id)`, `getSchedule()`), all returning parsed JSON promises with error surfacing.
- **`graph-view.js`:**
  - Initializes Cytoscape.js with elements built from `GET /graph` response.
  - Style rules keyed on `data(type)`/`data(zone)`: Depot = square icon, Home = circle, Bin = triangle, Junction = small dot; zone tints via background color (residential = green-tinted, commercial = blue-tinted, industrial = grey, arterial = neutral).
  - `animateRoute(segments)`: walks each segment's path array, sequentially adds a `highlighted` class to each edge with a `setTimeout`/`cy.animate` chain (~400ms per hop) and pulses the traversed node (`cy.animate({style: {'border-width': 6}}, {duration: 200}).animate({style:{'border-width':2}}, {duration:200})`).
  - Hazardous routes get a distinct edge class (`hazard-edge`: dashed, red) applied instead of the normal `highlighted` class.
- **`controls.js`:** home multi-select list (checkboxes generated from graph Home nodes), mode radio toggle, "Compute Route" button → calls `postRoute` → `animateRoute`. Separate waste-description text input + "Classify" button → calls `postClassify`; if `hazardous === true`, auto-prompts "Dispatch immediately?" → calls `postRouteHazard` and animates with hazard styling.
- **`schedule-view.js`:** on load and every N seconds (configurable poll, default 30s — acceptable given this is a demo, not a proposal requirement for websockets), calls `getSchedule()` and applies a `due` CSS class (pulsing amber outline) to matching nodes in the Cytoscape instance; a sidebar list mirrors the due IDs with `overdueByDays`.
- **`app.js`:** on `DOMContentLoaded`, sequentially: `getGraph()` → build Cytoscape instance → wire `controls.js` handlers → start schedule polling.

No frontend framework (React/Vue) — vanilla JS is sufficient for this scope and keeps the "single C++ server, no build step" property intact (frontend files served as-is, no bundler needed).

---

## 9. Testing Strategy

| Layer | Tool | Coverage |
|---|---|---|
| Domain (C++) | Lightweight custom asserts or Catch2 (single header, easy vendor) | Dijkstra correctness (fixed graph, known paths), constrained Dijkstra (verify forbidden zones never appear in output path), classifier (keyword edge cases incl. hazard-priority-over-recyclable), scheduler (interval formula, due boundary conditions), router (priority vs FIFO segment ordering) |
| API | Manual curl/Postman collection, checked into `/docs` as `api-tests.http` | All 5 endpoints, happy path + each documented error case |
| Frontend | Manual E2E per Phase 4 exit criteria | Route animation, hazard flow, schedule flagging |

Example Dijkstra test graph (used across `test_dijkstra.cpp` and `test_constrained_dijkstra.cpp`): a fixed 10-node city with one deliberately "trap" edge (short but residential-zoned) to prove the constrained variant correctly avoids it while plain Dijkstra takes it.

---

## 10. Concurrency & Persistence (Stretch — Phase 5)

- **Thread pool:** cpp-httplib already dispatches each connection on a worker thread by default; the risk is concurrent mutation of `Graph`'s `fillRate`/`lastCollected` fields. Add a single `std::shared_mutex` guarding the `Graph` instance: read-locked for `/graph`, `/route`, `/schedule`; write-locked only for the (future) collection-completion mutation path. Keeps the base implementation simple while making the extension well-defined.
- **Persistence:** on graceful shutdown (SIGINT handler) or after every N mutations, serialize `Graph::toJson()` plus scheduler state back to `data/city.json` (or a separate `data/state.json` to keep the original config immutable). SQLite considered but deferred — file-based JSON persistence is sufficient for the demo scale and avoids adding a DB dependency under deadline pressure.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Constrained Dijkstra finds no path (over-aggressive forbidden zones in sample data) | Design `city.json` with a guaranteed industrial/arterial corridor from every home to at least one hazard-capable bin; add the 422 error path as a first-class case, not an afterthought |
| Cytoscape.js animation timing drifts from actual segment count for long routes | Cap demo routes to a reasonable number of homes (≤6) for the live demo; animation duration scales with segment count but capped at a max total (e.g. 6s) |
| Team merge conflicts across 3 people editing `graph.hpp`/`main.cpp` concurrently | Domain classes (`Dijkstra`, `Classifier`, `Scheduler`, `Router`) are separate files per owner (§12 ownership) so parallel work stays isolated; `main.cpp`/`controllers.cpp` touched last, by Tejas, to wire everything |
| LaTeX/Overleaf report falling out of sync with actual implementation progress | Update `/docs/demo-screenshots` and the "Initial progress" report section at the end of each phase, not just before submission |

---

## 12. Phased Task Breakdown & Ownership

### Phase 1 — Foundations (Week 1)
| # | Task | File(s) | Owner |
|---|---|---|---|
| 1.1 | Repo skeleton, CMake, vendor cpp-httplib + nlohmann/json | `CMakeLists.txt`, `third_party/` | Tejas |
| 1.2 | `Node`/`Edge`/`Graph` (§3) | `include/node.hpp`, `include/graph.hpp`, `src/graph.cpp` | Tejas |
| 1.3 | Author `city.json` (§5.1) + loader | `data/city.json`, `Graph::loadFromJson` | Yash |
| 1.4 | `shortestPath` (§4.1) | `include/dijkstra.hpp`, `src/dijkstra.cpp` | Apoorv |
| 1.5 | Dijkstra unit tests | `tests/test_dijkstra.cpp` | Apoorv |

**Exit criteria:** test binary prints correct shortest paths/costs for known node pairs.

### Phase 2 — Core Routing Logic (Week 2)
| # | Task | File(s) | Owner |
|---|---|---|---|
| 2.1 | `constrainedShortestPath` (§4.2) | `dijkstra.hpp/.cpp` | Apoorv |
| 2.2 | `classifyWaste` + `waste_rules.json` (§4.3) | `include/waste_classifier.hpp`, `src/waste_classifier.cpp`, `data/waste_rules.json` | Yash |
| 2.3 | `buildPriorityRoute` (§4.5) | `include/router.hpp`, `src/router.cpp` | Tejas |
| 2.4 | `buildFifoRoute` (§4.5) | `router.hpp/.cpp` | Tejas |
| 2.5 | Hazard pre-pass filtering into constrained dispatch | `router.cpp` | Apoorv |
| 2.6 | `Scheduler` class (§4.4) | `include/scheduler.hpp`, `src/scheduler.cpp` | Yash |

**Exit criteria:** hardcoded-input test program produces correct routes for both modes; constrained routes never touch forbidden zones; `getDueLocations` correct against a mocked clock.

### Phase 3 — HTTP API (Week 3)
| # | Task | Endpoint | Owner |
|---|---|---|---|
| 3.1 | Server bootstrap, JSON helpers | — | Tejas |
| 3.2 | `GET /graph` | §6.1 | Tejas |
| 3.3 | `POST /route` | §6.2 | Tejas |
| 3.4 | `POST /classify` | §6.3 | Yash |
| 3.5 | `POST /route/hazard` | §6.4 | Apoorv |
| 3.6 | `GET /schedule` | §6.5 | Yash |
| 3.7 | Static frontend mount | §7 | Tejas |

**Exit criteria:** every endpoint verified via curl/Postman against `city.json`, including all documented error cases.

### Phase 4 — Frontend Integration (Week 4)
| # | Task | File(s) | Owner |
|---|---|---|---|
| 4.1 | Cytoscape render + zone styling | `graph-view.js` | Yash |
| 4.2 | Mode toggle + route animation | `controls.js`, `graph-view.js` | Tejas |
| 4.3 | Hazard styling + classify→dispatch flow | `controls.js`, `graph-view.js` | Apoorv |
| 4.4 | Schedule polling + due-flagging | `schedule-view.js` | Yash |
| 4.5 | End-to-end manual pass | all | All |

**Exit criteria:** live demo covers normal route animation, hazardous dispatch, and schedule flagging without console errors.

### Phase 5 — Stretch (post Phase-I)
| # | Task |
|---|---|
| 5.1 | Thread-safety via `shared_mutex` (§10) |
| 5.2 | JSON-file persistence of state (§10) |

---

## 13. Deliverables Checklist (per [instructions.md](instructions.md))

- [ ] Finalize project title with mentor (currently "ECO GRAPH – Graph Based Algorithmic Waste Management")
- [ ] Working prototype through Phase 4; screenshots/GIF of the live demo for the report
- [ ] Phase-I Report in LaTeX (Overleaf), from `Sample Report and PPT/Report/Phase-1.tex`
- [ ] Phase-I PPT in LaTeX/Beamer (Overleaf), from `Sample Report and PPT/PPT/Phase-I.tex`
- [ ] Report/PPT cover: title, problem statement + objectives, proposed solution + architecture (use §1 diagram), subject integration, progress so far, individual contributions (§14), milestones/expected outcomes
- [ ] Plagiarism/academic integrity check before submission
- [ ] Submit, then monitor portal for Departmental Review Committee feedback and incorporate corrections

---

## 14. Individual Contribution Split (for report)

- **Tejas Jain:** Graph data model & build system (§3, §2), Priority/FIFO routing modes (§4.5), HTTP server bootstrap + `/route` + `/graph` (§7, §6.1-6.2), frontend route animation (§8)
- **Apoorv Negi:** Plain + constrained Dijkstra (§4.1-4.2), hazardous pre-pass and dispatch logic, `/route/hazard` endpoint (§6.4), hazardous-route frontend styling (§8)
- **Yash Nigam:** Sample city graph data (§5.1), waste classification engine + rule table (§4.3, §5.2), fill-rate/scheduling logic (§4.4), `/classify` + `/schedule` endpoints (§6.3, §6.5), graph rendering + schedule view (§8)

---

## 15. Timeline Summary

| Week | Phase | Milestone |
|---|---|---|
| 1 | Foundations | Graph loads from JSON, Dijkstra verified against hand-computed paths |
| 2 | Core Logic | Both routing modes, constrained hazard routing, and scheduler all correct standalone |
| 3 | HTTP API | All 5 endpoints live, tested against documented request/response contracts |
| 4 | Frontend | Full interactive demo: animated routing, hazard flow, schedule flagging |
| Post | Stretch + Report/PPT | Optional concurrency/persistence; Phase-I LaTeX docs finalized and submitted |

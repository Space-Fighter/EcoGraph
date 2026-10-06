# Project Map

## Purpose
EcoRouting Engine: shortest-path garbage routing, hazard-aware dispatch avoiding residential/commercial zones, fill-rate-based scheduling, animated web view.

## Components (implemented, in server/ and frontend/)
- include/graph.hpp, src/graph.cpp: Graph (unordered_map adjacency list), Node, Edge, zone/type enums
- include/dijkstra.hpp, src/dijkstra.cpp: shortestPath, constrainedShortestPath (forbidden zones skip edges)
- include/waste_classifier.hpp, src/waste_classifier.cpp: keyword rules, hazardous first
- include/scheduler.hpp, src/scheduler.cpp: interval = capacity/fillRate clamped 1-14 days, max-heap due list
- include/router.hpp, src/router.cpp: RouteStrategy base, PriorityRouteBuilder, FIFORouteBuilder, dispatchHazard
- include/city_loader.hpp, src/city_loader.cpp: loads data/city.json (lastCollectedDaysAgo relative to now)
- include/controllers.hpp, src/controllers.cpp: handlers; src/main.cpp: bootstrap
- third_party/httplib.h (cpp-httplib 0.59.0), third_party/json.hpp (nlohmann 3.11.3)
- frontend/: index.html, config.js (ECO_API_BASE), css/style.css, js/{api,graph-view,controls,schedule-view,app}.js; Cytoscape 3.30.2 from cdnjs
- Branch fix-simulation: modes now only set ORDER (RouteStrategy::order; Priority = highest % full, tie first-due; FIFO = first due first); Fleet {normalTrucks, normalCapacity, hazardTrucks} limits sim; leftovers carry over; hazard trucks one trip/day, FIFO queue (ids N1.., HT1..). Defaults 2 x 200 normal, 1 hazard (assumed, learner can change in UI). Bins are emptied when due without trucks (assumption).
- Branch dehradun-city: data/city.json is a 51-node Dehradun-shaped city (real approx. lat/lng, fictional locality names except Clement Town = user's college), units are kg and km (edge weight = haversine x 1.25 unless explicit), 12 localities in "areas". city_loader returns City{graph, areas}; city_generator.cpp adds random home/hazard home/bin/hazard bin/junction nodes (POST /nodes/generate, cap 500 nodes, whole-day intervals so capacity = fillRate x days). Frontend: Leaflet OSM tiles + Cytoscape overlay synced on map move (?plain=1 or no Leaflet = plain canvas), City builder section, Localities table. Default fleet 3 x 1000 kg normal + 2 hazard.
- include/simulation.hpp, src/simulation.cpp: Simulation (simulated day clock, advanceDay with optional auto-collect, collection log); endpoints GET /simulation, /database, POST /simulate/advance, /simulate/reset
- frontend/js/simulation-view.js (play/step days, animates each day), database-view.js (node table, zone summary, collection log)
- tests: server/tests/test_dijkstra.cpp, test_domain.cpp, test_simulation.cpp

## Main Flow
Browser (Cytoscape) -> fetch JSON -> cpp-httplib -> controllers (mutex-guarded AppState) -> Graph/Router/Classifier/Scheduler -> in-memory state loaded from data/city.json

## API
GET /health, /graph, /schedule; POST /route, /classify, /route/hazard, /collect. Errors: {ok:false,error,message} with 400/404/422/500.

## Data and Trust Boundaries
City data from JSON at startup; state in memory only (lost on restart). No auth. CORS off unless CORS_ORIGIN env set.

## Build and Deployment
Needs GCC with C++17 + posix threads: C:\Strawberry\c\bin (GCC 13) works; C:\MinGW (GCC 6.3, win32 threads) does not. From server/: PATH=/c/Strawberry/c/bin:$PATH sh build.sh; run ./build/ecorouting.exe (config: PORT, CITY_FILE, FRONTEND_DIR, CORS_ORIGIN or args). CMakeLists.txt present, not verified. Windows build links statically. Vercel cannot host a persistent C++ process; suggested split is static frontend + API on a process host (set ECO_API_BASE and CORS_ORIGIN).

## Unknowns
Hosting target; persistence of state; whether CMake build works with the Strawberry toolchain.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EcoGraph: graph-based waste collection routing/scheduling for a city (mapped to Dehradun). A C++17 backend (single process) serves both a JSON REST API and the static frontend (Cytoscape.js, plain JS, no build step) on one port. `README.md` has the API endpoint list; `plan.md` is the detailed design doc.

## Commands

All from `server/`. Needs a g++ with C++17 + pthreads (on this Windows machine use GCC 13 at `C:/Strawberry/c/bin`; the old `C:/MinGW` g++ will not work).

```bash
export PATH="/c/Strawberry/c/bin:$PATH"   # Windows/Git Bash only
sh build.sh                                # builds build/ecorouting and all test binaries (no CMake needed)
./build/ecorouting 8080 data/city.json ../frontend   # run; open http://localhost:8080
./build/test_domain.exe                    # run a single test binary (test_dijkstra, test_domain, test_simulation, test_city_data, test_generator)
```

Tests are standalone executables (custom `CHECK` macros, no framework) that print "All ... tests passed"; there is no lint step. CMake (`CMakeLists.txt`) is an alternative to `build.sh`; adding a source file or test means updating **both** `build.sh` (`CORE` list / test lines) and `CMakeLists.txt`.

## Architecture

Layering in `server/`: `controllers.cpp` (HTTP + JSON shaping, holds `AppState` behind a mutex) → domain classes in `src/` + `include/` with no HTTP knowledge (`Graph`, `shortestPath`/`constrainedShortestPath` in `dijkstra`, `Scheduler`, `RouteStrategy`, `Simulation`, `classifyWaste`) → in-memory state loaded from `data/city.json` by `city_loader`. `city_generator` builds cities programmatically (used by the frontend city builder). `third_party/` holds header-only httplib and nlohmann json.

Key behaviours that span files:

- **Scheduling** (`scheduler.cpp`): a home/bin is due every `capacity / fillRate` days, clamped to [1, 14]. "Due", "percent full" and "overdue" all derive from `lastCollected` vs. the simulation clock (`Simulation::now()`), not wall time.
- **Routing** (`router.cpp`): `RouteStrategy::buildRoute` is the shared template: split off hazardous homes (via `classifyWaste`), call the subclass's `order()` (`PriorityRouteBuilder` = fullest first, `FIFORouteBuilder` = earliest due first), drive depot → homes via Dijkstra, then unload at the nearest non-hazardous bin per collected waste type. A later stop lying on the shortest path to an earlier one is emptied en route (reported in `collectedEnRoute`) instead of backtracking.
- **Hazardous dispatch** (`dispatchHazard`): medical/chemical locations are never in normal routes; they get a dedicated truck using `constrainedShortestPath` that forbids residential/commercial zone edges, ending at a medical/chemical bin.
- **Simulation** (`simulation.cpp`): advancing days assigns due homes to trucks by capacity (overflow goes to `carriedOver`, unreachable to `failed`), builds each truck's route with the chosen strategy, and calls `collect()` for served homes; hazard trucks run separately, one trip per truck per day.
- **Frontend** (`frontend/js/`): one module per view (`graph-view`, `schedule-view`, `simulation-view`, `database-view`, `city-builder`) over `api.js`, a thin fetch wrapper. Distances are in km, waste in kg.

## Repo notes

- `SAMPLE PPT AND REPORT/`, `PPT AND REPORT/`, `PPT and Report phase 2/` and `PBL PROPOSAL.md` are academic deliverables, not code.

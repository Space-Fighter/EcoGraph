# EcoGraph — Smart Waste Collection Routing & Scheduling System

[![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C?style=flat-square&logo=c%2B%2B)](https://isocpp.org/)
[![HTTP Framework](https://img.shields.io/badge/HTTP-cpp--httplib-brightgreen?style=flat-square)](https://github.com/yhirose/cpp-httplib)
[![JSON Engine](https://img.shields.io/badge/JSON-nlohmann%2Fjson-blue?style=flat-square)](https://github.com/nlohmann/json)
[![Frontend Canvas](https://img.shields.io/badge/Frontend-Cytoscape.js-orange?style=flat-square)](https://js.cytoscape.org/)
[![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)](LICENSE)

> **EcoGraph** is an algorithmic, graph-based waste management system built with a high-performance **C++17 backend** and an interactive **Cytoscape.js visualizer**. It replaces inefficient fixed collection routes with **dynamic shortest-path routing**, **zone-constrained hazardous material dispatching**, **fill-rate-adaptive scheduling**, and **time-step simulation**.

---

## Project Overview

Municipal waste collection routes are traditionally static: trucks follow fixed schedules regardless of actual trash fill levels or the presence of biohazardous waste. This results in excessive fuel consumption, labor inefficiency, and potential environmental hazards.

**EcoGraph** models a city’s transportation network as a weighted, zone-tagged graph (comprising depots, residential homes, road junctions, and specialized disposal bins). It computes optimal, dynamically adapted collection paths while ensuring hazardous waste avoids sensitive populated areas.

```
       [ Depot ]
          │
          ├──► ( Home 1: Organic )  ──────► [ Compost Bin ]
          │
          ├──► ( Home 2: Plastic )  ──────► [ Recyclable Bin ]
          │
          └──► ( Home 3: Biohazard ) ──(Industrial Arterial Only)──► [ Chemical Disposal Bin ]
```

---

## Key Features

- **Weighted Graph City Network Model**
  - City map represented as an adjacency list with node types (`Depot`, `Home`, `Junction`, `Bin`).
  - Edges contain physical distances/costs and are categorized into **Zone Types** (`residential`, `commercial`, `industrial`).

- **Dual-Strategy Shortest Path Routing**
  - **Priority Mode**: Route truck from depot → home → nearest matching bin → next home → bin. Disposes waste immediately after every pickup.
  - **FIFO Mode**: Route truck from depot → home1 → home2 → ... → homeN, then to disposal bins. Collects from all queued homes before visiting bins.
  - Powered by **Dijkstra's Algorithm** with min-heap priority queues.

- **Zone-Constrained Hazardous Waste Dispatch**
  - Rule-based detection of **Medical** and **Chemical** waste.
  - Triggers **immediate priority dispatch**, bypassing normal collection queues.
  - Uses **Constrained Dijkstra** which restricts travel exclusively to `industrial` or arterial roads, strictly excluding `residential` and `commercial` zones to protect public health.

- **Fill-Rate Adaptive Scheduler**
  - Tracks individual node fill rates ($\text{units/day}$) and container capacities.
  - Computes dynamic collection intervals (clamped between 1 and 14 days).
  - Maintains a max-heap priority queue of "due" and "overflowing" locations.

- **Time-Step Day Progression Simulation**
  - Built-in simulation engine with advanceable days (1 to 60 days).
  - Features **Auto-Collection** toggles, overflow indicators, and historical collection logs.

- **Interactive Cytoscape.js Frontend & Tabular Database Inspector**
  - Visual graph canvas with live truck movement animations.
  - Distinct styling and animations for hazardous vs. regular routes.
  - Dark/Light mode theme engine.
  - Real-time tabular database view with search, filtering, and zone summary metrics.

---

## System Architecture

EcoGraph operates as a single persistent C++ process that serves both the JSON REST API and the static web assets from a unified port (avoiding CORS issues).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Browser (Frontend Web UI)                             │
│  ┌──────────────────┐   ┌────────────────────────┐   ┌───────────────────────┐  │
│  │  Cytoscape.js    │   │  Simulation & Schedule │   │  Waste Classification │  │
│  │ Visual Canvas    │   │   Control Controllers  │   │  & Hazard Dispatch    │  │
│  └─────────┬────────┘   └───────────┬────────────┘   └───────────┬───────────┘  │
│            └────────────────────────┼────────────────────────────┘              │
│                               fetch() JSON API                                  │
└─────────────────────────────────────┼───────────────────────────────────────────┘
                                      │ (HTTP 8080)
┌─────────────────────────────────────▼───────────────────────────────────────────┐
│                          C++ Backend (Single Process)                           │
│                                                                                 │
│  ┌──────────────────┐   ┌────────────────────────┐   ┌───────────────────────┐  │
│  │   cpp-httplib    │──►│  Controller Handlers   │──►│     Domain Engine     │  │
│  │   HTTP Server    │   │   (controllers.cpp)    │   │ Router, Graph, Sched  │  │
│  └──────────────────┘   └────────────────────────┘   └───────────┬───────────┘  │
│                                                                  │              │
│                                                      ┌───────────▼───────────┐  │
│                                                      │    In-Memory State    │  │
│                                                      │  Adjacency Graph,     │  │
│                                                      │  Fill Rates, Log      │  │
│                                                      └───────────┬───────────┘  │
│                                                                  │              │
│                                                      ┌───────────▼───────────┐  │
│                                                      │    data/city.json     │  │
│                                                      └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Structures & Algorithms Matrix

| Concept / Task | Algorithmic Structure | Purpose & Time Complexity |
|---|---|---|
| **City Network Storage** | `std::unordered_map<std::string, Node>` + Adjacency List `std::vector<Edge>` | Fast $O(1)$ node lookup and efficient edge traversal $O(V + E)$. |
| **Shortest Path Computation** | **Dijkstra's Algorithm** with `std::priority_queue` (Min-Heap) | Finds minimum-cost routes from source to target. Time complexity: $O((E + V) \log V)$. |
| **Hazardous Route Exclusion** | **Constrained Dijkstra** (Forbidden Zone Filtering) | Filters out edges belonging to forbidden zones (`residential`/`commercial`) during graph relaxation. |
| **Waste Classification** | String keyword match & rule mapping | Identifies waste type (`organic`, `recyclable`, `medical`, `chemical`) in $O(K)$ keyword string checks. |
| **Collection Scheduling** | Formula: $\text{Interval} = \text{Clamp}\left(\lfloor\frac{\text{Capacity}}{\text{FillRate}}\rfloor, 1, 14\right)$ | Determines due dates per home/bin; ranks urgency using a max-heap. |
| **Path Reconstruction** | Predecessor map vector backtracking | Traces backward from target node to source to reconstruct complete node path sequence. |

---

## Repository Directory Structure

```
EcoGraph/
├── PBL PROPOSAL.md          # Original project specification & academic proposal
├── plan.md                  # Comprehensive architectural design document
├── README.md                # Project documentation (this file)
│
├── frontend/                # Single-Page Web Interface
│   ├── index.html           # Main UI layout (Canvas, Sidebar Controls, DB Table)
│   ├── config.js            # API base URL configuration
│   ├── css/
│   │   └── style.css        # Responsive styles, themes, animations, dark mode
│   └── js/
│       ├── api.js           # Fetch wrapper for C++ REST API endpoints
│       ├── app.js           # Application bootstrap & event bindings
│       ├── controls.js      # Form controls, selection toggles, dispatch handlers
│       ├── database-view.js # Tabular data grid, search, zone statistics
│       ├── graph-view.js    # Cytoscape.js graph rendering & truck path animation
│       ├── schedule-view.js # Schedule renderer & due list list view
│       ├── simulation-view.js# Time-step playback controls (+1 day, play, reset)
│       └── theme.js         # Light/Dark mode state toggle
│
└── server/                  # C++ Backend Engine
    ├── CMakeLists.txt       # CMake build configuration
    ├── build.sh             # POSIX build script using GCC/G++
    ├── data/
    │   └── city.json        # City network topology (nodes, edges, zones, fill rates)
    ├── include/
    │   ├── city_loader.hpp  # JSON loader for city topology
    │   ├── controllers.hpp  # HTTP endpoint route handler signatures & AppState
    │   ├── dijkstra.hpp     # Dijkstra & Constrained Dijkstra algorithms
    │   ├── graph.hpp        # Graph, Node, Edge, ZoneType definitions
    │   ├── router.hpp       # Priority & FIFO route builders
    │   ├── scheduler.hpp    # Dynamic fill-rate collection scheduler
    │   ├── simulation.hpp   # Time-step day simulation engine & logger
    │   └── waste_classifier.hpp # Keyword-based waste classification rules
    ├── src/
    │   ├── city_loader.cpp  # Parsing data/city.json into Graph memory
    │   ├── controllers.cpp  # REST HTTP handlers logic & JSON responses
    │   ├── dijkstra.cpp     # Shortest path algorithms implementation
    │   ├── graph.cpp        # Graph adjacency list methods
    │   ├── main.cpp         # Server entry point & static file mount
    │   ├── router.cpp       # Multi-stop routing strategy logic
    │   ├── scheduler.cpp    # Urgency calculations & due evaluation
    │   ├── simulation.cpp   # Day advance & auto-collect logic
    │   └── waste_classifier.cpp # Waste classification engine implementation
    ├── tests/
    │   ├── test_dijkstra.cpp   # Dijkstra & constrained routing unit tests
    │   ├── test_domain.cpp     # Domain logic (Graph, Scheduler, Router) unit tests
    │   └── test_simulation.cpp # Time-step simulation unit tests
    └── third_party/
        ├── httplib.h        # Header-only cpp-httplib HTTP server framework
        └── json.hpp         # Header-only nlohmann/json parser library
```

---

## REST API Endpoints

### 1. System & Topology
- **`GET /health`**
  - Response: `{"ok": true}`
- **`GET /graph`**
  - Returns complete network topology (nodes, edges, zone tags, fill rates, capacities, overdue days).

### 2. Route Optimization
- **`POST /route`**
  - Request: `{"homes": ["home1", "home2"], "mode": "priority" | "fifo"}`
  - Response: `{"ok": true, "path": [...], "cost": 42.5, "segments": [...]}`
- **`POST /route/hazard`**
  - Request: `{"location": "home_med"}`
  - Response: `{"ok": true, "path": [...], "cost": 18.2, "hazardous": true, "forbiddenZones": ["residential", "commercial"]}`

### 3. Classification & Scheduling
- **`POST /classify`**
  - Request: `{"description": "used chemical syringe"}`
  - Response: `{"ok": true, "category": "medical", "binType": "medical_bin", "hazardous": true}`
- **`GET /schedule`**
  - Returns array of homes and bins due or overdue for collection today.
- **`POST /collect`**
  - Request: `{"nodes": ["home1", "home2"]}`
  - Resets `lastCollected` timestamps for specified nodes to current simulation time.

### 4. Simulation Engine & Database
- **`GET /simulation`**
  - Returns current day, date string, due count, and overflow count.
- **`POST /simulate/advance`**
  - Request: `{"days": 1, "autoCollect": true}`
  - Advances simulation clock, updates node fill levels, triggers auto-collections if enabled.
- **`POST /simulate/reset`**
  - Resets simulation to Day 0 and reloads initial city data.
- **`GET /database`**
  - Returns complete tabular state for all nodes, per-zone statistical summaries, and historical log entries.

---

## 🛠️ Build & Installation Guide

### Prerequisites
- **GCC / G++ compiler** with C++17 support and POSIX thread support (GCC 7+ recommended).
- **CMake 3.14+** (optional, for CMake builds) or standard `make` / `sh`.

### 1. Build Using Shell Script (`build.sh`)
```bash
# Navigate to server directory
cd server

# Execute build script
sh build.sh
```

### 2. Build Using CMake
```bash
cd server
mkdir build && cd build
cmake ..
cmake --build .
```

### 3. Running the Server
```bash
# Executable usage: ./ecorouting [port] [city_file_path] [frontend_dir_path]
./build/ecorouting 8080 data/city.json ../frontend
```

Once running, open your web browser at:
 **`http://localhost:8080`**

---

## Running Unit Tests

EcoGraph includes dedicated C++ unit test executables covering pathfinding, constrained routing, domain models, and simulation clocks.

```bash
cd server/build

# Run Dijkstra & Constrained Routing Tests
./test_dijkstra

# Run Domain Logic & Scheduler Tests
./test_domain

# Run Time-Step Simulation Engine Tests
./test_simulation
```

---

## Authors & Academic Credits

- **Course:** Data Structures & Algorithms in C++ Project (2026)
- **Team ID:** `DSCPP-III-2026-T186`
- **Mentor:** Navneet Rajput
- **Team Members:**
  - **Tejas Jain** (2028228, SEC-A)
  - **Yash Nigam** (2028289, SEC-H)
  - **Apoorv Negi** (2027640, SEC-D)

---


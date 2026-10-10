# EcoGraph — Smart Waste Collection Routing & Scheduling System

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

## Theoretical Framework & Algorithmic Foundations

EcoGraph grounds municipal waste logistics in formal graph theory, constrained optimization, priority queuing, and object-oriented architectural principles. The system addresses critical systemic inefficiencies identified in conventional waste collection networks.

### 1. Problem Formulation & Theoretical Motivation

Municipal solid waste collection has historically relied on static, empirical scheduling. This leads to three fundamental operational failures:
1. **Inflexible Static Routing**: Collection vehicles follow static, pre-planned routes regardless of daily city traffic conditions or actual waste accumulation. This produces excessive Vehicle Kilometers Traveled (VKT), elevated fuel consumption, and unnecessary greenhouse gas emissions.
2. **Indiscriminate Hazardous Waste Handling**: High-risk waste streams (such as biohazardous **medical waste** and toxic **chemical waste**) cannot be treated as ordinary municipal solid waste. Mixing them into regular collection loops or routing them through densely populated residential neighborhoods creates severe contamination and public health risks.
3. **Decoupled Capacity Dynamics**: Calendar-based collections (e.g., visiting every street each Monday) ignore variable waste generation rates ($r_i$). Low-generation locations are serviced when nearly empty (wasting labor and transit overhead), while high-generation bins overflow before the next scheduled visit, causing sanitary hazards.

**EcoGraph** resolves these challenges by formulating urban waste logistics as a **dynamically weighted, zone-constrained graph optimization problem** integrated with a **predictive fill-rate adaptive scheduler**.

---

### 2. Integration of Academic Course Concepts (PBL Foundations)

The architecture maps core theoretical concepts from **Data Structures & Algorithms** and **Object-Oriented Programming with C++** into an integrated systems pipeline:

#### A. Data Structures & Computational Complexity

| Data Structure / Algorithm | Formal Role in EcoGraph | Time Complexity | Space Complexity |
|---|---|---|---|
| **Graph (Adjacency List)** | $G = (V, E)$ stored via `std::unordered_map<std::string, std::vector<Edge>>`. Nodes represent spatial entities (Depot, Homes, Junctions, Bins); edges represent weighted road segments tagged with zone types. | Traversal: $O(V + E)$ | $O(V + E)$ |
| **Hash Map (`std::unordered_map`)** | Key-value store mapping node identifiers to node metadata, coordinates, fill levels, and adjacency vectors. | Average Lookup: $O(1)$ | $O(V)$ |
| **Priority Queue (Min-Heap)** | `std::priority_queue` with `std::greater` comparator. Powers Dijkstra's frontier exploration to greedily extract the minimum tentative distance node. | Extraction: $O(\log V)$<br>Insertion: $O(\log V)$ | $O(V)$ |
| **Priority Queue (Max-Heap)** | Evaluates dynamic scheduling urgency. Ranks due nodes by their calculated degree of "overdue-ness" ($\Delta t - \text{Interval}$). | Extract-Max: $O(\log V)$ | $O(V)$ |
| **FIFO Queue (`std::queue`)** | First-In, First-Out sequence structure used in FIFO Collection Mode to sequence batched household pickups before disposal. | Enqueue/Dequeue: $O(1)$ | $O(V)$ |
| **Predecessor Backtracking (Vector)** | Traces parent pointers $\pi[v]$ from target node back to origin source to reconstruct the complete ordered path sequence. | Path Recovery: $O(V)$ | $O(V)$ |

#### B. Object-Oriented Design (OOP Pillars in C++)

- **Encapsulation**: The `Graph` class strictly encapsulates internal adjacency lists and node data structures. External controllers cannot arbitrarily mutate topology; all access and mutation proceed through safe, well-defined public member functions (`neighbors()`, `getNode()`, `loadFromJson()`).
- **Abstraction**: Internal algorithmic complexity is abstracted behind high-level interfaces. The `Scheduler` exposes a concise `getDueLocations()` interface hiding internal heap operations and time calculations. Similarly, the `WasteClassifier` exposes `classifyWaste()` hiding keyword parsing logic.
- **Inheritance**: Route generation adheres to an extensible strategy pattern where specialized builders (`PriorityRouteBuilder`, `FIFORouteBuilder`) inherit from a unified `RouteStrategy` base class.
- **Polymorphism**: The system utilizes runtime polymorphism via virtual method overrides (`virtual RouteResult buildRoute(...) = 0`), enabling dynamic switching between routing heuristics based on user parameters or operational conditions.

---

### 3. Graph Network Representation & Storage Architecture

The municipal transit network is modeled as a directed, weighted, attribute-rich graph:

$$G = (V, E)$$

#### Vertex Set ($V$)
Each vertex $v \in V$ represents a distinct spatial facility characterized by:
- **Identifier**: Unique string key $v_{\text{id}} \in \Sigma^*$
- **Node Classification**: $\tau(v) \in \{\text{Depot}, \text{Home}, \text{Junction}, \text{Bin}\}$
- **Zone Tagging**: $z(v) \in \{\text{Residential}, \text{Commercial}, \text{Industrial}, \text{Arterial}\}$
- **Volumetric Parameters**: Capacity $C(v) \in \mathbb{R}^+$, fill generation rate $r(v) \in \mathbb{R}^+$, and last collection timestamp $t_{\text{last}}(v)$.

#### Edge Set ($E$)
Each directed or bidirectional edge $e = (u, v) \in E$ carries:
- **Cost / Distance Weight**: $w(u, v) \in \mathbb{R}^+$ (representing physical travel distance or transit time).
- **Edge Zone Attribute**: $z(e) \in \{\text{Residential}, \text{Commercial}, \text{Industrial}, \text{Arterial}\}$, decoupled from endpoint zone classifications to accurately model cross-zonal transit links.

#### Storage Architecture (Adjacency List)
Rather than an $O(|V|^2)$ dense adjacency matrix, EcoGraph employs an in-memory adjacency list representation:

```
[DEPOT] ──(4.2 km, arterial)────► [J1]
                                   │
                    ┌──────────────┴──────────────┐
       (3.1 km, residential)              (5.0 km, arterial)
                    ▼                             ▼
                  [H1]                          [IN1]
                    │                             │
       (6.0 km, industrial)               (3.0 km, industrial)
                    ▼                             ▼
                  [B1] ◄──────────────────────────┘
```

This guarantees optimal space utilization for sparse urban road graphs ($|E| \ll |V|^2$) and provides $O(\text{deg}(u))$ edge enumeration during path relaxation.

---

### 4. Shortest-Path Optimization: Dijkstra's Algorithm

For standard non-hazardous routing (depot-to-home, home-to-home, and home-to-bin segments), EcoGraph computes minimum-cost traversals using Dijkstra's algorithm implemented with a binary min-heap priority queue.

#### Algorithmic Execution Steps
1. **Initialization**: Initialize distance table $\text{dist}[s] \leftarrow 0$ and $\text{dist}[v] \leftarrow \infty \quad \forall v \in V \setminus \{s\}$. Push $(0, s)$ into min-heap $Q$.
2. **Min-Extraction**: Dequeue vertex $u$ with minimum tentative distance $\text{dist}[u]$ from $Q$. If $u$ is already processed, skip (lazy deletion).
3. **Edge Relaxation**: For each outgoing edge $(u, v) \in E$ with weight $w(u, v)$:
   $$\text{if } \text{dist}[u] + w(u, v) < \text{dist}[v] \implies \begin{cases} \text{dist}[v] \leftarrow \text{dist}[u] + w(u, v) \\ \pi[v] \leftarrow u \\ \text{push } (\text{dist}[v], v) \text{ to } Q \end{cases}$$
4. **Path Reconstruction**: Backtrack through predecessor pointers $\pi$ starting from destination $t$ back to source $s$.

**Computational Complexity**: With $|V|$ vertices and $|E|$ edges, min-heap extraction costs $O(|V| \log |V|)$ and edge relaxations cost $O(|E| \log |V|)$, yielding overall time complexity:

$$T(V, E) = O((|V| + |E|) \log |V|)$$

---

### 5. Zone-Constrained Pathfinding for Hazardous Materials

Hazardous substances (biohazardous medical sharps, cytotoxic pharmaceuticals, reactive chemicals) pose critical contagion and toxicity hazards. EcoGraph implements **Constrained Dijkstra** to enforce spatial isolation.

#### Mathematical Formulation
Given source $s$ and destination bin $t$, the constrained shortest path $P^*$ satisfies:

$$P^* = \arg\min_{P \in \mathcal{P}_{s \to t}} \sum_{e \in P} w(e) \quad \text{subject to} \quad \forall e \in P, \ z(e) \notin \mathcal{Z}_{\text{forbidden}}$$

where $\mathcal{Z}_{\text{forbidden}} = \{\text{Residential}, \text{Commercial}\}$.

```
   [J1 (Start)]
      │
      ├───(cost: 2, residential)───► [R1] ───(cost: 2)───► [Hazard Bin]  ❌ FORBIDDEN (Cost 4)
      │                                                     ▲
      └───(cost: 5, industrial)────► [IN1] ──(cost: 3)─────┘           ✅ ALLOWED (Cost 8)
```

#### Algorithmic Mechanism
During the relaxation phase:
- For each edge $(u, v)$, the algorithm inspects $z(u, v)$ and $z(v)$.
- If $z(u, v) \in \mathcal{Z}_{\text{forbidden}}$ or $z(v) \in \mathcal{Z}_{\text{forbidden}}$, the edge is treated as having infinite cost ($w = \infty$) and relaxation is bypassed.
- **Safety Guarantee**: The vehicle is mathematically restricted to arterial highways and industrial zones, preventing exposure to densely populated neighborhoods.
- **Unreachability Handling**: If no valid path exists within the permitted zones, the router halts and returns an unprocessable response (`HTTP 422 Unprocessable Entity`), alerting operators to configure a designated transit corridor.

---

### 6. Dynamic Scheduling & Fill-Rate Mathematics

Rather than static calendar schedules (e.g., every Tuesday), EcoGraph uses a volumetric predictive fill-rate model to determine optimal collection frequencies.

#### Adaptive Interval Formulation
For each node $i$, given capacity $C_i$ (in kg or liters) and daily fill generation rate $r_i$ (in units/day), the dynamic collection interval $\text{Interval}_i$ (in days) is calculated as:

$$\text{Interval}_i = \text{clamp}\left( \left\lfloor \frac{C_i}{r_i} \right\rfloor, \ 1, \ 14 \right)$$

- **Lower Bound ($\text{Floor} = 1 \text{ day}$)**: Prevents redundant multiple dispatches within the same operational day cycle.
- **Upper Bound ($\text{Ceiling} = 14 \text{ days}$)**: Enforces a bi-weekly hygiene and sanitation ceiling to prevent odor and decomposition, regardless of how slowly a container fills.

#### Urgency Metric & Max-Heap Priority Ranking
At any simulation time $t_{\text{current}}$, the elapsed time since last service is:

$$\Delta t_i = t_{\text{current}} - t_{\text{lastCollected}, i}$$

A location is classified as **due for collection** when:

$$\Delta t_i \ge \text{Interval}_i$$

The degree of **overdue-ness (Urgency)** is defined as:

$$\text{Urgency}_i = \Delta t_i - \text{Interval}_i$$

All due locations are inserted into a **Max-Heap Priority Queue** ordered by $\text{Urgency}_i$. Locations with the largest backlog or risk of overflowing are prioritized at the top of the collection schedule.

#### Worked Computational Example (From Evaluation Presentation)

Consider four sample locations evaluated on a simulation day:

| Location | Capacity ($C_i$) | Fill Rate ($r_i$) | Interval Formula ($\lfloor C_i / r_i \rfloor$) | Clamped Interval | Elapsed ($\Delta t$) | Overdue Margin ($\Delta t - \text{Interval}$) | Collection Status |
|---|---|---|---|---|---|---|---|
| **H1** (Home 1) | 50 units | 5 units/day | $50 / 5 = 10\text{d}$ | **10 days** | 9 days | $-1$ day | Not Due (1 day remaining) |
| **H2** (Home 2) | 100 units | 20 units/day | $100 / 20 = 5\text{d}$ | **5 days** | 6 days | $+1$ day | **Due** (1 day overdue) |
| **B1** (Bin 1) | 300 units | 40 units/day | $300 / 40 = 7.5\text{d}$ | **7 days** | 10 days | $+3$ days | **Due** (3 days overdue) |
| **B2** (Bin 2) | 100 units | 2 units/day | $100 / 2 = 50\text{d}$ | **14 days** *(clamped)* | 20 days | $+6$ days | **Due** (6 days overdue) |

**Max-Heap Dispatch Order**:
$$\mathbf{B2 \ (+6d)} \ \longrightarrow \ \mathbf{B1 \ (+3d)} \ \longrightarrow \ \mathbf{H2 \ (+1d)}$$
*(H1 is deferred until its interval elapsed threshold is reached).*

---

### 7. Multi-Stop Routing Strategies & Hazard Preemption

Once due locations are identified, the routing engine constructs an optimal multi-stop tour using one of two selectable collection strategies:

#### A. Priority Mode (Immediate Disposal Loop)
- **Concept**: After collecting waste from a home, the truck immediately traverses to the nearest compatible disposal bin before proceeding to the next stop.
- **Traversal Sequence**:
  $$\text{Depot} \longrightarrow \text{Home}_1 \longrightarrow \text{Bin}_{\text{nearest}} \longrightarrow \text{Home}_2 \longrightarrow \text{Bin}_{\text{nearest}} \longrightarrow \dots \longrightarrow \text{Depot}$$
- **Optimal Use Case**: Suitable for perishable, odorous organic waste or systems with limited onboard truck capacity where cross-contamination must be eliminated.

#### B. FIFO Mode (Batched Route Optimization)
- **Concept**: The truck visits all scheduled pickup locations in batch sequence, consolidating waste in its cargo hold, and subsequently traverses to designated disposal facilities.
- **Traversal Sequence**:
  $$\text{Depot} \longrightarrow \text{Home}_1 \longrightarrow \text{Home}_2 \longrightarrow \dots \longrightarrow \text{Home}_k \longrightarrow \text{Bin}_1 \longrightarrow \text{Bin}_2 \longrightarrow \dots \longrightarrow \text{Depot}$$
- **Optimal Use Case**: General household recyclables and inert dry waste, minimizing total transit kilometers and fuel consumption.

#### C. Hazard Preemption Mechanism
When the waste classification engine identifies a waste description as hazardous (`medical` or `chemical`):
1. **Bypasses Schedule Queue**: The pickup skips the standard scheduler queue and due-date wait intervals.
2. **Immediate Emergency Dispatch**: Triggers an instant `POST /route/hazard` calculation.
3. **Zone Isolation**: The vehicle is restricted strictly to arterial and industrial corridors via Constrained Dijkstra, keeping residential neighborhoods safe.

---

### 8. Rule-Based Waste Classification Engine

The system integrates an in-process keyword classification engine that maps plain-text waste descriptions into standardized disposal categories and assigned bin types:

$$\text{Description} \xrightarrow{\quad \text{Keyword Matching} \quad} (\text{Category}, \ \text{Bin Type}, \ \text{Hazard Flag})$$

- **Organic Waste** (e.g., `food scraps`, `vegetables`, `leaves`) $\longrightarrow$ Target: `compost_bin` (Non-hazardous)
- **Recyclable Waste** (e.g., `plastic bottles`, `cardboard`, `paper`) $\longrightarrow$ Target: `recyclable_bin` (Non-hazardous)
- **Medical Waste** (e.g., `syringe`, `bandages`, `scalpel`) $\longrightarrow$ Target: `medical_bin` (**Hazardous — Triggers Emergency Constrained Dispatch**)
- **Chemical Waste** (e.g., `solvents`, `battery acid`, `paint`) $\longrightarrow$ Target: `chemical_bin` (**Hazardous — Triggers Emergency Constrained Dispatch**)

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
│       ├── city-builder.js  # Interactive city topology builder & node editor
│       ├── database-view.js # Tabular data grid, search, zone statistics
│       ├── graph-view.js    # Cytoscape.js graph rendering & truck path animation
│       ├── schedule-view.js # Schedule renderer & due list view
│       ├── simulation-view.js# Time-step playback controls (+1 day, play, reset)
│       └── theme.js         # Light/Dark mode state toggle
│
└── server/                  # C++ Backend Engine
    ├── CMakeLists.txt       # CMake build configuration
    ├── build.sh             # POSIX build script using GCC/G++
    ├── data/
    │   └── city.json        # City network topology (nodes, edges, zones, fill rates)
    ├── include/
    │   ├── city_generator.hpp # Synthetic & procedural city network generator
    │   ├── city_loader.hpp  # JSON loader for city topology
    │   ├── controllers.hpp  # HTTP endpoint route handler signatures & AppState
    │   ├── dijkstra.hpp     # Dijkstra & Constrained Dijkstra algorithms
    │   ├── geo.hpp          # Geodesic & Haversine distance computations
    │   ├── graph.hpp        # Graph, Node, Edge, ZoneType definitions
    │   ├── router.hpp       # Priority & FIFO route builders
    │   ├── scheduler.hpp    # Dynamic fill-rate collection scheduler
    │   ├── simulation.hpp   # Time-step day simulation engine & logger
    │   └── waste_classifier.hpp # Keyword-based waste classification rules
    ├── src/
    │   ├── city_generator.cpp # Procedural city generation implementation
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
    │   ├── test_city_data.cpp  # City topology connectivity & reachability validation
    │   ├── test_dijkstra.cpp   # Dijkstra & constrained routing unit tests
    │   ├── test_domain.cpp     # Domain logic (Graph, Scheduler, Router) unit tests
    │   ├── test_generator.cpp  # Procedural city graph generation tests
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


---

## Future Work

- A* pathfinding with coordinate heuristics
- Multi-truck routing with capacity constraints
- Route optimization (2-opt) for FIFO mode
- CSV export of the collection log
## Run with Docker

```bash
docker build -t ecograph .
docker run -p 8080:8080 ecograph
```

Then open `http://localhost:8080`.

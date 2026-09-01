# EcoGraph — Smart Waste Collection Routing System

**Project Proposal — C++ Backend Redesign**

## Problem Description

Municipal waste collection routes are often static and inefficient, with trucks following fixed paths regardless of the actual shortest route between homes, bins, and the depot. This wastes fuel, time, and labor. EcoGraph models a city's waste-collection network as a weighted graph — comprising a depot, homes, road junctions, and disposal bins — and computes optimal collection routes using shortest-path algorithms.

Beyond routine routing, some waste (medical, chemical) is hazardous and cannot be treated like ordinary household waste — it must be picked up immediately and routed away from populated areas. In addition, different locations fill up with garbage at different rates, so a fixed collection schedule wastes trips at slow-filling locations and under-serves fast-filling ones. This project extends the system to handle both concerns.

This project builds the system with C++ as the primary backend: a persistent HTTP server that owns the graph, performs routing, classification, and scheduling in-process, and serves JSON directly to a JavaScript frontend.

## Features

- **Graph-based city model** — depot, homes, junctions, and bins represented as weighted graph nodes and edges, with each node/edge tagged by **zone type** (residential, commercial, industrial)
- **Shortest-path routing** using Dijkstra's algorithm for depot-to-home and home-to-bin segments
- **Two collection strategies**, selectable via a toggle: Priority mode (dispose after each pickup: home → bin → next home → bin...) and FIFO mode (collect from all queued homes first, then dispose in sequence)
- **Rule-based waste classification** — keyword matching (e.g. plastic, paper, organic) to route waste to the correct bin type
- **Hazardous waste handling (new)** — a separate category for **medical waste** and **chemical waste**:
  - Flagged for **immediate collection and disposal**, bypassing the normal queue/schedule
  - Routed using a **constrained shortest path** that avoids edges/nodes tagged as residential or commercial, restricting travel to industrial or arterial routes only
- **Dynamic collection frequency (new)** — each home/bin has a **fill-rate** value; a scheduler determines how often it needs to be visited:
  - Fast-filling locations get **high-frequency** collection (e.g. daily)
  - Slow-filling locations get **low-frequency** collection (e.g. weekly)
  - The system computes which locations are "due" for collection on a given day and only routes those
- **REST API** exposing endpoints for graph data, route computation, waste classification, and scheduling
- **Live route animation** on the frontend, showing the truck traversing the computed path, with hazardous routes visually distinguished from regular ones

## Concepts Used

| Concept | Application in the Project |
|---|---|
| Graph (adjacency list) | City map: nodes represent depot/homes/junctions/bins; edges represent weighted travel costs and are tagged with zone type |
| Dijkstra's algorithm + min-heap priority queue | Computes the shortest path from the depot or a home to the next stop |
| Constrained Dijkstra (edge/node exclusion) | Computes hazardous-waste routes that avoid residential/commercial zones by treating restricted edges as impassable |
| Queue (FIFO) | Maintains the order in which homes are visited in FIFO mode |
| Priority queue (min-heap, by urgency) | Ranks homes/bins by how "due" they are for collection based on fill-rate, and prioritizes hazardous pickups above all |
| Path reconstruction (vector/stack) | Backtracks through Dijkstra's predecessor map to build the final route |
| Hash map (unordered_map) | Maps node IDs to adjacency lists, graph coordinates, zone tags, and fill-rate/schedule data for O(1) lookup |
| String matching / rule engine | Classifies waste type from keyword descriptions, including detection of hazardous categories |
| Scheduling logic | Tracks last-collected time and fill-rate per location to compute the next due date and dynamically adjust visit frequency |
| HTTP server and REST routing | Serves the frontend and exposes the routing/classification/scheduling API |
| JSON serialization | Structures request and response bodies between backend and frontend |

## Recommended Technology Stack

- **C++ HTTP framework:** cpp-httplib (single-header, minimal setup) or Crow (Express.js-style routing)
- **JSON library:** nlohmann/json (header-only)
- **Frontend:** Cytoscape.js for graph rendering and route animation

## Implementation Steps

### 1. Define the Graph Data Model
Create `Node` and `Edge` structures (id, type, coordinates, weight, **zone tag**) and a `Graph` class backed by an `unordered_map` adjacency list. Load the city layout — depot, homes, junctions, bins, and their zone tags — from a JSON configuration file at startup. Each home/bin node also stores a **fill-rate** value and a **last-collected timestamp**.

### 2. Implement Dijkstra's Algorithm
Write a `shortestPath(Graph&, source, destination)` function using a min-heap priority queue. Return both the path (sequence of node IDs) and the total travel cost. Validate against known shortest paths in the sample graph.

### 3. Implement Constrained Routing for Hazardous Waste
Extend the shortest-path function to accept a set of forbidden zone types (e.g. residential, commercial). During relaxation, skip edges/nodes whose zone tag is in the forbidden set — effectively treating them as having infinite weight. Use this variant whenever a route is being computed for medical or chemical waste.

### 4. Implement Waste Classification
Write a `classifyWaste(description)` function using keyword matching to map a waste description to a bin type (e.g. recyclable, compost, general, **medical**, **chemical**). If the result is medical or chemical, mark the pickup as **hazardous** so it triggers immediate, constrained routing instead of being placed in the normal queue.

### 5. Implement the Two Routing Modes
**Priority mode:** for each home in order, route depot/previous-bin → home → nearest matching bin, concatenating segments. **FIFO mode:** route depot → home1 → home2 → ... → homeN, then bin1 → bin2 → ..., visiting all pickups before any disposal. Hazardous pickups are pulled out of both modes and dispatched immediately via the constrained route.

### 6. Implement the Dynamic Frequency Scheduler
For each home/bin, compute a **collection interval** from its fill-rate (higher fill-rate → shorter interval). Each day (or on request), compare `last-collected timestamp + interval` against the current time to determine which locations are **due**. Feed only the due locations into the route-generation step, and update the timestamp once a location is collected.

### 7. Build the HTTP Server
Expose endpoints:
- `GET /graph` — returns the full node/edge list as JSON (including zone tags)
- `POST /route` — accepts a home list and mode, returns the computed path and cost
- `POST /classify` — accepts a waste description, returns the bin type and whether it's hazardous
- `POST /route/hazard` — accepts a hazardous pickup location, returns a zone-constrained route for immediate dispatch
- `GET /schedule` — returns which homes/bins are due for collection today, based on fill-rate

### 8. Serve the Frontend
Serve static frontend files (HTML/CSS/JS) directly from the C++ server, so the API and frontend share the same origin.

### 9. Connect the Frontend Toggle and Animation
On route computation, the frontend sends the selected homes and mode to `POST /route` and animates the returned path using Cytoscape.js — pulsing nodes and highlighting edges in sequence. Hazardous routes are animated in a distinct color/style, and due-for-collection locations (from `/schedule`) are visually flagged on the map.

### 10. Add Concurrency and Persistence (Stretch Goal)
Introduce a thread pool for concurrent request handling, and optionally persist graph, queue, and schedule state (fill-rates, last-collected timestamps) to a JSON file or SQLite database across restarts.

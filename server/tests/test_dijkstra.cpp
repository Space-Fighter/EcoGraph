#include <cmath>
#include <cstdlib>
#include <iostream>

#include "dijkstra.hpp"
#include "graph.hpp"

static int failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        if (!(cond)) {                                                       \
            std::cerr << "FAIL line " << __LINE__ << ": " #cond << std::endl; \
            ++failures;                                                      \
        }                                                                    \
    } while (0)

static bool near(double a, double b) { return std::fabs(a - b) < 1e-9; }

static std::string join(const std::vector<std::string>& p) {
    std::string s;
    for (size_t i = 0; i < p.size(); ++i) s += (i ? ">" : "") + p[i];
    return s;
}

int main() {
    //   DEPOT --4-- A --1-- B --1-- BIN
    //     \                         /
    //      `-------- 10 ------------'
    //   ISLAND is disconnected.
    Graph g;
    g.addNode("DEPOT", NodeType::Depot, ZoneType::Industrial);
    g.addNode("A", NodeType::Junction, ZoneType::Arterial);
    g.addNode("B", NodeType::Home, ZoneType::Residential);
    g.addNode("BIN", NodeType::Bin, ZoneType::Industrial);
    g.addNode("ISLAND", NodeType::Home, ZoneType::Residential);
    g.addEdge("DEPOT", "A", 4, ZoneType::Arterial);
    g.addEdge("A", "B", 1, ZoneType::Residential);
    g.addEdge("B", "BIN", 1, ZoneType::Industrial);
    g.addEdge("DEPOT", "BIN", 10, ZoneType::Industrial);

    // Multi-hop path (cost 6) beats the direct edge (cost 10).
    PathResult r = shortestPath(g, "DEPOT", "BIN");
    CHECK(near(r.cost, 6));
    CHECK(join(r.path) == "DEPOT>A>B>BIN");

    // Edges are bidirectional.
    r = shortestPath(g, "BIN", "DEPOT");
    CHECK(near(r.cost, 6));
    CHECK(join(r.path) == "BIN>B>A>DEPOT");

    // Source == destination.
    r = shortestPath(g, "A", "A");
    CHECK(near(r.cost, 0));
    CHECK(join(r.path) == "A");

    // Unreachable and unknown nodes.
    r = shortestPath(g, "DEPOT", "ISLAND");
    CHECK(r.cost == -1);
    CHECK(r.path.empty());
    r = shortestPath(g, "DEPOT", "NOPE");
    CHECK(r.cost == -1);

    // A directed edge only works one way.
    Graph d;
    d.addNode("X", NodeType::Junction, ZoneType::Arterial);
    d.addNode("Y", NodeType::Junction, ZoneType::Arterial);
    d.addEdge("X", "Y", 2, ZoneType::Arterial, false);
    CHECK(near(shortestPath(d, "X", "Y").cost, 2));
    CHECK(shortestPath(d, "Y", "X").cost == -1);

    if (failures == 0) {
        std::cout << "All Dijkstra tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

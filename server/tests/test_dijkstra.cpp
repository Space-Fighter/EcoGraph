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

    // One tree from DEPOT answers every destination, matching shortestPath for each.
    ShortestPathTree t = shortestPathTree(g, "DEPOT");
    CHECK(near(t.costTo("DEPOT"), 0) && near(t.costTo("A"), 4));
    CHECK(near(t.costTo("B"), 5) && near(t.costTo("BIN"), 6));
    CHECK(join(t.pathTo("BIN").path) == "DEPOT>A>B>BIN");
    CHECK(t.costTo("ISLAND") == -1 && t.pathTo("ISLAND").path.empty());
    CHECK(t.costTo("NOPE") == -1);

    // Forbidden zones apply to the tree too: without the residential A-B edge, BIN is 10 away.
    std::set<ZoneType> noResidential;
    noResidential.insert(ZoneType::Residential);
    ShortestPathTree c = shortestPathTree(g, "DEPOT", noResidential);
    CHECK(near(c.costTo("BIN"), 10));
    CHECK(join(c.pathTo("BIN").path) == "DEPOT>BIN");
    CHECK(near(c.costTo("B"), 11));  // reached from BIN's side instead
    CHECK(shortestPathTree(g, "NOPE").costTo("NOPE") == -1);

    // Zone factors scale edge costs: a residential factor of 3 makes the A-B detour cost
    // 4 + 3 + 1 = 8, still cheaper than the 10 km DEPOT-BIN road; a factor of 10 is not.
    ZoneFactors light;
    light.residential = 3;
    PathResult wp = weightedShortestPath(g, "DEPOT", "BIN", light);
    CHECK(near(wp.cost, 8) && join(wp.path) == "DEPOT>A>B>BIN");
    ZoneFactors heavy;
    heavy.residential = 10;
    CHECK(join(weightedShortestPath(g, "DEPOT", "BIN", heavy).path) == "DEPOT>BIN");
    CHECK(near(weightedShortestPathTree(g, "DEPOT", heavy).costTo("BIN"), 10));
    CHECK(weightedShortestPath(g, "DEPOT", "NOPE", heavy).cost == -1);

    if (failures == 0) {
        std::cout << "All Dijkstra tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

#include <cmath>
#include <iostream>

#include "dijkstra.hpp"
#include "graph.hpp"
#include "router.hpp"
#include "scheduler.hpp"
#include "waste_classifier.hpp"

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

static const std::time_t NOW = 1800000000;
static const double DAY = 86400.0;

static Node mk(const std::string& id, NodeType t, ZoneType z) {
    Node n;
    n.id = id;
    n.type = t;
    n.zone = z;
    return n;
}

// DEPOT -- J1 --(res 2)-- H1 --(res 2)-- J2 -- BIN   (short, but residential)
//   \__________(arterial 5)______/  J1 -- J2 (arterial 5)
static Graph makeTrapGraph() {
    Graph g;
    g.addNode(mk("DEPOT", NodeType::Depot, ZoneType::Industrial));
    g.addNode(mk("J1", NodeType::Junction, ZoneType::Arterial));
    g.addNode(mk("J2", NodeType::Junction, ZoneType::Arterial));
    Node h = mk("H1", NodeType::Home, ZoneType::Residential);
    h.wasteDescription = "used syringe";
    g.addNode(h);
    Node b = mk("BMED", NodeType::Bin, ZoneType::Industrial);
    b.binType = "medical";
    g.addNode(b);
    g.addEdge("DEPOT", "J1", 1, ZoneType::Arterial);
    g.addEdge("J1", "H1", 2, ZoneType::Residential);
    g.addEdge("H1", "J2", 2, ZoneType::Residential);
    g.addEdge("J1", "J2", 5, ZoneType::Arterial);
    g.addEdge("J2", "BMED", 1, ZoneType::Industrial);
    return g;
}

static void testConstrained() {
    Graph g = makeTrapGraph();
    std::set<ZoneType> forbid;
    forbid.insert(ZoneType::Residential);

    PathResult plain = shortestPath(g, "J1", "BMED");
    CHECK(near(plain.cost, 5));  // J1>H1>J2>BMED = 2+2+1
    CHECK(join(plain.path) == "J1>H1>J2>BMED");

    PathResult c = constrainedShortestPath(g, "J1", "BMED", forbid);
    CHECK(near(c.cost, 6));  // forced onto the arterial edge: 5+1
    CHECK(join(c.path) == "J1>J2>BMED");

    // Nothing can reach H1 once residential edges are banned.
    CHECK(constrainedShortestPath(g, "DEPOT", "H1", forbid).cost == -1);
}

static void testClassifier() {
    CHECK(classifyWaste("Used plastic SYRINGE").binType == "medical");
    CHECK(classifyWaste("Used plastic syringe").hazardous);
    CHECK(classifyWaste("old paint tin").binType == "chemical");
    CHECK(classifyWaste("empty plastic bottle").binType == "recyclable");
    CHECK(!classifyWaste("empty plastic bottle").hazardous);
    CHECK(classifyWaste("vegetable peels").binType == "compost");
    CHECK(classifyWaste("broken chair").binType == "general");
}

static void testScheduler() {
    Scheduler s;
    Node n = mk("H", NodeType::Home, ZoneType::Residential);
    n.fillRate = 20;
    n.capacity = 100;
    CHECK(near(s.computeInterval(n), 5));
    n.fillRate = 2;
    CHECK(near(s.computeInterval(n), 14));  // 50 days clamped to 14
    n.fillRate = 500;
    CHECK(near(s.computeInterval(n), 1));   // 0.2 days clamped to 1
    n.fillRate = 0;
    CHECK(near(s.computeInterval(n), 14));

    n.fillRate = 20;  // interval 5 days
    n.lastCollected = NOW - static_cast<std::time_t>(4.9 * DAY);
    CHECK(!s.isDue(n, NOW));
    n.lastCollected = NOW - static_cast<std::time_t>(5.1 * DAY);
    CHECK(s.isDue(n, NOW));

    Graph g;
    Node a = mk("A", NodeType::Home, ZoneType::Residential);
    a.fillRate = 20; a.capacity = 100; a.lastCollected = NOW - static_cast<std::time_t>(6 * DAY);  // 1 day late
    Node b = mk("B", NodeType::Home, ZoneType::Residential);
    b.fillRate = 20; b.capacity = 100; b.lastCollected = NOW - static_cast<std::time_t>(8 * DAY);  // 3 days late
    Node c = mk("C", NodeType::Home, ZoneType::Residential);
    c.fillRate = 20; c.capacity = 100; c.lastCollected = NOW - static_cast<std::time_t>(1 * DAY);  // not due
    g.addNode(a); g.addNode(b); g.addNode(c);
    std::vector<DueLocation> due = s.getDueLocations(g, NOW);
    CHECK(due.size() == 2);
    CHECK(due[0].id == "B" && due[1].id == "A");  // most overdue first
    s.markCollected(g, "B", NOW);
    CHECK(s.getDueLocations(g, NOW).size() == 1);
}

// DEPOT -1- J -1- HA / HB / BIN; HA is far from BIN, HB is closer.
static Graph makeRouteGraph() {
    Graph g;
    g.addNode(mk("DEPOT", NodeType::Depot, ZoneType::Industrial));
    g.addNode(mk("J", NodeType::Junction, ZoneType::Arterial));
    for (int i = 0; i < 3; ++i) {
        std::string id = i == 0 ? "H1" : i == 1 ? "H2" : "H3";
        Node h = mk(id, NodeType::Home, ZoneType::Residential);
        h.fillRate = 20; h.capacity = 100;
        h.wasteDescription = i == 2 ? "used syringe" : "plastic bottle";
        h.lastCollected = NOW - static_cast<std::time_t>((i == 0 ? 6 : 9) * DAY);  // H2 more overdue
        g.addNode(h);
    }
    Node b = mk("BIN", NodeType::Bin, ZoneType::Industrial);
    b.binType = "recyclable";
    g.addNode(b);
    g.addEdge("DEPOT", "J", 1, ZoneType::Arterial);
    g.addEdge("J", "H1", 1, ZoneType::Arterial);
    g.addEdge("J", "H2", 2, ZoneType::Arterial);
    g.addEdge("J", "H3", 1, ZoneType::Arterial);
    g.addEdge("J", "BIN", 3, ZoneType::Industrial);
    return g;
}

static void testRouters() {
    Graph g = makeRouteGraph();
    std::vector<std::string> homes;
    homes.push_back("H1"); homes.push_back("H2"); homes.push_back("H3");

    RouteResult fifo = makeRouteStrategy("fifo")->buildRoute(g, homes, NOW);
    CHECK(fifo.skippedHazardous.size() == 1 && fifo.skippedHazardous[0] == "H3");
    CHECK(fifo.segments.size() == 3);  // DEPOT>H1, H1>H2, H2>BIN
    CHECK(fifo.segments[0].label == "DEPOT->H1");
    CHECK(fifo.segments[1].label == "H1->H2");
    CHECK(fifo.segments[2].label == "H2->BIN");
    CHECK(near(fifo.totalCost, 2 + 3 + 5));

    RouteResult pri = makeRouteStrategy("priority")->buildRoute(g, homes, NOW);
    CHECK(pri.segments.size() == 4);  // DEPOT>H2, H2>BIN, BIN>H1, H1>BIN
    CHECK(pri.segments[0].label == "DEPOT->H2");  // H2 is the most overdue
    CHECK(pri.segments[2].label == "BIN->H1");

    CHECK(makeRouteStrategy("bogus") == nullptr);
}

static void testHazard() {
    Graph g = makeTrapGraph();
    HazardResult h = dispatchHazard(g, "J1");  // J1 has no waste: still dispatchable
    CHECK(h.ok);
    CHECK(h.binId == "BMED");
    CHECK(near(h.totalCost, 1 + 6));
    CHECK(h.segments.size() == 2);

    HazardResult bad = dispatchHazard(g, "H1");  // H1 only reachable via residential edges
    CHECK(!bad.ok);
    CHECK(bad.error == "no_hazard_route");
}

int main() {
    testConstrained();
    testClassifier();
    testScheduler();
    testRouters();
    testHazard();
    if (failures == 0) {
        std::cout << "All domain tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

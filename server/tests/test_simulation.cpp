#include <iostream>

#include "graph.hpp"
#include "scheduler.hpp"
#include "simulation.hpp"

static int failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        if (!(cond)) {                                                       \
            std::cerr << "FAIL line " << __LINE__ << ": " #cond << std::endl; \
            ++failures;                                                      \
        }                                                                    \
    } while (0)

static const std::time_t BASE = 1800000000;

static Node mk(const std::string& id, NodeType t, ZoneType z) {
    Node n;
    n.id = id;
    n.type = t;
    n.zone = z;
    return n;
}

static Graph makeGraph() {
    Graph g;
    g.addNode(mk("DEPOT", NodeType::Depot, ZoneType::Industrial));
    g.addNode(mk("J", NodeType::Junction, ZoneType::Arterial));
    Node h = mk("H1", NodeType::Home, ZoneType::Residential);
    h.fillRate = 20;  // capacity 100 -> due every 5 days
    h.capacity = 100;
    h.lastCollected = BASE;
    h.wasteDescription = "plastic bottle";
    g.addNode(h);
    Node b = mk("BIN", NodeType::Bin, ZoneType::Industrial);
    b.binType = "recyclable";
    b.fillRate = 0;
    b.lastCollected = BASE;
    g.addNode(b);
    g.addEdge("DEPOT", "J", 1, ZoneType::Arterial);
    g.addEdge("J", "H1", 1, ZoneType::Arterial);
    g.addEdge("J", "BIN", 3, ZoneType::Industrial);
    return g;
}

int main() {
    Graph g = makeGraph();
    Scheduler sched;
    Simulation sim;
    sim.start(BASE);
    CHECK(sim.day() == 0);
    CHECK(sim.now() == BASE);

    // Days 1-4: nothing is due yet.
    for (int i = 0; i < 4; ++i) {
        DayReport r = sim.advanceDay(g, sched, false);
        CHECK(r.due.empty());
    }
    CHECK(sim.day() == 4);

    // Day 5: exactly at the interval, due but not overflowing (100% is not > 100%).
    DayReport d5 = sim.advanceDay(g, sched, false);
    CHECK(d5.due.size() == 1 && d5.due[0] == "H1");
    CHECK(d5.overflowCount == 0);
    CHECK(sim.log().empty());  // advancing without autoCollect collects nothing

    // Day 6 with autoCollect: now overflowing (120%), gets collected.
    DayReport d6 = sim.advanceDay(g, sched, true);
    CHECK(d6.overflowCount == 1);
    CHECK(d6.collected.size() == 1 && d6.collected[0] == "H1");
    CHECK(!d6.segments.empty());
    CHECK(d6.routeCost > 0);
    CHECK(sim.log().size() == 1);
    CHECK(sim.log()[0].action == "route");
    CHECK(sim.log()[0].id == "H1");
    CHECK(sim.log()[0].percentFull > 119 && sim.log()[0].percentFull < 121);
    CHECK(g.getNode("H1").lastCollected == sim.now());

    // Day 7: just collected, so nothing due.
    DayReport d7 = sim.advanceDay(g, sched, true);
    CHECK(d7.due.empty());
    CHECK(d7.segments.empty());

    // Manual collect is logged too.
    sim.collect(g, sched, "H1", "manual");
    CHECK(sim.log().size() == 2 && sim.log()[1].action == "manual");

    // Scheduler helpers.
    const Node& h = g.getNode("H1");
    CHECK(sched.percentFull(h, sim.now()) < 1e-6);
    CHECK(sched.nextDue(h) == sim.now() + 5 * 86400);

    // Restart goes back to day 0 with an empty log.
    sim.start(BASE);
    CHECK(sim.day() == 0 && sim.log().empty());

    if (failures == 0) {
        std::cout << "All simulation tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

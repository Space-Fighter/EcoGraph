#include <algorithm>
#include <iostream>

#include "graph.hpp"
#include "router.hpp"
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
static const double DAY = 86400.0;

static Node mk(const std::string& id, NodeType t, ZoneType z) {
    Node n;
    n.id = id;
    n.type = t;
    n.zone = z;
    return n;
}

static bool has(const std::vector<std::string>& v, const std::string& s) {
    return std::find(v.begin(), v.end(), s) != v.end();
}

// DEPOT - J - {H1,H2,H3 (recyclable), HZ1,HZ2 (hazardous)}, BIN (recyclable), BMED (medical)
// Every home: fillRate 20, capacity 100 -> due every 5 days, 100 units of load when due.
static Graph makeGraph() {
    Graph g;
    g.addNode(mk("DEPOT", NodeType::Depot, ZoneType::Industrial));
    g.addNode(mk("J", NodeType::Junction, ZoneType::Arterial));
    const char* homes[] = {"H1", "H2", "H3", "HZ1", "HZ2"};
    for (int i = 0; i < 5; ++i) {
        Node h = mk(homes[i], NodeType::Home, ZoneType::Residential);
        h.fillRate = 20;
        h.capacity = 100;
        h.lastCollected = BASE;
        h.wasteDescription = i < 3 ? "plastic bottle" : "used syringe";
        g.addNode(h);
        g.addEdge("J", homes[i], 1, ZoneType::Arterial);
    }
    // HZ1 became due earlier than HZ2 (collected a day before the others).
    g.getNodeMutable("HZ1").lastCollected = BASE - static_cast<std::time_t>(DAY);
    Node b = mk("BIN", NodeType::Bin, ZoneType::Industrial);
    b.binType = "recyclable";
    b.lastCollected = BASE;  // fillRate 0 -> interval 14 days, so not due during these tests
    g.addNode(b);
    Node m = mk("BMED", NodeType::Bin, ZoneType::Industrial);
    m.binType = "medical";
    m.lastCollected = BASE;
    g.addNode(m);
    g.addEdge("DEPOT", "J", 1, ZoneType::Arterial);
    g.addEdge("J", "BIN", 3, ZoneType::Industrial);
    g.addEdge("J", "BMED", 3, ZoneType::Industrial);
    return g;
}

static void advanceTo(Simulation& sim, Graph& g, const Scheduler& s, int day, const RouteStrategy& st,
                      const Fleet& f) {
    while (sim.day() < day) sim.advanceDay(g, s, false, st, f);
}

static void testClockAndDue() {
    Graph g = makeGraph();
    Scheduler s;
    Simulation sim;
    sim.start(BASE);
    PriorityRouteBuilder st;
    Fleet f;
    CHECK(sim.day() == 0 && sim.now() == BASE);

    for (int i = 0; i < 3; ++i) CHECK(sim.advanceDay(g, s, false, st, f).due.empty());  // days 1-3
    // HZ1 was last collected a day earlier, so it is the first thing due (day 4).
    DayReport d4 = sim.advanceDay(g, s, false, st, f);
    CHECK(d4.due.size() == 1 && d4.due[0] == "HZ1");
    DayReport d5 = sim.advanceDay(g, s, false, st, f);
    CHECK(d5.due.size() == 5);          // all five homes, bins have fillRate 0
    CHECK(d5.overflowIds.size() == 1);  // only HZ1 is past 100% (120%)
    CHECK(sim.log().empty());           // no autoCollect -> nothing collected
}

static void testTruckCapacityAndCarryOver() {
    Graph g = makeGraph();
    Scheduler s;
    Simulation sim;
    sim.start(BASE);
    PriorityRouteBuilder st;
    Fleet f;
    f.normalTrucks = 1;
    f.normalCapacity = 150;  // one 100-unit home fits, two do not
    f.hazardTrucks = 5;      // not the constraint in this test
    advanceTo(sim, g, s, 4, st, f);

    DayReport d5 = sim.advanceDay(g, s, true, st, f);
    int normal = 0;
    for (size_t i = 0; i < d5.trucks.size(); ++i) normal += d5.trucks[i].kind == "normal";
    CHECK(normal == 1);
    const TruckRun* n1 = nullptr;
    for (size_t i = 0; i < d5.trucks.size(); ++i) if (d5.trucks[i].id == "N1") n1 = &d5.trucks[i];
    CHECK(n1 != nullptr);
    CHECK(n1 && n1->homes.size() == 1);
    CHECK(n1 && n1->load <= 150);
    CHECK(d5.carriedOver.size() == 2);  // 3 normal homes, one truck, one home each day
    CHECK(!d5.trucks.empty() && d5.totalCost > 0);

    // The leftovers are still due next day and now overflowing (120%): visible overflow.
    DayReport d6 = sim.advanceDay(g, s, true, st, f);
    CHECK(d6.overflowIds.size() == 2);
    CHECK(d6.carriedOver.size() == 1);

    // With no normal trucks at all nothing normal is collected.
    Graph g2 = makeGraph();
    Simulation sim2;
    sim2.start(BASE);
    Fleet none;
    none.normalTrucks = 0;
    advanceTo(sim2, g2, s, 4, st, none);
    DayReport z = sim2.advanceDay(g2, s, true, st, none);
    CHECK(z.carriedOver.size() >= 3);
}

static void testHazardQueue() {
    Graph g = makeGraph();
    Scheduler s;
    Simulation sim;
    sim.start(BASE);
    FIFORouteBuilder st;
    Fleet f;
    f.hazardTrucks = 1;
    advanceTo(sim, g, s, 4, st, f);  // day 4: only HZ1 due, HZ2 not yet

    DayReport d4 = sim.advanceDay(g, s, true, st, f);  // day 5 here; HZ1 is 120%, HZ2 100%
    // One hazard truck: HZ1 first (due first), HZ2 has to wait a day.
    const TruckRun* hz = nullptr;
    for (size_t i = 0; i < d4.trucks.size(); ++i) if (d4.trucks[i].kind == "hazard") hz = &d4.trucks[i];
    CHECK(hz != nullptr);
    CHECK(hz && hz->id == "HT1" && hz->homes.size() == 1 && hz->homes[0] == "HZ1");
    CHECK(hz && hz->bin == "BMED");
    CHECK(has(d4.carriedOver, "HZ2"));
    bool logged = false;
    for (size_t i = 0; i < sim.log().size(); ++i) {
        if (sim.log()[i].id == "HZ1") logged = sim.log()[i].action == "hazard" && sim.log()[i].truck == "HT1";
    }
    CHECK(logged);

    // Next day HZ2 gets its turn.
    DayReport next = sim.advanceDay(g, s, true, st, f);
    bool served = false;
    for (size_t i = 0; i < next.trucks.size(); ++i) {
        if (next.trucks[i].kind == "hazard" && next.trucks[i].homes.size() == 1 && next.trucks[i].homes[0] == "HZ2") served = true;
    }
    CHECK(served);
}

static void testOrderingMatters() {
    // Two homes, one truck that only fits one: Priority takes the fuller one, FIFO the
    // one that became due first.
    for (int variant = 0; variant < 2; ++variant) {
        Graph g;
        g.addNode(mk("DEPOT", NodeType::Depot, ZoneType::Industrial));
        g.addNode(mk("J", NodeType::Junction, ZoneType::Arterial));
        Node full = mk("FULL", NodeType::Home, ZoneType::Residential);   // fast filler: 125%, due 0.5 d ago
        full.fillRate = 50; full.capacity = 100;
        full.lastCollected = BASE - static_cast<std::time_t>(2.5 * DAY);
        full.wasteDescription = "plastic bottle";
        Node old = mk("OLD", NodeType::Home, ZoneType::Residential);     // slow filler: 120%, due 2 d ago
        old.fillRate = 10; old.capacity = 100;
        old.lastCollected = BASE - static_cast<std::time_t>(12 * DAY);
        old.wasteDescription = "plastic bottle";
        g.addNode(full); g.addNode(old);
        Node b = mk("BIN", NodeType::Bin, ZoneType::Industrial);
        b.binType = "recyclable";
        g.addNode(b);
        g.addEdge("DEPOT", "J", 1, ZoneType::Arterial);
        g.addEdge("J", "FULL", 1, ZoneType::Arterial);
        g.addEdge("J", "OLD", 1, ZoneType::Arterial);
        g.addEdge("J", "BIN", 1, ZoneType::Industrial);

        Scheduler s;
        Simulation sim;
        sim.start(BASE);
        Fleet f;
        f.normalTrucks = 1;
        f.normalCapacity = 100;  // FULL carries 175 units, OLD 130: each alone exceeds it, so
                                 // a truck takes exactly one (a truck always takes its first)
        PriorityRouteBuilder pri;
        FIFORouteBuilder fifo;
        const RouteStrategy& st = variant == 0 ? static_cast<const RouteStrategy&>(pri)
                                               : static_cast<const RouteStrategy&>(fifo);
        DayReport d = sim.advanceDay(g, s, true, st, f);
        CHECK(d.trucks.size() == 1 && d.trucks[0].homes.size() == 1);
        if (d.trucks.size() == 1 && d.trucks[0].homes.size() == 1) {
            CHECK(d.trucks[0].homes[0] == (variant == 0 ? "FULL" : "OLD"));
        }
        CHECK(d.carriedOver.size() == 1);
    }
}

static void testBinsAndManual() {
    Graph g = makeGraph();
    g.getNodeMutable("BIN").fillRate = 100;  // capacity 100 -> interval clamped to 1 day
    g.getNodeMutable("BIN").capacity = 100;
    g.getNodeMutable("BIN").lastCollected = BASE;
    Scheduler s;
    Simulation sim;
    sim.start(BASE);
    PriorityRouteBuilder st;
    Fleet f;
    DayReport d1 = sim.advanceDay(g, s, true, st, f);
    CHECK(d1.emptiedBins.size() == 1 && d1.emptiedBins[0] == "BIN");
    CHECK(g.getNode("BIN").lastCollected == sim.now());

    sim.collect(g, s, "H1", "manual");
    CHECK(sim.log().back().action == "manual" && sim.log().back().truck.empty());
    CHECK(s.percentFull(g.getNode("H1"), sim.now()) < 1e-6);

    sim.start(BASE);
    CHECK(sim.day() == 0 && sim.log().empty());
}

int main() {
    testClockAndDue();
    testTruckCapacityAndCarryOver();
    testHazardQueue();
    testOrderingMatters();
    testBinsAndManual();
    if (failures == 0) {
        std::cout << "All simulation tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

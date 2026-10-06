#include <cmath>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>

#include "city_generator.hpp"
#include "city_loader.hpp"
#include "dijkstra.hpp"
#include "geo.hpp"
#include "router.hpp"
#include "waste_classifier.hpp"

static int failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        if (!(cond)) {                                                       \
            std::cerr << "FAIL line " << __LINE__ << ": " #cond << std::endl; \
            ++failures;                                                      \
        }                                                                    \
    } while (0)

static const std::time_t NOW = 1800000000;

static std::string findCityFile() {
    const char* candidates[] = {"data/city.json", "../data/city.json", "../../data/city.json"};
    for (int i = 0; i < 3; ++i) {
        std::ifstream f(candidates[i]);
        if (f) return candidates[i];
    }
    return "data/city.json";
}

static const Area* areaByName(const std::vector<Area>& areas, const std::string& name) {
    for (size_t i = 0; i < areas.size(); ++i) if (areas[i].name == name) return &areas[i];
    return nullptr;
}

// Properties every generated node must satisfy, whatever the seed.
static void checkBatch(const City& city, const Graph& g, const GeneratedBatch& b, int count, NodeType type,
                       bool hazardous) {
    CHECK(static_cast<int>(b.nodeIds.size()) == count);
    CHECK(!b.edges.empty());
    std::string depot = g.nodeIdsByType(NodeType::Depot)[0];
    std::set<ZoneType> forbid;
    forbid.insert(ZoneType::Residential);
    forbid.insert(ZoneType::Commercial);

    std::set<std::string> seen;
    for (size_t i = 0; i < b.nodeIds.size(); ++i) {
        const std::string& id = b.nodeIds[i];
        CHECK(seen.insert(id).second);  // unique within the batch
        const Node& n = g.getNode(id);
        CHECK(n.type == type);
        CHECK(!g.neighbors(id).empty());                 // wired into the network
        CHECK(shortestPath(g, depot, id).cost >= 0);     // and reachable

        const Area* a = areaByName(city.areas, n.area);  // placed inside its locality
        CHECK(a != nullptr);
        if (a) CHECK(haversineKm(a->lat, a->lng, n.lat, n.lng) <= a->radiusKm + 1e-6);

        if (type == NodeType::Home) {
            CHECK(n.fillRate > 0 && n.capacity > 0 && n.lastCollected <= NOW);
            CHECK(classifyWaste(n.wasteDescription).hazardous == hazardous);
            if (hazardous) CHECK(dispatchHazard(g, id).ok);  // reachable by the restricted route
        }
        if (type == NodeType::Bin) {
            bool hazBin = n.binType == "medical" || n.binType == "chemical";
            CHECK(hazBin == hazardous);
            CHECK(constrainedShortestPath(g, depot, id, forbid).cost >= 0);
        }
    }
}

int main() {
    City base = loadCity(findCityFile(), NOW);
    size_t baseNodes = base.graph.nodeIds().size();

    for (unsigned seed = 1; seed <= 6; ++seed) {
        City city = base;  // generate on a copy, the original stays untouched
        std::mt19937 rng(seed);
        Graph& g = city.graph;

        checkBatch(city, g, generateNodes(g, city.areas, GenKind::Home, false, 15, NOW, rng), 15, NodeType::Home, false);
        checkBatch(city, g, generateNodes(g, city.areas, GenKind::Home, true, 6, NOW, rng), 6, NodeType::Home, true);
        checkBatch(city, g, generateNodes(g, city.areas, GenKind::Bin, false, 5, NOW, rng), 5, NodeType::Bin, false);
        checkBatch(city, g, generateNodes(g, city.areas, GenKind::Bin, true, 3, NOW, rng), 3, NodeType::Bin, true);
        checkBatch(city, g, generateNodes(g, city.areas, GenKind::Junction, false, 4, NOW, rng), 4, NodeType::Junction, false);

        CHECK(g.nodeIds().size() == baseNodes + 15 + 6 + 5 + 3 + 4);

        // Ids stay unique and keep counting up across batches.
        std::set<std::string> all;
        std::vector<std::string> ids = g.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) all.insert(ids[i]);
        CHECK(all.size() == ids.size());
    }
    CHECK(base.graph.nodeIds().size() == baseNodes);

    // Same seed -> identical output (reproducible demos).
    {
        City a = base, b = base;
        std::mt19937 r1(42), r2(42);
        GeneratedBatch ba = generateNodes(a.graph, a.areas, GenKind::Home, false, 5, NOW, r1);
        GeneratedBatch bb = generateNodes(b.graph, b.areas, GenKind::Home, false, 5, NOW, r2);
        CHECK(ba.nodeIds == bb.nodeIds);
        for (size_t i = 0; i < ba.nodeIds.size(); ++i) {
            CHECK(a.graph.getNode(ba.nodeIds[i]).lat == b.graph.getNode(bb.nodeIds[i]).lat);
        }
    }

    // Added nodes are flagged; the city file's nodes are not.
    {
        City c = base;
        std::mt19937 rng(11);
        GeneratedBatch b = generateNodes(c.graph, c.areas, GenKind::Home, false, 3, NOW, rng);
        for (size_t i = 0; i < b.nodeIds.size(); ++i) CHECK(c.graph.getNode(b.nodeIds[i]).generated);
        std::vector<std::string> ids = base.graph.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) CHECK(!base.graph.getNode(ids[i]).generated);
    }

    // Graph::removeNode leaves no trace of the node.
    {
        City c = base;
        std::mt19937 rng(5);
        GeneratedBatch b = generateNodes(c.graph, c.areas, GenKind::Home, false, 1, NOW, rng);
        std::string id = b.nodeIds[0];
        size_t nodesBefore = c.graph.nodeIds().size();
        c.graph.removeNode(id);
        CHECK(!c.graph.hasNode(id));
        CHECK(c.graph.nodeIds().size() == nodesBefore - 1);
        std::vector<std::string> ids = c.graph.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) {
            const std::vector<Edge>& es = c.graph.neighbors(ids[i]);
            for (size_t k = 0; k < es.size(); ++k) CHECK(es[k].to != id);
        }
        for (size_t i = 0; i < c.graph.edges().size(); ++i) {
            CHECK(c.graph.edges()[i].from != id && c.graph.edges()[i].to != id);
        }
        bool threw = false;
        try { c.graph.removeNode(id); } catch (const std::out_of_range&) { threw = true; }
        CHECK(threw);
    }

    // Removing takes the newest added nodes of the kind, and only those.
    {
        City c = base;
        std::mt19937 rng(21);
        GeneratedBatch homes = generateNodes(c.graph, c.areas, GenKind::Home, false, 5, NOW, rng);
        generateNodes(c.graph, c.areas, GenKind::Bin, false, 2, NOW, rng);
        RemovalResult r = removeGeneratedNodes(c.graph, GenKind::Home, false, 2);
        CHECK(r.removed.size() == 2);
        CHECK(r.removed[0] == homes.nodeIds[4] && r.removed[1] == homes.nodeIds[3]);  // newest first
        CHECK(!c.graph.hasNode(homes.nodeIds[4]) && c.graph.hasNode(homes.nodeIds[2]));
        CHECK(c.graph.nodeIdsByType(NodeType::Bin).size() == base.graph.nodeIdsByType(NodeType::Bin).size() + 2);

        // Asking for more than exist removes what there is, never original nodes.
        removeGeneratedNodes(c.graph, GenKind::Home, false, 100);
        CHECK(c.graph.nodeIdsByType(NodeType::Home).size() == base.graph.nodeIdsByType(NodeType::Home).size());
        // Nothing left to remove -> empty result, no crash.
        CHECK(removeGeneratedNodes(c.graph, GenKind::Home, false, 5).removed.empty());
        // A kind that was never added: nothing happens either.
        CHECK(removeGeneratedNodes(c.graph, GenKind::Junction, false, 5).removed.empty());
    }

    // Whatever mix is added and removed, the city stays connected, hazardous sites stay
    // reachable by the restricted route, and every original node survives.
    for (unsigned seed = 1; seed <= 8; ++seed) {
        City c = base;
        std::mt19937 rng(seed * 101);
        generateNodes(c.graph, c.areas, GenKind::Junction, false, 5, NOW, rng);
        generateNodes(c.graph, c.areas, GenKind::Home, false, 12, NOW, rng);
        generateNodes(c.graph, c.areas, GenKind::Home, true, 6, NOW, rng);
        generateNodes(c.graph, c.areas, GenKind::Bin, true, 3, NOW, rng);
        generateNodes(c.graph, c.areas, GenKind::Bin, false, 3, NOW, rng);
        // Remove junctions first: the nodes attached to them must follow, not be left stranded.
        RemovalResult r = removeGeneratedNodes(c.graph, GenKind::Junction, false, 5);
        CHECK(r.removed.size() == 5);
        removeGeneratedNodes(c.graph, GenKind::Bin, true, 2);

        std::string depot = c.graph.nodeIdsByType(NodeType::Depot)[0];
        std::set<ZoneType> forbid;
        forbid.insert(ZoneType::Residential);
        forbid.insert(ZoneType::Commercial);
        std::vector<std::string> ids = c.graph.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) {
            const Node& n = c.graph.getNode(ids[i]);
            CHECK(shortestPath(c.graph, depot, n.id).cost >= 0);
            bool hazard = (n.type == NodeType::Home && classifyWaste(n.wasteDescription).hazardous) ||
                          (n.type == NodeType::Bin && (n.binType == "medical" || n.binType == "chemical"));
            if (hazard) CHECK(constrainedShortestPath(c.graph, depot, n.id, forbid).cost >= 0);
        }
        std::vector<std::string> orig = base.graph.nodeIds();
        for (size_t i = 0; i < orig.size(); ++i) CHECK(c.graph.hasNode(orig[i]));
    }

    // No localities -> a clear error rather than a crash.
    {
        Graph g;
        std::mt19937 rng(1);
        bool threw = false;
        try {
            generateNodes(g, std::vector<Area>(), GenKind::Home, false, 1, NOW, rng);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        CHECK(threw);
    }

    if (failures == 0) {
        std::cout << "All generator tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

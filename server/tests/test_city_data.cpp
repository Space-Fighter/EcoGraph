// Validates the hand-authored data/city.json so a typo can not silently break the demo.
#include <cmath>
#include <fstream>
#include <iostream>
#include <set>

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

static std::string findCityFile() {
    const char* candidates[] = {"data/city.json", "../data/city.json", "../../data/city.json"};
    for (int i = 0; i < 3; ++i) {
        std::ifstream f(candidates[i]);
        if (f) return candidates[i];
    }
    return "data/city.json";
}

static void testHaversine() {
    CHECK(std::fabs(haversineKm(30.0, 78.0, 31.0, 78.0) - 111.19) < 0.2);  // 1 degree of latitude
    CHECK(haversineKm(30.3, 78.0, 30.3, 78.0) == 0.0);
}

int main() {
    testHaversine();

    const std::time_t NOW = 1800000000;
    City city = loadCity(findCityFile(), NOW);
    const Graph& g = city.graph;
    std::vector<std::string> ids = g.nodeIds();

    CHECK(ids.size() >= 40);
    CHECK(city.areas.size() >= 8);
    CHECK(g.nodeIdsByType(NodeType::Depot).size() == 1);

    std::set<std::string> areaNames;
    bool hasClementTown = false;
    for (size_t i = 0; i < city.areas.size(); ++i) {
        areaNames.insert(city.areas[i].name);
        CHECK(city.areas[i].radiusKm > 0);
        hasClementTown = hasClementTown || city.areas[i].name == "Clement Town";
    }
    CHECK(hasClementTown);

    std::string depot = g.nodeIdsByType(NodeType::Depot)[0];
    int clementHomes = 0, hazardHomes = 0, trapHazardHomes = 0;
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        // Located around Dehradun and inside a known locality.
        CHECK(n.lat > 30.2 && n.lat < 30.45);
        CHECK(n.lng > 77.8 && n.lng < 78.2);
        CHECK(areaNames.count(n.area) == 1);
        CHECK(!n.name.empty());

        // Nothing is cut off from the depot.
        CHECK(shortestPath(g, depot, n.id).cost >= 0);

        if (n.type == NodeType::Home || n.type == NodeType::Bin) {
            CHECK(n.fillRate > 0 && n.capacity > 0);
            CHECK(n.lastCollected > 0 && n.lastCollected <= NOW);
        }
        if (n.type == NodeType::Bin) CHECK(!n.binType.empty());
        if (n.type == NodeType::Home) {
            CHECK(!n.wasteDescription.empty());
            if (n.area == "Clement Town") ++clementHomes;
            if (classifyWaste(n.wasteDescription).hazardous) {
                ++hazardHomes;
                // A hazard truck must be able to serve it without crossing homes/shops.
                HazardResult h = dispatchHazard(g, n.id);
                CHECK(h.ok);
                // And the data should contain the "shortcut trap" the restriction avoids.
                std::set<ZoneType> forbid;
                forbid.insert(ZoneType::Residential);
                forbid.insert(ZoneType::Commercial);
                PathResult plain = shortestPath(g, depot, n.id);
                PathResult restricted = constrainedShortestPath(g, depot, n.id, forbid);
                if (restricted.cost > plain.cost + 1e-9) ++trapHazardHomes;
            }
        }
    }
    CHECK(clementHomes >= 3);
    CHECK(hazardHomes >= 4);
    CHECK(trapHazardHomes >= 1);

    // At least one bin of every kind a home can produce.
    std::set<std::string> binTypes;
    std::vector<std::string> bins = g.nodeIdsByType(NodeType::Bin);
    for (size_t i = 0; i < bins.size(); ++i) binTypes.insert(g.getNode(bins[i]).binType);
    CHECK(binTypes.count("general") && binTypes.count("recyclable") && binTypes.count("compost"));
    CHECK(binTypes.count("medical") && binTypes.count("chemical"));

    if (failures == 0) {
        std::cout << "All city data tests passed" << std::endl;
        return 0;
    }
    std::cerr << failures << " check(s) failed" << std::endl;
    return 1;
}

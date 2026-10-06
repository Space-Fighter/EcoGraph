#ifndef CITY_LOADER_HPP
#define CITY_LOADER_HPP

#include <ctime>
#include <string>
#include <vector>

#include "graph.hpp"

// A named locality: a circle on the map. Used for map labels, per-locality statistics and
// as the regions where generated nodes are placed.
struct Area {
    std::string name;
    ZoneType zone;
    double lat;
    double lng;
    double radiusKm;
};

struct City {
    Graph graph;
    std::vector<Area> areas;
};

// Parses a city.json file. Per node: id, type, zone, lat, lng, optional name/area and (for
// homes/bins) fillRate, capacity, binType, wasteDescription and either lastCollectedDaysAgo
// (relative to `now`, so demo data is always fresh) or an absolute lastCollected epoch.
// Per edge: from, to, zone, optional directed, and an optional weight in km (default: the
// straight-line distance between the nodes times ROAD_FACTOR).
// Throws std::runtime_error on bad input.
City loadCity(const std::string& path, std::time_t now);

#endif

#ifndef CITY_GENERATOR_HPP
#define CITY_GENERATOR_HPP

#include <ctime>
#include <random>
#include <string>
#include <vector>

#include "city_loader.hpp"
#include "graph.hpp"

enum class GenKind { Home, Bin, Junction };

// Everything one generation call added, so callers (the API, tests) can report it.
struct GeneratedBatch {
    std::vector<std::string> nodeIds;
    std::vector<EdgeRecord> edges;
};

// Adds `count` random nodes to the graph, placed inside suitable localities and wired into
// the road network so they are always reachable:
//   - homes   : a spur to the nearest junction plus one street to the next nearest node
//   - bins    : an industrial road to the nearest junction (+ the nearest other bin)
//   - junctions: arterial roads to the 3 nearest junctions
// `hazardous` makes a hazardous home (medical/chemical waste) or a hazardous bin
// (medical/chemical). Hazardous homes always get an arterial spur, so the zone-restricted
// hazard route can still reach them. Ids are the next free H#, HZ#, B#, J#.
// Throws std::invalid_argument if there are no localities to place nodes in.
GeneratedBatch generateNodes(Graph& g, const std::vector<Area>& areas, GenKind kind, bool hazardous,
                             int count, std::time_t now, std::mt19937& rng);

struct RemovalResult {
    std::vector<std::string> removed;   // the nodes that were asked for, newest first
    std::vector<std::string> cascaded;  // added nodes that lost their only route and went too
};

// Removes up to `count` of the NEWEST nodes added by generateNodes() that match the kind
// (same meaning of `hazardous` as above). Nodes from the city file are never touched.
// An added node that is left with no route to the depot - or, for hazardous homes and
// facilities, with no route that avoids residential/commercial roads - is removed too, so
// the city never ends up with stranded nodes. Returns what was removed (possibly nothing).
RemovalResult removeGeneratedNodes(Graph& g, GenKind kind, bool hazardous, int count);

#endif

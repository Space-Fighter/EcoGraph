#ifndef DIJKSTRA_HPP
#define DIJKSTRA_HPP

#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include "graph.hpp"

struct PathResult {
    std::vector<std::string> path;  // source..dest, empty if unreachable
    double cost;                    // -1 if unreachable
};

PathResult shortestPath(const Graph& g, const std::string& source, const std::string& dest);

// Same algorithm, but edges whose zone is in forbiddenZones are treated as if they
// did not exist.
PathResult constrainedShortestPath(const Graph& g, const std::string& source,
                                   const std::string& dest,
                                   const std::set<ZoneType>& forbiddenZones);

// Every node reachable from source, with its distance and the node before it on its shortest
// path. One run answers "how far is each candidate?" (e.g. the nearest bin) without a separate
// Dijkstra per candidate.
struct ShortestPathTree {
    std::string source;
    std::unordered_map<std::string, double> dist;
    std::unordered_map<std::string, std::string> prev;

    double costTo(const std::string& dest) const;     // -1 if unreachable
    PathResult pathTo(const std::string& dest) const;  // cost -1 and empty path if unreachable
};

ShortestPathTree shortestPathTree(const Graph& g, const std::string& source,
                                  const std::set<ZoneType>& forbiddenZones = std::set<ZoneType>());

#endif

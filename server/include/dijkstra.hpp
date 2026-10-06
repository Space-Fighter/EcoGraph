#ifndef DIJKSTRA_HPP
#define DIJKSTRA_HPP

#include <set>
#include <string>
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

#endif

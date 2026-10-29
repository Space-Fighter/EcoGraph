#include "dijkstra.hpp"

#include <algorithm>
#include <functional>
#include <limits>
#include <queue>
#include <unordered_map>
#include <utility>

namespace {

ZoneFactors forbidding(const std::set<ZoneType>& forbidden) {
    const double INF = std::numeric_limits<double>::infinity();
    ZoneFactors f;
    if (forbidden.count(ZoneType::Residential)) f.residential = INF;
    if (forbidden.count(ZoneType::Commercial)) f.commercial = INF;
    if (forbidden.count(ZoneType::Industrial)) f.industrial = INF;
    if (forbidden.count(ZoneType::Arterial)) f.arterial = INF;
    return f;
}

// Dijkstra from source on weight * factor(zone). Stops as soon as stopAt is settled; an empty
// stopAt settles every reachable node. An infinite factor makes the edge invisible.
ShortestPathTree run(const Graph& g, const std::string& source, const std::string& stopAt,
                     const ZoneFactors& factors) {
    ShortestPathTree tree;
    tree.source = source;
    if (!g.hasNode(source)) return tree;
    
    const double INF = std::numeric_limits<double>::infinity();
    std::unordered_map<std::string, double>& dist = tree.dist;
    std::unordered_map<std::string, std::string>& prev = tree.prev;

    typedef std::pair<double, std::string> Entry;
    std::priority_queue<Entry, std::vector<Entry>, std::greater<Entry> > pq;

    dist[source] = 0;
    pq.push(Entry(0, source));

    while (!pq.empty()) {
        Entry top = pq.top();
        pq.pop();
        double d = top.first;
        const std::string u = top.second;

        if (d > dist[u]) continue;  // stale entry: a shorter route to u was already found
        if (u == stopAt) break;     // dest popped, its distance is final

        const std::vector<Edge>& edges = g.neighbors(u);
        for (size_t i = 0; i < edges.size(); ++i) {
            const Edge& e = edges[i];
            double factor = factors.of(e.zone);
            if (factor == INF) continue;  // constrained mode: edge is invisible
            double nd = d + e.weight * factor;
            std::unordered_map<std::string, double>::iterator it = dist.find(e.to);
            double current = (it == dist.end()) ? INF : it->second;
            if (nd < current) {
                dist[e.to] = nd;
                prev[e.to] = u;
                pq.push(Entry(nd, e.to));
            }
        }
    }
    return tree;
}

}  // namespace

double ZoneFactors::of(ZoneType z) const {
    switch (z) {
        case ZoneType::Residential: return residential;
        case ZoneType::Commercial: return commercial;
        case ZoneType::Industrial: return industrial;
        case ZoneType::Arterial: return arterial;
    }
    return arterial;
}

double ShortestPathTree::costTo(const std::string& dest) const {
    std::unordered_map<std::string, double>::const_iterator it = dist.find(dest);
    return it == dist.end() ? -1 : it->second;
}

PathResult ShortestPathTree::pathTo(const std::string& dest) const {
    PathResult result;
    result.cost = costTo(dest);
    if (result.cost < 0) return result;  // unreachable

    // Walk prev[] back from dest to source, then reverse.
    std::string cur = dest;
    result.path.push_back(cur);
    while (cur != source) {
        cur = prev.at(cur);
        result.path.push_back(cur);
    }
    std::reverse(result.path.begin(), result.path.end());
    return result;
}
// Computes shortest paths from a source node while excluding edges belonging to forbidden zones.
ShortestPathTree shortestPathTree(const Graph& g, const std::string& source,
                                  const std::set<ZoneType>& forbiddenZones) {
    return run(g, source, std::string(), forbidding(forbiddenZones));
}

ShortestPathTree weightedShortestPathTree(const Graph& g, const std::string& source,
                                          const ZoneFactors& factors) {
    return run(g, source, std::string(), factors);
}

PathResult weightedShortestPath(const Graph& g, const std::string& source, const std::string& dest,
                                const ZoneFactors& factors) {
    if (!g.hasNode(dest)) {
        PathResult none;
        none.cost = -1;
        return none;
    }
    return run(g, source, dest, factors).pathTo(dest);
}
// Reconstructs the shortest path by tracing predecessor nodes from the destination back to the source.
PathResult shortestPath(const Graph& g, const std::string& source, const std::string& dest) {
    return constrainedShortestPath(g, source, dest, std::set<ZoneType>());
}

PathResult constrainedShortestPath(const Graph& g, const std::string& source,
                                   const std::string& dest,
                                   const std::set<ZoneType>& forbiddenZones) {
    if (!g.hasNode(dest)) {
        PathResult none;
        none.cost = -1;
        return none;
    }
    return run(g, source, dest, forbidding(forbiddenZones)).pathTo(dest);
}

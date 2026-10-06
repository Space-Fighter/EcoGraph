#include "dijkstra.hpp"

#include <algorithm>
#include <functional>
#include <limits>
#include <queue>
#include <unordered_map>
#include <utility>

namespace {

PathResult run(const Graph& g, const std::string& source, const std::string& dest,
               const std::set<ZoneType>& forbidden) {
    PathResult result;
    result.cost = -1;
    if (!g.hasNode(source) || !g.hasNode(dest)) return result;

    const double INF = std::numeric_limits<double>::infinity();
    std::unordered_map<std::string, double> dist;
    std::unordered_map<std::string, std::string> prev;

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
        if (u == dest) break;       // dest popped, its distance is final

        const std::vector<Edge>& edges = g.neighbors(u);
        for (size_t i = 0; i < edges.size(); ++i) {
            const Edge& e = edges[i];
            if (forbidden.count(e.zone)) continue;  // constrained mode: edge is invisible
            double nd = d + e.weight;
            std::unordered_map<std::string, double>::iterator it = dist.find(e.to);
            double current = (it == dist.end()) ? INF : it->second;
            if (nd < current) {
                dist[e.to] = nd;
                prev[e.to] = u;
                pq.push(Entry(nd, e.to));
            }
        }
    }

    if (dist.find(dest) == dist.end()) return result;  // unreachable

    // Walk prev[] back from dest to source, then reverse.
    std::vector<std::string> path;
    std::string cur = dest;
    path.push_back(cur);
    while (cur != source) {
        cur = prev[cur];
        path.push_back(cur);
    }
    std::reverse(path.begin(), path.end());

    result.path = path;
    result.cost = dist[dest];
    return result;
}

}  // namespace

PathResult shortestPath(const Graph& g, const std::string& source, const std::string& dest) {
    return run(g, source, dest, std::set<ZoneType>());
}

PathResult constrainedShortestPath(const Graph& g, const std::string& source,
                                   const std::string& dest,
                                   const std::set<ZoneType>& forbiddenZones) {
    return run(g, source, dest, forbiddenZones);
}

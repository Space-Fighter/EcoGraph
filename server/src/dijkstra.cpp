#include "dijkstra.hpp"

#include <algorithm>
#include <functional>
#include <limits>
#include <queue>
#include <unordered_map>
#include <utility>

namespace {

// Dijkstra from source. Stops as soon as stopAt is settled; an empty stopAt settles every
// reachable node. Edges whose zone is in forbidden are treated as if they did not exist.
ShortestPathTree run(const Graph& g, const std::string& source, const std::string& stopAt,
                     const std::set<ZoneType>& forbidden) {
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
    return tree;
}

}  // namespace

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

ShortestPathTree shortestPathTree(const Graph& g, const std::string& source,
                                  const std::set<ZoneType>& forbiddenZones) {
    return run(g, source, std::string(), forbiddenZones);
}

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
    return run(g, source, dest, forbiddenZones).pathTo(dest);
}

#include "router.hpp"

#include <algorithm>
#include <set>

#include "dijkstra.hpp"
#include "scheduler.hpp"
#include "waste_classifier.hpp"

namespace {

bool isHazardousDisposalType(const std::string& t) { return t == "medical" || t == "chemical"; }

void appendSegment(std::vector<RouteSegment>& segs, double& total, const std::string& label,
                   const PathResult& p) {
    segs.push_back(RouteSegment{label, p.path, p.cost});
    total += p.cost;
}

}  // namespace

// ---------------------------------------------------------------- RouteStrategy

void RouteStrategy::splitHazardous(const Graph& g, const std::vector<std::string>& homeIds,
                                   std::vector<std::string>& safe,
                                   std::vector<std::string>& hazardous) {
    for (size_t i = 0; i < homeIds.size(); ++i) {
        if (classifyWaste(g.getNode(homeIds[i]).wasteDescription).hazardous) {
            hazardous.push_back(homeIds[i]);
        } else {
            safe.push_back(homeIds[i]);
        }
    }
}

std::string RouteStrategy::depotId(const Graph& g) {
    std::vector<std::string> d = g.nodeIdsByType(NodeType::Depot);
    return d.empty() ? std::string() : d[0];
}

bool RouteStrategy::addLeg(const Graph& g, RouteResult& r, const std::string& from,
                           const std::string& to, const std::string& label) {
    PathResult p = shortestPath(g, from, to);
    if (p.cost < 0) return false;
    appendSegment(r.segments, r.totalCost, label, p);
    return true;
}

std::string RouteStrategy::nearestDisposalSite(const Graph& g, const std::string& from,
                                      const std::string& disposalType) {
    std::vector<std::string> disposalSites = g.nodeIdsByType(NodeType::DisposalSite);
    ShortestPathTree tree = shortestPathTree(g, from);  // one Dijkstra covers every disposal site
    // pass 0: disposal sites of the wanted type, pass 1: general disposal sites, pass 2: any non-hazardous disposal site
    for (int pass = 0; pass < 3; ++pass) {
        std::string best;
        double bestCost = -1;
        for (size_t i = 0; i < disposalSites.size(); ++i) {
            const std::string& bt = g.getNode(disposalSites[i]).disposalType;
            if (isHazardousDisposalType(bt)) continue;
            if (pass == 0 && bt != disposalType) continue;
            if (pass == 1 && bt != "general") continue;
            double cost = tree.costTo(disposalSites[i]);
            if (cost >= 0 && (bestCost < 0 || cost < bestCost)) {
                bestCost = cost;
                best = disposalSites[i];
            }
        }
        if (!best.empty()) return best;
    }
    return std::string();
}

RouteResult RouteStrategy::buildRoute(const Graph& g, const std::vector<std::string>& homeIds,
                                      std::time_t now) const {
    RouteResult r;
    r.mode = mode();
    std::vector<std::string> safe;
    splitHazardous(g, homeIds, safe, r.skippedHazardous);
    std::vector<std::string> ordered = order(g, safe, now);

    std::string current = depotId(g);
    std::vector<std::string> disposalTypes;  // distinct disposal site types needed, in pickup order
    std::set<std::string> done;  // homes already emptied (including en route)
    auto noteDisposalType = [&](const std::string& home) {
        std::string bt = classifyWaste(g.getNode(home).wasteDescription).disposalType;
        if (std::find(disposalTypes.begin(), disposalTypes.end(), bt) == disposalTypes.end()) disposalTypes.push_back(bt);
    };
    for (size_t i = 0; i < ordered.size(); ++i) {
        const std::string& home = ordered[i];
        if (done.count(home)) continue;  // already emptied on the way to an earlier stop
        PathResult p = shortestPath(g, current, home);
        if (p.cost < 0) {
            r.unreachable.push_back(home);
            continue;
        }
        appendSegment(r.segments, r.totalCost, current + "->" + home, p);
        // A later stop that lies on this path is emptied now instead of backtracking to it.
        for (size_t k = 1; k + 1 < p.path.size(); ++k) {
            const std::string& mid = p.path[k];
            if (done.count(mid) || mid == home) continue;
            if (std::find(ordered.begin() + i + 1, ordered.end(), mid) == ordered.end()) continue;
            done.insert(mid);
            r.collectedEnRoute.push_back(mid);
            noteDisposalType(mid);
        }
        done.insert(home);
        current = home;
        noteDisposalType(home);
    }

    // After the last pickup, unload at one disposal site per collected waste type.
    std::set<std::string> visited;
    for (size_t i = 0; i < disposalTypes.size(); ++i) {
        std::string disposalSite = nearestDisposalSite(g, current, disposalTypes[i]);
        if (disposalSite.empty() || visited.count(disposalSite)) continue;
        if (addLeg(g, r, current, disposalSite, current + "->" + disposalSite)) {
            visited.insert(disposalSite);
            current = disposalSite;
        } else {
            r.unreachable.push_back(disposalSite);
        }
    }
    return r;
}

// ---------------------------------------------------------------- Collection order

std::vector<std::string> PriorityRouteBuilder::order(const Graph& g,
                                                     const std::vector<std::string>& homeIds,
                                                     std::time_t now) const {
    Scheduler sched;
    std::vector<std::string> out = homeIds;
    std::sort(out.begin(), out.end(), [&](const std::string& a, const std::string& b) {
        const Node& na = g.getNode(a);
        const Node& nb = g.getNode(b);
        double pa = sched.percentFull(na, now), pb = sched.percentFull(nb, now);
        if (pa != pb) return pa > pb;                                   // fullest first
        std::time_t da = sched.nextDue(na), db = sched.nextDue(nb);
        if (da != db) return da < db;                                   // clash: most due first
        return a < b;
    });
    return out;
}

std::unique_ptr<RouteStrategy> makeRouteStrategy(const std::string& mode) {
    if (mode == "priority") return std::unique_ptr<RouteStrategy>(new PriorityRouteBuilder());
    return nullptr;
}

// ---------------------------------------------------------------- Hazard

namespace {

// Real km of a path found by weighted Dijkstra, adding the km driven in residential and
// commercial zones to the result. Between two nodes it takes the edge the search would have
// used: the one with the lowest weighted cost.
double measureHazardPath(const Graph& g, const std::vector<std::string>& path, const ZoneFactors& f,
                         HazardResult& out) {
    double km = 0;
    for (size_t i = 0; i + 1 < path.size(); ++i) {
        const std::vector<Edge>& edges = g.neighbors(path[i]);
        const Edge* best = nullptr;
        for (size_t k = 0; k < edges.size(); ++k) {
            if (edges[k].to != path[i + 1]) continue;
            if (!best || edges[k].weight * f.of(edges[k].zone) < best->weight * f.of(best->zone)) best = &edges[k];
        }
        if (!best) continue;
        km += best->weight;
        if (best->zone == ZoneType::Residential) out.residentialKm += best->weight;
        if (best->zone == ZoneType::Commercial) out.commercialKm += best->weight;
    }
    return km;
}

}  // namespace

ZoneFactors hazardZoneFactors() {
    ZoneFactors f;
    f.industrial = 1;
    f.arterial = 1.5;     // public highway, but wide and built for heavy traffic
    f.commercial = 10;    // markets and shops: crowds on foot
    f.residential = 15;   // homes, schools: the people we most want to keep away from
    return f;
}

HazardResult dispatchHazard(const Graph& g, const std::string& locationId) {
    HazardResult out;
    const ZoneFactors risk = hazardZoneFactors();

    std::vector<std::string> depots = g.nodeIdsByType(NodeType::Depot);
    if (depots.empty()) {
        out.error = "no_depot";
        out.message = "The city has no depot";
        return out;
    }

    // Prefer a disposal site whose type matches this location's waste (medical / chemical).
    std::string wanted = classifyWaste(g.getNode(locationId).wasteDescription).disposalType;
    std::vector<std::string> disposalSites = g.nodeIdsByType(NodeType::DisposalSite);

    PathResult toLocation = weightedShortestPath(g, depots[0], locationId, risk);
    if (toLocation.cost < 0) {
        out.error = "no_hazard_route";
        out.message = "No road connects the depot to " + locationId;
        return out;
    }

    ShortestPathTree fromLocation = weightedShortestPathTree(g, locationId, risk);
    std::string bestSite;
    double bestCost = -1;
    for (int pass = 0; pass < 2 && bestSite.empty(); ++pass) {
        for (size_t i = 0; i < disposalSites.size(); ++i) {
            const std::string& bt = g.getNode(disposalSites[i]).disposalType;
            if (!isHazardousDisposalType(bt)) continue;
            if (pass == 0 && bt != wanted) continue;
            double cost = fromLocation.costTo(disposalSites[i]);
            if (cost >= 0 && (bestCost < 0 || cost < bestCost)) {
                bestCost = cost;
                bestSite = disposalSites[i];
            }
        }
    }
    if (bestSite.empty()) {
        out.error = "no_hazard_route";
        out.message = "No road connects " + locationId + " to a hazardous-waste disposal site";
        return out;
    }

    PathResult toSite = fromLocation.pathTo(bestSite);
    out.riskCost = toLocation.cost + toSite.cost;
    toLocation.cost = measureHazardPath(g, toLocation.path, risk, out);
    toSite.cost = measureHazardPath(g, toSite.path, risk, out);
    appendSegment(out.segments, out.totalCost, depots[0] + "->" + locationId, toLocation);
    appendSegment(out.segments, out.totalCost, locationId + "->" + bestSite, toSite);
    out.disposalSiteId = bestSite;
    out.ok = true;
    return out;
}

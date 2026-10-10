#include "router.hpp"

#include <algorithm>
#include <set>

#include "dijkstra.hpp"
#include "scheduler.hpp"
#include "waste_classifier.hpp"

namespace {

bool isHazardousBinType(const std::string& t) { return t == "medical" || t == "chemical"; }

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

std::string RouteStrategy::nearestBin(const Graph& g, const std::string& from,
                                      const std::string& binType) {
    std::vector<std::string> bins = g.nodeIdsByType(NodeType::Bin);
    // pass 0: bins of the wanted type, pass 1: general bins, pass 2: any non-hazardous bin
    for (int pass = 0; pass < 3; ++pass) {
        std::string best;
        double bestCost = -1;
        for (size_t i = 0; i < bins.size(); ++i) {
            const std::string& bt = g.getNode(bins[i]).binType;
            if (isHazardousBinType(bt)) continue;
            if (pass == 0 && bt != binType) continue;
            if (pass == 1 && bt != "general") continue;
            PathResult p = shortestPath(g, from, bins[i]);
            if (p.cost >= 0 && (bestCost < 0 || p.cost < bestCost)) {
                bestCost = p.cost;
                best = bins[i];
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
    std::vector<std::string> binTypes;  // distinct bin types needed, in pickup order
    std::set<std::string> done;  // homes already emptied (including en route)
    auto noteBinType = [&](const std::string& home) {
        std::string bt = classifyWaste(g.getNode(home).wasteDescription).binType;
        if (std::find(binTypes.begin(), binTypes.end(), bt) == binTypes.end()) binTypes.push_back(bt);
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
            noteBinType(mid);
        }
        done.insert(home);
        current = home;
        noteBinType(home);
    }

    // After the last pickup, unload at one bin per collected waste type.
    std::set<std::string> visited;
    for (size_t i = 0; i < binTypes.size(); ++i) {
        std::string bin = nearestBin(g, current, binTypes[i]);
        if (bin.empty() || visited.count(bin)) continue;
        if (addLeg(g, r, current, bin, current + "->" + bin)) {
            visited.insert(bin);
            current = bin;
        } else {
            r.unreachable.push_back(bin);
        }
    }
    return r;
}

// ---------------------------------------------------------------- Priority / FIFO

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
        if (da != db) return da < db;                                   // tie: due first (FIFO)
        return a < b;
    });
    return out;
}

std::vector<std::string> FIFORouteBuilder::order(const Graph& g,
                                                 const std::vector<std::string>& homeIds,
                                                 std::time_t) const {
    Scheduler sched;
    std::vector<std::string> out = homeIds;
    std::sort(out.begin(), out.end(), [&](const std::string& a, const std::string& b) {
        std::time_t da = sched.nextDue(g.getNode(a)), db = sched.nextDue(g.getNode(b));
        if (da != db) return da < db;  // became due earlier -> served earlier
        return a < b;
    });
    return out;
}

std::unique_ptr<RouteStrategy> makeRouteStrategy(const std::string& mode) {
    if (mode == "priority") return std::unique_ptr<RouteStrategy>(new PriorityRouteBuilder());
    if (mode == "fifo") return std::unique_ptr<RouteStrategy>(new FIFORouteBuilder());
    return nullptr;
}

// ---------------------------------------------------------------- Hazard

HazardResult dispatchHazard(const Graph& g, const std::string& locationId) {
    HazardResult out;
    std::set<ZoneType> forbidden;
    forbidden.insert(ZoneType::Residential);
    forbidden.insert(ZoneType::Commercial);

    std::vector<std::string> depots = g.nodeIdsByType(NodeType::Depot);
    if (depots.empty()) {
        out.error = "no_depot";
        out.message = "The city has no depot";
        return out;
    }

    // Prefer a bin whose type matches this location's waste (medical / chemical).
    std::string wanted = classifyWaste(g.getNode(locationId).wasteDescription).binType;
    std::vector<std::string> bins = g.nodeIdsByType(NodeType::Bin);

    PathResult toLocation = constrainedShortestPath(g, depots[0], locationId, forbidden);
    if (toLocation.cost < 0) {
        out.error = "no_hazard_route";
        out.message = "No path avoiding residential/commercial zones exists from the depot to " + locationId;
        return out;
    }

    std::string bestBin;
    PathResult best;
    best.cost = -1;
    for (int pass = 0; pass < 2 && bestBin.empty(); ++pass) {
        for (size_t i = 0; i < bins.size(); ++i) {
            const std::string& bt = g.getNode(bins[i]).binType;
            if (!isHazardousBinType(bt)) continue;
            if (pass == 0 && bt != wanted) continue;
            PathResult p = constrainedShortestPath(g, locationId, bins[i], forbidden);
            if (p.cost >= 0 && (best.cost < 0 || p.cost < best.cost)) {
                best = p;
                bestBin = bins[i];
            }
        }
    }
    if (bestBin.empty()) {
        out.error = "no_hazard_route";
        out.message = "No path avoiding residential/commercial zones exists from " + locationId +
                      " to a hazardous-waste bin";
        return out;
    }

    appendSegment(out.segments, out.totalCost, depots[0] + "->" + locationId, toLocation);
    appendSegment(out.segments, out.totalCost, locationId + "->" + bestBin, best);
    out.binId = bestBin;
    out.ok = true;
    return out;
}

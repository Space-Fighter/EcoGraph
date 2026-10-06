#include "router.hpp"

#include <queue>
#include <set>
#include <utility>

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
    const char* preference[2] = {nullptr, "general"};
    for (int pass = 0; pass < 3; ++pass) {
        std::string best;
        double bestCost = -1;
        for (size_t i = 0; i < bins.size(); ++i) {
            const std::string& bt = g.getNode(bins[i]).binType;
            if (isHazardousBinType(bt)) continue;
            if (pass == 0 && bt != binType) continue;
            if (pass == 1 && bt != preference[1]) continue;
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

// ---------------------------------------------------------------- Priority

RouteResult PriorityRouteBuilder::buildRoute(const Graph& g, const std::vector<std::string>& homeIds,
                                             std::time_t now) const {
    RouteResult r;
    r.mode = mode();
    std::vector<std::string> safe;
    splitHazardous(g, homeIds, safe, r.skippedHazardous);

    // Max-heap: most overdue home comes out first.
    Scheduler sched;
    std::priority_queue<std::pair<double, std::string> > heap;
    for (size_t i = 0; i < safe.size(); ++i) {
        heap.push(std::make_pair(sched.overdueByDays(g.getNode(safe[i]), now), safe[i]));
    }

    std::string current = depotId(g);
    while (!heap.empty()) {
        std::string home = heap.top().second;
        heap.pop();
        if (!addLeg(g, r, current, home, current + "->" + home)) {
            r.unreachable.push_back(home);
            continue;
        }
        current = home;
        std::string bin = nearestBin(g, current, classifyWaste(g.getNode(home).wasteDescription).binType);
        if (bin.empty() || !addLeg(g, r, current, bin, current + "->" + bin)) {
            if (!bin.empty()) r.unreachable.push_back(bin);
            continue;
        }
        current = bin;
    }
    return r;
}

// ---------------------------------------------------------------- FIFO

RouteResult FIFORouteBuilder::buildRoute(const Graph& g, const std::vector<std::string>& homeIds,
                                         std::time_t) const {
    RouteResult r;
    r.mode = mode();
    std::vector<std::string> safe;
    splitHazardous(g, homeIds, safe, r.skippedHazardous);

    std::queue<std::string> pending;
    for (size_t i = 0; i < safe.size(); ++i) pending.push(safe[i]);

    std::string current = depotId(g);
    std::vector<std::string> binTypes;  // distinct bin types needed, in pickup order
    while (!pending.empty()) {
        std::string home = pending.front();
        pending.pop();
        if (!addLeg(g, r, current, home, current + "->" + home)) {
            r.unreachable.push_back(home);
            continue;
        }
        current = home;
        std::string bt = classifyWaste(g.getNode(home).wasteDescription).binType;
        bool seen = false;
        for (size_t i = 0; i < binTypes.size(); ++i) seen = seen || binTypes[i] == bt;
        if (!seen) binTypes.push_back(bt);
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

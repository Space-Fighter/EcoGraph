#include "simulation.hpp"

#include <algorithm>

#include "dijkstra.hpp"
#include "waste_classifier.hpp"

namespace {
const size_t MAX_LOG = 2000;

bool contains(const std::vector<std::string>& v, const std::string& s) {
    return std::find(v.begin(), v.end(), s) != v.end();
}
}  // namespace

std::string formatDate(std::time_t t) {
    char buf[16];
    std::tm* tm = std::localtime(&t);
    std::strftime(buf, sizeof(buf), "%Y-%m-%d", tm);
    return buf;
}

void Simulation::start(std::time_t base) {
    base_ = base;
    day_ = 0;
    log_.clear();
    summary_.clear();
    pending_.clear();
}

void Simulation::collect(Graph& g, const Scheduler& sched, const std::string& id,
                         const std::string& action, const std::string& truck) {
    const Node& n = g.getNode(id);
    LogEntry e;
    e.day = day_;
    e.time = now();
    e.id = id;
    e.type = n.type;
    e.action = action;
    e.truck = truck;
    e.overdueByDays = sched.overdueByDays(n, now());
    e.percentFull = sched.percentFull(n, now());
    log_.push_back(e);
    if (log_.size() > MAX_LOG) log_.erase(log_.begin(), log_.begin() + (log_.size() - MAX_LOG));
    sched.markCollected(g, id, now());
}

DayReport Simulation::playDay(Graph& g, const Scheduler& sched, bool autoCollect,
                              const RouteStrategy& strategy, const Fleet& fleet, bool live) {
    ++day_;
    DayReport rep;
    rep.day = day_;
    rep.time = now();

    std::vector<DueLocation> due = sched.getDueLocations(g, now());
    for (size_t i = 0; i < due.size(); ++i) rep.due.push_back(due[i].id);

    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        if (n.type == NodeType::Home && sched.percentFull(n, now()) > 100.0) {
            rep.overflowIds.push_back(n.id);
        }
    }
    if (!autoCollect) return rep;

    auto pickUp = [&](const std::string& id, const std::string& action, const std::string& truck) {
        if (live) pending_.push_back(PendingPickup{id, action, truck});
        else collect(g, sched, id, action, truck);
    };

    // Both kinds of truck go by how full a home is.
    std::vector<std::string> normalHomes, hazardHomes;
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        if (n.type != NodeType::Home) continue;
        if (sched.fillLevel(n, now()) <= 0) continue;
        if (classifyWaste(n.wasteDescription).hazardous) hazardHomes.push_back(n.id);
        else normalHomes.push_back(n.id);
    }

    // Homes no road reaches from the depot fail now, before they take up truck capacity.
    std::vector<std::string> depots = g.nodeIdsByType(NodeType::Depot);
    ShortestPathTree fromDepot = shortestPathTree(g, depots.empty() ? std::string() : depots[0]);
    std::vector<std::string> reachable;
    for (size_t i = 0; i < normalHomes.size(); ++i) {
        if (fromDepot.costTo(normalHomes[i]) < 0) rep.failed.push_back(normalHomes[i]);
        else reachable.push_back(normalHomes[i]);
    }

    // ---- Normal trucks: each takes turns running a trip, filled in strategy order. A trip's first
    // home always fits (even one bigger than the truck); otherwise load must fit. A trip only
    // goes ahead if the truck can finish it and still reach the depot within its km limit.
    std::vector<std::string> pool = strategy.order(g, reachable, now());
    std::vector<TruckRun> trucks;
    std::vector<std::string> truckAt;
    std::vector<bool> finished;
    for (int t = 0; t < fleet.normalTrucks; ++t) {
        TruckRun run;
        run.id = "N" + std::to_string(t + 1);
        run.kind = "normal";
        run.capacity = fleet.normalCapacity;
        trucks.push_back(run);
        truckAt.push_back(depots.empty() ? std::string() : depots[0]);
        finished.push_back(false);
    }
    const std::string depot = depots.empty() ? std::string() : depots[0];
    bool anyTrip = true;
    while (anyTrip && !pool.empty()) {
        anyTrip = false;
        for (size_t t = 0; t < trucks.size() && !pool.empty(); ++t) {
            if (finished[t]) continue;
            std::vector<std::string> trip;
            double tripLoad = 0;
            for (size_t i = 0; i < pool.size(); ++i) {
                double load = sched.fillLevel(g.getNode(pool[i]), now());
                if (trip.empty() || tripLoad + load <= fleet.normalCapacity) {
                    trip.push_back(pool[i]);
                    tripLoad += load;
                }
            }
            // Drop the emptiest homes until the trip fits in what is left of the truck's km.
            RouteResult route;
            while (!trip.empty()) {
                route = strategy.buildRoute(g, trip, now(), truckAt[t]);
                const std::string end = route.segments.empty() || route.segments.back().path.empty()
                                            ? truckAt[t]
                                            : route.segments.back().path.back();
                double back = shortestPath(g, end, depot).cost;
                if (back >= 0 && trucks[t].cost + route.totalCost + back <= fleet.normalKmLimit) break;
                tripLoad -= sched.fillLevel(g.getNode(trip.back()), now());
                trip.pop_back();
            }
            if (trip.empty()) {
                finished[t] = true;
                continue;
            }
            anyTrip = true;
            double served = 0;
            for (size_t i = 0; i < trip.size(); ++i) {
                const std::string& id = trip[i];
                pool.erase(std::remove(pool.begin(), pool.end(), id), pool.end());
                if (contains(route.unreachable, id)) {
                    rep.failed.push_back(id);
                } else {
                    served += sched.fillLevel(g.getNode(id), now());
                    trucks[t].homes.push_back(id);
                    pickUp(id, "route", trucks[t].id);
                }
            }
            trucks[t].segments.insert(trucks[t].segments.end(), route.segments.begin(), route.segments.end());
            trucks[t].cost += route.totalCost;
            trucks[t].load += served;
            trucks[t].tripLoads.push_back(served);
            ++trucks[t].trips;
            if (!route.segments.empty() && !route.segments.back().path.empty()) truckAt[t] = route.segments.back().path.back();
        }
    }
    // Only a home that is due counts as waiting. The rest simply were not needed today.
    for (size_t i = 0; i < pool.size(); ++i) {
        if (sched.isDue(g.getNode(pool[i]), now())) rep.carriedOver.push_back(pool[i]);
    }
    for (size_t t = 0; t < trucks.size(); ++t) {
        if (trucks[t].trips == 0) continue;
        RouteResult home;
        home.segments = trucks[t].segments;
        RouteStrategy::returnToDepot(g, home);
        trucks[t].segments = home.segments;
        trucks[t].cost += home.totalCost;
        rep.totalCost += trucks[t].cost;
        rep.trucks.push_back(trucks[t]);
    }

    // ---- Hazard trucks: the same order; one trip per truck per day.
    std::vector<std::string> hazardOrder = strategy.order(g, hazardHomes, now());
    int usedHazard = 0;
    for (size_t i = 0; i < hazardOrder.size(); ++i) {
        const std::string& id = hazardOrder[i];
        if (usedHazard >= fleet.hazardTrucks) {
            if (sched.isDue(g.getNode(id), now())) rep.carriedOver.push_back(id);
            continue;
        }
        HazardResult h = dispatchHazard(g, id);
        if (!h.ok) {
            rep.failed.push_back(id);
            continue;
        }
        TruckRun run;
        run.id = "HT" + std::to_string(++usedHazard);
        run.kind = "hazard";
        run.homes.push_back(id);
        run.load = sched.fillLevel(g.getNode(id), now());
        run.cost = h.totalCost;
        run.disposalSite = h.disposalSiteId;
        run.exposureKm = h.residentialKm + h.commercialKm;
        run.segments = h.segments;
        pickUp(id, "hazard", run.id);
        rep.totalCost += run.cost;
        rep.trucks.push_back(run);
    }

    // The most due home heads the waiting list.
    std::sort(rep.carriedOver.begin(), rep.carriedOver.end(), [&](const std::string& a, const std::string& b) {
        double da = sched.overdueByDays(g.getNode(a), now()), db = sched.overdueByDays(g.getNode(b), now());
        if (da != db) return da > db;
        return a < b;
    });
    return rep;
}

DayReport Simulation::advanceDay(Graph& g, const Scheduler& sched, bool autoCollect,
                                 const RouteStrategy& strategy, const Fleet& fleet, bool live) {
    settle(g, sched);  // anything left from an unfinished live day happened on that day
    DayReport rep = playDay(g, sched, autoCollect, strategy, fleet, live);

    DaySummary s;
    s.day = rep.day;
    s.time = rep.time;
    s.overflowMorning = static_cast<int>(rep.overflowIds.size());
    s.overflowAfterPickups = 0;
    s.served = 0;
    if (!live) {
        for (size_t t = 0; t < rep.trucks.size(); ++t) s.served += static_cast<int>(rep.trucks[t].homes.size());
    }
    s.totalCost = rep.totalCost;
    summary_.push_back(s);
    updateAfterPickups(g, sched);
    return rep;
}

bool Simulation::arrive(Graph& g, const Scheduler& sched, const std::string& id) {
    for (size_t i = 0; i < pending_.size(); ++i) {
        if (pending_[i].id != id) continue;
        PendingPickup p = pending_[i];
        pending_.erase(pending_.begin() + static_cast<std::ptrdiff_t>(i));
        if (!g.hasNode(id)) return false;  // removed from the city since the day started
        collect(g, sched, id, p.action, p.truck);
        if (!summary_.empty()) ++summary_.back().served;
        updateAfterPickups(g, sched);
        return true;
    }
    return false;
}

void Simulation::settle(Graph& g, const Scheduler& sched) {
    while (!pending_.empty()) {
        const std::string id = pending_.front().id;
        arrive(g, sched, id);
    }
}

void Simulation::updateAfterPickups(const Graph& g, const Scheduler& sched) {
    if (summary_.empty()) return;
    int count = 0;
    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        if (n.type == NodeType::Home && sched.percentFull(n, now()) > 100.0) ++count;
    }
    summary_.back().overflowAfterPickups = count;
}

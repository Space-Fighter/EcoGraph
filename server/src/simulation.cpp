#include "simulation.hpp"

#include <algorithm>

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

DayReport Simulation::advanceDay(Graph& g, const Scheduler& sched, bool autoCollect,
                                 const RouteStrategy& strategy, const Fleet& fleet) {
    ++day_;
    DayReport rep;
    rep.day = day_;
    rep.time = now();

    std::vector<DueLocation> due = sched.getDueLocations(g, now());
    for (size_t i = 0; i < due.size(); ++i) rep.due.push_back(due[i].id);

    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        if ((n.type == NodeType::Home || n.type == NodeType::Bin) && sched.percentFull(n, now()) > 100.0) {
            rep.overflowIds.push_back(n.id);
        }
    }
    if (!autoCollect) return rep;

    std::vector<std::string> normalHomes, hazardHomes, dueBins;
    for (size_t i = 0; i < due.size(); ++i) {
        const DueLocation& d = due[i];
        if (d.type == NodeType::Bin) {
            dueBins.push_back(d.id);
        } else if (classifyWaste(g.getNode(d.id).wasteDescription).hazardous) {
            hazardHomes.push_back(d.id);
        } else {
            normalHomes.push_back(d.id);
        }
    }

    // ---- Normal trucks: first-fit in strategy order. A truck always takes at least one
    // home (even an overflowing one bigger than its capacity); otherwise load must fit.
    std::vector<std::string> ordered = strategy.order(g, normalHomes, now());
    std::vector<TruckRun> trucks;
    for (int t = 0; t < fleet.normalTrucks; ++t) {
        TruckRun run;
        run.id = "N" + std::to_string(t + 1);
        run.kind = "normal";
        run.capacity = fleet.normalCapacity;
        trucks.push_back(run);
    }
    for (size_t i = 0; i < ordered.size(); ++i) {
        double load = sched.fillLevel(g.getNode(ordered[i]), now());
        bool placed = false;
        for (size_t t = 0; t < trucks.size() && !placed; ++t) {
            if (trucks[t].homes.empty() || trucks[t].load + load <= trucks[t].capacity) {
                trucks[t].homes.push_back(ordered[i]);
                trucks[t].load += load;
                placed = true;
            }
        }
        if (!placed) rep.carriedOver.push_back(ordered[i]);
    }
    for (size_t t = 0; t < trucks.size(); ++t) {
        if (trucks[t].homes.empty()) continue;
        RouteResult r = strategy.buildRoute(g, trucks[t].homes, now());
        trucks[t].segments = r.segments;
        trucks[t].cost = r.totalCost;
        std::vector<std::string> served;
        for (size_t i = 0; i < trucks[t].homes.size(); ++i) {
            const std::string& id = trucks[t].homes[i];
            if (contains(r.unreachable, id)) {
                rep.failed.push_back(id);
            } else {
                served.push_back(id);
                collect(g, sched, id, "route", trucks[t].id);
            }
        }
        trucks[t].homes = served;
        rep.totalCost += trucks[t].cost;
        rep.trucks.push_back(trucks[t]);
    }

    // ---- Hazard trucks: first due, first served; one trip per truck per day.
    std::vector<std::string> hazardOrder = FIFORouteBuilder().order(g, hazardHomes, now());
    int usedHazard = 0;
    for (size_t i = 0; i < hazardOrder.size(); ++i) {
        const std::string& id = hazardOrder[i];
        if (usedHazard >= fleet.hazardTrucks) {
            rep.carriedOver.push_back(id);
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
        run.bin = h.binId;
        run.segments = h.segments;
        collect(g, sched, id, "hazard", run.id);
        rep.totalCost += run.cost;
        rep.trucks.push_back(run);
    }

    // ---- Bins are emptied when due (no truck needed).
    for (size_t i = 0; i < dueBins.size(); ++i) {
        rep.emptiedBins.push_back(dueBins[i]);
        collect(g, sched, dueBins[i], "emptied");
    }
    return rep;
}

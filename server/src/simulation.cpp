#include "simulation.hpp"

#include <algorithm>

#include "waste_classifier.hpp"

namespace {
const size_t MAX_LOG = 2000;
}

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
                         const std::string& action) {
    const Node& n = g.getNode(id);
    LogEntry e;
    e.day = day_;
    e.time = now();
    e.id = id;
    e.type = n.type;
    e.action = action;
    e.overdueByDays = sched.overdueByDays(n, now());
    e.percentFull = sched.percentFull(n, now());
    log_.push_back(e);
    if (log_.size() > MAX_LOG) log_.erase(log_.begin(), log_.begin() + (log_.size() - MAX_LOG));
    sched.markCollected(g, id, now());
}

DayReport Simulation::advanceDay(Graph& g, const Scheduler& sched, bool autoCollect) {
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
            ++rep.overflowCount;
        }
    }
    if (!autoCollect) return rep;

    std::vector<std::string> dueHomes, dueBins;
    for (size_t i = 0; i < due.size(); ++i) {
        (due[i].type == NodeType::Home ? dueHomes : dueBins).push_back(due[i].id);
    }

    if (!dueHomes.empty()) {
        RouteResult r = PriorityRouteBuilder().buildRoute(g, dueHomes, now());
        rep.segments = r.segments;
        rep.routeCost = r.totalCost;
        for (size_t i = 0; i < dueHomes.size(); ++i) {
            const std::string& id = dueHomes[i];
            bool hazardous = std::find(r.skippedHazardous.begin(), r.skippedHazardous.end(), id) !=
                             r.skippedHazardous.end();
            bool unreachable = std::find(r.unreachable.begin(), r.unreachable.end(), id) !=
                               r.unreachable.end();
            if (unreachable) {
                rep.failed.push_back(id);
            } else if (hazardous) {
                HazardResult h = dispatchHazard(g, id);
                if (h.ok) {
                    rep.hazardSegments.insert(rep.hazardSegments.end(), h.segments.begin(), h.segments.end());
                    rep.hazardCost += h.totalCost;
                    rep.hazardCollected.push_back(id);
                    collect(g, sched, id, "hazard");
                } else {
                    rep.failed.push_back(id);
                }
            } else {
                rep.collected.push_back(id);
                collect(g, sched, id, "route");
            }
        }
    }
    for (size_t i = 0; i < dueBins.size(); ++i) {
        rep.emptiedBins.push_back(dueBins[i]);
        collect(g, sched, dueBins[i], "emptied");
    }
    return rep;
}

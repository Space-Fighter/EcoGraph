#include "scheduler.hpp"

#include <algorithm>
#include <queue>
#include <utility>

namespace {
const double SECONDS_PER_DAY = 86400.0;
const double MIN_INTERVAL_DAYS = 1.0;
const double MAX_INTERVAL_DAYS = 14.0;
}  // namespace

double Scheduler::computeInterval(const Node& n) const {
    if (n.fillRate <= 0) return MAX_INTERVAL_DAYS;
    double days = n.capacity / n.fillRate;
    return std::max(MIN_INTERVAL_DAYS, std::min(MAX_INTERVAL_DAYS, days));
}

double Scheduler::overdueByDays(const Node& n, std::time_t now) const {
    double elapsedDays = static_cast<double>(now - n.lastCollected) / SECONDS_PER_DAY;
    return elapsedDays - computeInterval(n);
}

bool Scheduler::isDue(const Node& n, std::time_t now) const {
    return overdueByDays(n, now) >= 0;
}

std::vector<DueLocation> Scheduler::getDueLocations(const Graph& g, std::time_t now) const {
    typedef std::pair<double, std::string> Entry;
    std::priority_queue<Entry> heap;  // max-heap on overdue-ness

    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        if (n.type != NodeType::Home && n.type != NodeType::Bin) continue;
        if (isDue(n, now)) heap.push(Entry(overdueByDays(n, now), n.id));
    }

    std::vector<DueLocation> out;
    while (!heap.empty()) {
        Entry e = heap.top();
        heap.pop();
        out.push_back(DueLocation{e.second, g.getNode(e.second).type, e.first});
    }
    return out;
}

void Scheduler::markCollected(Graph& g, const std::string& nodeId, std::time_t now) const {
    g.getNodeMutable(nodeId).lastCollected = now;
}

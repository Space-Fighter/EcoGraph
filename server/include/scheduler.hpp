#ifndef SCHEDULER_HPP
#define SCHEDULER_HPP

#include <ctime>
#include <string>
#include <vector>

#include "graph.hpp"

struct DueLocation {
    std::string id;
    NodeType type;
    double overdueByDays;
};

// Fill-rate-adaptive scheduling: a home/bin is visited every capacity/fillRate days
// (clamped to [1, 14]) instead of on a fixed calendar.
class Scheduler {
public:
    double computeInterval(const Node& n) const;  // days
    double overdueByDays(const Node& n, std::time_t now) const;  // negative = not yet due
    bool isDue(const Node& n, std::time_t now) const;

    double daysSinceCollected(const Node& n, std::time_t now) const;
    double fillLevel(const Node& n, std::time_t now) const;    // units, can exceed capacity
    double percentFull(const Node& n, std::time_t now) const;  // >100 means overflowing
    std::time_t nextDue(const Node& n) const;                  // lastCollected + interval

    // Due homes/bins, most overdue first (max-heap order).
    std::vector<DueLocation> getDueLocations(const Graph& g, std::time_t now) const;

    void markCollected(Graph& g, const std::string& nodeId, std::time_t now) const;
};

#endif

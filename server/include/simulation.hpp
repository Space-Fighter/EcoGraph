#ifndef SIMULATION_HPP
#define SIMULATION_HPP

#include <ctime>
#include <string>
#include <vector>

#include "graph.hpp"
#include "router.hpp"
#include "scheduler.hpp"

std::string formatDate(std::time_t t);  // YYYY-MM-DD

struct LogEntry {
    int day;
    std::time_t time;
    std::string id;
    NodeType type;
    std::string action;  // route | hazard | emptied | manual
    double overdueByDays;
    double percentFull;
};

struct DayReport {
    int day = 0;
    std::time_t time = 0;
    std::vector<std::string> due;            // everything that was due this morning
    int overflowCount = 0;                   // homes/bins past 100% full this morning
    std::vector<std::string> collected;      // homes picked up on the normal route
    std::vector<std::string> hazardCollected;
    std::vector<std::string> emptiedBins;
    std::vector<std::string> failed;         // due but could not be reached
    std::vector<RouteSegment> segments;      // normal route
    std::vector<RouteSegment> hazardSegments;
    double routeCost = 0;
    double hazardCost = 0;
};

// A simulated calendar on top of the graph. Day 0 is "now" at startup; each advanced day
// moves the clock by 24h, so fill levels grow and locations become due. With autoCollect
// the day also plays out: due homes are routed (Priority), hazardous ones dispatched on
// restricted routes, and due bins emptied.
class Simulation {
public:
    void start(std::time_t base);
    int day() const { return day_; }
    std::time_t startTime() const { return base_; }
    std::time_t now() const { return base_ + static_cast<std::time_t>(day_) * 86400; }

    DayReport advanceDay(Graph& g, const Scheduler& sched, bool autoCollect);
    // Marks one location collected "now" and records it in the log.
    void collect(Graph& g, const Scheduler& sched, const std::string& id, const std::string& action);

    const std::vector<LogEntry>& log() const { return log_; }

private:
    std::time_t base_ = 0;
    int day_ = 0;
    std::vector<LogEntry> log_;
};

#endif

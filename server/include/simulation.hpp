#ifndef SIMULATION_HPP
#define SIMULATION_HPP

#include <ctime>
#include <map>
#include <string>
#include <vector>

#include "graph.hpp"
#include "router.hpp"
#include "scheduler.hpp"

std::string formatDate(std::time_t t);  // YYYY-MM-DD

// Limited trucks. Normal trucks do one route per day carrying up to normalCapacity units
// (a home's load is its current fill level). Hazard trucks are a separate pool and each
// makes one hazard trip per day.
struct Fleet {
    int normalTrucks = 3;
    double normalCapacity = 1000;  // kg per truck per day
    int hazardTrucks = 2;
};

struct LogEntry {
    int day;
    std::time_t time;
    std::string id;
    NodeType type;
    std::string action;  // route | hazard | manual
    std::string truck;   // N1, N2, HT1... ("" for manual)
    double overdueByDays;
    double percentFull;
};

// One line of the day-by-day summary shown at the top of the database view.
struct DaySummary {
    int day;
    std::time_t time;
    int overflowMorning;       // homes past 100% full when the day starts
    int overflowAfterPickups;  // the same count now, updated as each pickup happens
    int served;            // homes emptied by trucks today
    double totalCost;      // km driven today
};

struct TruckRun {
    std::string id;     // N1.. for normal, HT1.. for hazard trucks
    std::string kind;   // "normal" | "hazard"
    std::vector<std::string> homes;
    double load = 0;
    double capacity = 0;  // 0 for hazard trucks (one trip, no load limit)
    double cost = 0;
    std::string disposalSite;      // hazard trips: the disposal site they delivered to
    double exposureKm = 0;  // hazard trips: km driven on residential/commercial roads
    std::vector<RouteSegment> segments;
};

struct DayReport {
    int day = 0;
    std::time_t time = 0;
    std::vector<std::string> due;            // everything due this morning
    std::vector<std::string> overflowIds;    // homes already past 100% full this morning
    std::vector<TruckRun> trucks;            // trucks that went out
    std::vector<std::string> carriedOver;    // due but no truck/capacity left: waits for tomorrow
    std::vector<std::string> failed;         // due but unreachable
    double totalCost = 0;
};

// A simulated calendar on top of the graph. Day 0 is "now" at startup; each advanced day
// moves the clock by 24h, so fill levels grow and locations become due. With autoCollect
// the day also plays out under the fleet limits:
//   - homes at least MIN_PICKUP_PERCENT full are ordered most full first (a clash goes to the
//     most due) and loaded onto normal trucks until capacity runs out; the rest carry over;
//   - hazardous homes get hazard trucks automatically in the same order, extras wait.
// Disposal sites only receive waste: they have no fill level and are never due.
// In a live day the trucks' pickups wait until each truck is reported as arriving, so every view
// of the city shows what has really happened so far. Otherwise they all happen at once.
class Simulation {
public:
    // A home this full can be collected. Anything emptier is not worth a truck yet.
    static constexpr double MIN_PICKUP_PERCENT = 80.0;

    void start(std::time_t base);
    int day() const { return day_; }
    std::time_t startTime() const { return base_; }
    std::time_t now() const { return base_ + static_cast<std::time_t>(day_) * 86400; }

    DayReport advanceDay(Graph& g, const Scheduler& sched, bool autoCollect,
                         const RouteStrategy& strategy, const Fleet& fleet, bool live = false);
    // A truck reached this location in a live day. False if no pickup was waiting there.
    bool arrive(Graph& g, const Scheduler& sched, const std::string& id);
    // Finishes every pickup still waiting from a live day.
    void settle(Graph& g, const Scheduler& sched);
    // Marks one location collected "now" and records it in the log.
    void collect(Graph& g, const Scheduler& sched, const std::string& id, const std::string& action,
                 const std::string& truck = "");

    const std::vector<LogEntry>& log() const { return log_; }
    const std::vector<DaySummary>& summary() const { return summary_; }

private:
    struct PendingPickup {
        std::string id;
        std::string action;
        std::string truck;
    };

    DayReport playDay(Graph& g, const Scheduler& sched, bool autoCollect,
                      const RouteStrategy& strategy, const Fleet& fleet, bool live);
    void updateAfterPickups(const Graph& g, const Scheduler& sched);

    std::time_t base_ = 0;
    int day_ = 0;
    std::vector<LogEntry> log_;
    std::vector<DaySummary> summary_;
    std::vector<PendingPickup> pending_;
};

#endif

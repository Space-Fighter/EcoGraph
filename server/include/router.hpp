#ifndef ROUTER_HPP
#define ROUTER_HPP

#include <ctime>
#include <memory>
#include <string>
#include <vector>

#include "graph.hpp"

struct RouteSegment {
    std::string label;
    std::vector<std::string> path;
    double cost;
};

struct RouteResult {
    std::string mode;
    std::vector<RouteSegment> segments;
    double totalCost = 0;
    std::vector<std::string> skippedHazardous;  // homes pulled out for hazard dispatch
    std::vector<std::string> unreachable;       // homes/bins that could not be reached
    std::vector<std::string> collectedEnRoute;  // later stops emptied while passing through
};

// Both modes work on locations that are due (the fill-rate schedule decides *when*);
// a strategy only decides the *order* in which a truck serves them (Polymorphism).
// buildRoute() is shared (Inheritance): split off hazardous homes, order the rest,
// drive depot -> homes in that order, then unload at the nearest suitable bins.
class RouteStrategy {
public:
    virtual ~RouteStrategy() {}
    virtual std::string mode() const = 0;
    // Visiting order for the given homes. Must be deterministic.
    virtual std::vector<std::string> order(const Graph& g, const std::vector<std::string>& homeIds,
                                           std::time_t now) const = 0;

    RouteResult buildRoute(const Graph& g, const std::vector<std::string>& homeIds,
                           std::time_t now) const;

protected:
    // Splits homeIds into safe homes and hazardous ones using classifyWaste().
    static void splitHazardous(const Graph& g, const std::vector<std::string>& homeIds,
                               std::vector<std::string>& safe, std::vector<std::string>& hazardous);
    // Appends a shortest-path leg from -> to; returns false if unreachable.
    static bool addLeg(const Graph& g, RouteResult& r, const std::string& from,
                       const std::string& to, const std::string& label);
    // Nearest non-hazardous bin accepting this bin type (falls back to general, then any).
    static std::string nearestBin(const Graph& g, const std::string& from, const std::string& binType);
    static std::string depotId(const Graph& g);
};

// Most urgent first: highest % full (closest to / past overflowing). Ties go to the
// location that became due first (FIFO), then by id.
class PriorityRouteBuilder : public RouteStrategy {
public:
    std::string mode() const override { return "priority"; }
    std::vector<std::string> order(const Graph& g, const std::vector<std::string>& homeIds,
                                   std::time_t now) const override;
};

// First come, first served: the location that became due first goes first, then by id.
class FIFORouteBuilder : public RouteStrategy {
public:
    std::string mode() const override { return "fifo"; }
    std::vector<std::string> order(const Graph& g, const std::vector<std::string>& homeIds,
                                   std::time_t now) const override;
};

// Returns nullptr for an unknown mode.
std::unique_ptr<RouteStrategy> makeRouteStrategy(const std::string& mode);

struct HazardResult {
    bool ok = false;
    std::string error;    // machine code when !ok
    std::string message;  // human text when !ok
    std::string binId;
    std::vector<RouteSegment> segments;
    double totalCost = 0;
};

// depot -> location -> hazardous bin, never using residential or commercial edges.
HazardResult dispatchHazard(const Graph& g, const std::string& locationId);

#endif

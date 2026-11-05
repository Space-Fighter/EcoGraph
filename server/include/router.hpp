#ifndef ROUTER_HPP
#define ROUTER_HPP

#include <ctime>
#include <memory>
#include <string>
#include <vector>

#include "dijkstra.hpp"
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
    std::vector<std::string> unreachable;       // homes/disposal sites that could not be reached
    std::vector<std::string> collectedEnRoute;  // later stops emptied while passing through
};

// A strategy decides the *order* in which a truck serves its homes (Polymorphism).
// buildRoute() is shared (Inheritance): split off hazardous homes, order the rest,
// drive depot -> homes in that order, then unload at the nearest suitable disposal sites.
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
    // Nearest non-hazardous disposal site accepting this disposal site type (falls back to general, then any).
    static std::string nearestDisposalSite(const Graph& g, const std::string& from, const std::string& disposalType);
    static std::string depotId(const Graph& g);
};

// The one collection order: most full first. A clash goes to the most due (the one that became
// due earliest), then by id.
class PriorityRouteBuilder : public RouteStrategy {
public:
    std::string mode() const override { return "priority"; }
    std::vector<std::string> order(const Graph& g, const std::vector<std::string>& homeIds,
                                   std::time_t now) const override;
};

// Returns nullptr for an unknown mode. "priority" is the only one.
std::unique_ptr<RouteStrategy> makeRouteStrategy(const std::string& mode);

struct HazardResult {
    bool ok = false;
    std::string error;    // machine code when !ok
    std::string message;  // human text when !ok
    std::string disposalSiteId;
    std::vector<RouteSegment> segments;  // segment costs in km
    double totalCost = 0;                // km driven
    double riskCost = 0;                 // km weighted by hazardZoneFactors()
    double residentialKm = 0;            // km driven on residential roads (public exposure)
    double commercialKm = 0;             // km driven on commercial roads (public exposure)
};

// Risk weights for hazard trucks: industrial and arterial roads cost their length, while
// commercial and residential roads count several times over. A route through a populated
// zone is still allowed (a clinic in a market street can only be reached through it), but
// only for the part that cannot be bypassed by a reasonable industrial/arterial detour.
ZoneFactors hazardZoneFactors();

// depot -> location -> hazardous disposal site along the route with the least risk cost: it keeps to
// industrial/arterial roads where possible and minimises the km driven through residential
// and commercial zones. Fails only when the location or every hazardous disposal site is unreachable.
HazardResult dispatchHazard(const Graph& g, const std::string& locationId);

#endif

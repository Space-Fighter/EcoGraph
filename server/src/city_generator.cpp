#include "city_generator.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <stdexcept>

#include "geo.hpp"
#include "waste_classifier.hpp"

namespace {

const char* NORMAL_WASTE[] = {"kitchen food scraps",          "plastic bottles and cans",
                              "old newspaper and cardboard", "mixed household trash",
                              "glass bottles and jars",      "garden leaves and vegetable peels",
                              "plastic packaging and paper"};
const char* HAZARD_WASTE[] = {"used syringe and bandage", "surgical gauze and needles",
                              "leftover paint and solvent", "old batteries and acid",
                              "blood sample tubes",        "pesticide containers"};

double uniform(std::mt19937& rng, double lo, double hi) {
    return std::uniform_real_distribution<double>(lo, hi)(rng);
}

double roundTo(double v, double step) { return std::floor(v / step + 0.5) * step; }

template <size_t N>
std::string pick(std::mt19937& rng, const char* (&list)[N]) {
    return list[std::uniform_int_distribution<size_t>(0, N - 1)(rng)];
}

// Next unused id of the form <prefix><number>.
std::string nextId(const Graph& g, const std::string& prefix) {
    long maxSeen = 0;
    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        const std::string& id = ids[i];
        if (id.size() <= prefix.size() || id.compare(0, prefix.size(), prefix) != 0) continue;
        std::string rest = id.substr(prefix.size());
        if (!std::all_of(rest.begin(), rest.end(), [](char c) { return c >= '0' && c <= '9'; })) continue;
        maxSeen = std::max(maxSeen, std::stol(rest));
    }
    return prefix + std::to_string(maxSeen + 1);
}

const Area& pickArea(const std::vector<Area>& areas, GenKind kind, bool hazardous, std::mt19937& rng) {
    std::vector<const Area*> fit;
    for (size_t i = 0; i < areas.size(); ++i) {
        ZoneType z = areas[i].zone;
        bool ok = false;
        if (kind == GenKind::Home) ok = hazardous ? z != ZoneType::Arterial
                                                  : (z == ZoneType::Residential || z == ZoneType::Commercial);
        else if (kind == GenKind::Bin) ok = z == ZoneType::Industrial;
        else ok = true;
        if (ok) fit.push_back(&areas[i]);
    }
    if (fit.empty()) {
        for (size_t i = 0; i < areas.size(); ++i) fit.push_back(&areas[i]);
    }
    return *fit[std::uniform_int_distribution<size_t>(0, fit.size() - 1)(rng)];
}

// Existing nodes ordered by distance from (lat, lng).
std::vector<std::string> nearest(const Graph& g, double lat, double lng, const std::string& exclude) {
    std::vector<std::pair<double, std::string> > byDist;
    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        if (ids[i] == exclude) continue;
        const Node& n = g.getNode(ids[i]);
        byDist.push_back(std::make_pair(haversineKm(lat, lng, n.lat, n.lng), ids[i]));
    }
    std::sort(byDist.begin(), byDist.end());
    std::vector<std::string> out;
    for (size_t i = 0; i < byDist.size(); ++i) out.push_back(byDist[i].second);
    return out;
}

void connect(Graph& g, const std::string& a, const std::string& b, ZoneType zone) {
    const Node& na = g.getNode(a);
    const Node& nb = g.getNode(b);
    double km = std::max(0.05, haversineKm(na.lat, na.lng, nb.lat, nb.lng) * ROAD_FACTOR);
    g.addEdge(a, b, km, zone);
}

// Random time of the last collection, somewhere within the node's own collection interval.
std::time_t randomLastCollected(const Node& n, std::time_t now, std::mt19937& rng) {
    double interval = n.fillRate > 0 ? std::max(1.0, std::min(14.0, n.capacity / n.fillRate)) : 14.0;
    return now - static_cast<std::time_t>(uniform(rng, 0.0, interval) * 86400.0);
}

}  // namespace

GeneratedBatch generateNodes(Graph& g, const std::vector<Area>& areas, GenKind kind, bool hazardous,
                             int count, std::time_t now, std::mt19937& rng) {
    if (areas.empty()) throw std::invalid_argument("the city has no localities to place nodes in");

    GeneratedBatch batch;
    size_t edgesBefore = g.edges().size();

    for (int i = 0; i < count; ++i) {
        const Area& area = pickArea(areas, kind, hazardous, rng);

        // Random point inside the locality's circle (sqrt keeps the density even).
        double r = area.radiusKm * std::sqrt(uniform(rng, 0.0, 1.0));
        double theta = uniform(rng, 0.0, 6.283185307179586);
        double dLat = r * std::sin(theta) / 111.19;
        double dLng = r * std::cos(theta) / (111.19 * std::cos(area.lat * 3.14159265358979 / 180.0));

        Node n;
        n.generated = true;
        n.area = area.name;
        n.lat = area.lat + dLat;
        n.lng = area.lng + dLng;

        std::string prefix = kind == GenKind::Home ? (hazardous ? "HZ" : "H")
                             : kind == GenKind::Bin ? "B" : "J";
        n.id = nextId(g, prefix);

        if (kind == GenKind::Home) {
            n.type = NodeType::Home;
            n.zone = area.zone;
            // Whole-day collection interval (capacity = fill rate x days), so a daily schedule
            // reaches the location exactly when it is full instead of always slightly late.
            n.fillRate = hazardous ? roundTo(uniform(rng, 15, 40), 5) : roundTo(uniform(rng, 30, 90), 5);
            n.capacity = n.fillRate * (hazardous ? std::uniform_int_distribution<int>(5, 8)(rng)
                                                 : std::uniform_int_distribution<int>(3, 8)(rng));
            n.wasteDescription = hazardous ? pick(rng, HAZARD_WASTE) : pick(rng, NORMAL_WASTE);
            n.name = (hazardous ? "New hazardous site " : "New cluster ") + n.id + ", " + area.name;
        } else if (kind == GenKind::Bin) {
            n.type = NodeType::Bin;
            n.zone = ZoneType::Industrial;
            if (hazardous) {
                n.binType = uniform(rng, 0, 1) < 0.5 ? "medical" : "chemical";
                n.fillRate = roundTo(uniform(rng, 15, 35), 5);
                n.capacity = n.fillRate * std::uniform_int_distribution<int>(10, 14)(rng);
            } else {
                const char* types[] = {"general", "recyclable", "compost"};
                n.binType = types[std::uniform_int_distribution<int>(0, 2)(rng)];
                n.fillRate = roundTo(uniform(rng, 100, 250), 10);
                n.capacity = n.fillRate * std::uniform_int_distribution<int>(8, 12)(rng);
            }
            n.name = "New " + n.binType + " bin " + n.id + ", " + area.name;
        } else {
            n.type = NodeType::Junction;
            n.zone = ZoneType::Arterial;
            n.name = "New junction " + n.id + ", " + area.name;
        }
        if (kind != GenKind::Junction) n.lastCollected = randomLastCollected(n, now, rng);

        // Wire it into the network before adding it (nearest is measured to the old nodes).
        std::vector<std::string> byDist = nearest(g, n.lat, n.lng, n.id);
        std::vector<std::string> junctions;
        std::vector<std::string> bins;
        for (size_t k = 0; k < byDist.size(); ++k) {
            NodeType t = g.getNode(byDist[k]).type;
            if (t == NodeType::Junction) junctions.push_back(byDist[k]);
            if (t == NodeType::Bin) bins.push_back(byDist[k]);
        }

        g.addNode(n);
        batch.nodeIds.push_back(n.id);

        if (kind == GenKind::Junction) {
            for (size_t k = 0; k < junctions.size() && k < 3; ++k) connect(g, n.id, junctions[k], ZoneType::Arterial);
            if (junctions.empty() && !byDist.empty()) connect(g, n.id, byDist[0], ZoneType::Arterial);
        } else if (kind == GenKind::Bin) {
            std::string first = !junctions.empty() ? junctions[0] : (!byDist.empty() ? byDist[0] : "");
            if (!first.empty()) connect(g, n.id, first, ZoneType::Industrial);
            if (!bins.empty() && bins[0] != first) connect(g, n.id, bins[0], ZoneType::Industrial);
        } else {  // home
            std::string first = !junctions.empty() ? junctions[0] : (!byDist.empty() ? byDist[0] : "");
            if (!first.empty()) connect(g, n.id, first, hazardous ? ZoneType::Arterial : area.zone);
            for (size_t k = 0; k < byDist.size(); ++k) {
                if (byDist[k] != first) {
                    connect(g, n.id, byDist[k], area.zone);
                    break;
                }
            }
        }
    }

    const std::vector<EdgeRecord>& all = g.edges();
    batch.edges.assign(all.begin() + edgesBefore, all.end());
    return batch;
}

namespace {

bool isHazardBin(const std::string& binType) { return binType == "medical" || binType == "chemical"; }

bool matches(const Node& n, GenKind kind, bool hazardous) {
    if (!n.generated) return false;
    if (kind == GenKind::Home) {
        return n.type == NodeType::Home && classifyWaste(n.wasteDescription).hazardous == hazardous;
    }
    if (kind == GenKind::Bin) return n.type == NodeType::Bin && isHazardBin(n.binType) == hazardous;
    return n.type == NodeType::Junction;
}

// Nodes reachable from `start`; with restricted=true residential/commercial roads are skipped
// (the roads a hazard truck may not use).
std::set<std::string> reachableFrom(const Graph& g, const std::string& start, bool restricted) {
    std::set<std::string> seen;
    std::vector<std::string> stack(1, start);
    seen.insert(start);
    while (!stack.empty()) {
        std::string u = stack.back();
        stack.pop_back();
        const std::vector<Edge>& es = g.neighbors(u);
        for (size_t i = 0; i < es.size(); ++i) {
            if (restricted && (es[i].zone == ZoneType::Residential || es[i].zone == ZoneType::Commercial)) continue;
            if (seen.insert(es[i].to).second) stack.push_back(es[i].to);
        }
    }
    return seen;
}

}  // namespace

RemovalResult removeGeneratedNodes(Graph& g, GenKind kind, bool hazardous, int count) {
    RemovalResult out;

    // Newest first: ids are kept in creation order, and a node only ever links to nodes that
    // already existed, so this order rarely strands anything.
    std::vector<std::string> ids = g.nodeIds();
    for (size_t i = ids.size(); i-- > 0 && static_cast<int>(out.removed.size()) < count;) {
        if (matches(g.getNode(ids[i]), kind, hazardous)) out.removed.push_back(ids[i]);
    }
    for (size_t i = 0; i < out.removed.size(); ++i) g.removeNode(out.removed[i]);

    std::vector<std::string> depots = g.nodeIdsByType(NodeType::Depot);
    if (depots.empty() || out.removed.empty()) return out;

    std::set<std::string> any = reachableFrom(g, depots[0], false);
    std::set<std::string> allowed = reachableFrom(g, depots[0], true);
    ids = g.nodeIds();
    for (size_t i = 0; i < ids.size(); ++i) {
        const Node& n = g.getNode(ids[i]);
        if (!n.generated) continue;
        bool needsRestricted = (n.type == NodeType::Home && classifyWaste(n.wasteDescription).hazardous) ||
                               (n.type == NodeType::Bin && isHazardBin(n.binType));
        if (!any.count(n.id) || (needsRestricted && !allowed.count(n.id))) out.cascaded.push_back(n.id);
    }
    for (size_t i = 0; i < out.cascaded.size(); ++i) g.removeNode(out.cascaded[i]);
    return out;
}

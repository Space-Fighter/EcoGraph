#include "controllers.hpp"

#include <ctime>
#include <map>

#include "city_loader.hpp"
#include "dijkstra.hpp"
#include "json.hpp"
#include "router.hpp"
#include "waste_classifier.hpp"

using json = nlohmann::json;

namespace {

void sendJson(httplib::Response& res, int status, const json& body) {
    res.status = status;
    res.set_content(body.dump(), "application/json");
}

void sendError(httplib::Response& res, int status, const std::string& code,
               const std::string& message) {
    sendJson(res, status, {{"ok", false}, {"error", code}, {"message", message}});
}

// Parses the request body as a JSON object; on failure writes a 400 and returns false.
bool parseBody(const httplib::Request& req, httplib::Response& res, json& out) {
    try {
        out = json::parse(req.body);
    } catch (const std::exception&) {
        sendError(res, 400, "bad_json", "Request body is not valid JSON");
        return false;
    }
    if (!out.is_object()) {
        sendError(res, 400, "bad_json", "Request body must be a JSON object");
        return false;
    }
    return true;
}

json segmentsToJson(const std::vector<RouteSegment>& segs) {
    json arr = json::array();
    for (size_t i = 0; i < segs.size(); ++i) {
        arr.push_back({{"label", segs[i].label}, {"path", segs[i].path}, {"cost", segs[i].cost}});
    }
    return arr;
}

json nodeToJson(const Node& n, const Scheduler& sched, std::time_t now) {
    json j = {{"id", n.id},
              {"type", nodeTypeToString(n.type)},
              {"zone", zoneToString(n.zone)},
              {"x", n.x},
              {"y", n.y}};
    if (n.type == NodeType::Home || n.type == NodeType::Bin) {
        j["fillRate"] = n.fillRate;
        j["capacity"] = n.capacity;
        j["lastCollected"] = static_cast<long long>(n.lastCollected);
        j["intervalDays"] = sched.computeInterval(n);
        j["overdueByDays"] = sched.overdueByDays(n, now);
    }
    if (n.type == NodeType::Bin) j["binType"] = n.binType;
    if (n.type == NodeType::Home) {
        j["wasteDescription"] = n.wasteDescription;
        ClassificationResult c = classifyWaste(n.wasteDescription);
        j["binType"] = c.binType;
        j["hazardous"] = c.hazardous;
    }
    return j;
}

const char* statusOf(const Node& n, const Scheduler& sched, std::time_t now) {
    if (n.type != NodeType::Home && n.type != NodeType::Bin) return "n/a";
    if (sched.percentFull(n, now) > 100.0) return "overflow";
    return sched.isDue(n, now) ? "due" : "ok";
}

// One row of the "database" view: everything known about a node on the simulated date.
json nodeRow(const Graph& g, const Node& n, const Scheduler& sched, std::time_t now) {
    json row = {{"id", n.id},
                {"type", nodeTypeToString(n.type)},
                {"zone", zoneToString(n.zone)},
                {"status", statusOf(n, sched, now)}};
    json neighbours = json::array();
    const std::vector<Edge>& es = g.neighbors(n.id);
    for (size_t i = 0; i < es.size(); ++i) neighbours.push_back(es[i].to);
    row["connections"] = neighbours;

    if (n.type == NodeType::Home || n.type == NodeType::Bin) {
        row["fillRate"] = n.fillRate;
        row["capacity"] = n.capacity;
        row["fillLevel"] = sched.fillLevel(n, now);
        row["percentFull"] = sched.percentFull(n, now);
        row["lastCollected"] = formatDate(n.lastCollected);
        row["daysSinceCollected"] = sched.daysSinceCollected(n, now);
        row["intervalDays"] = sched.computeInterval(n);
        row["nextDue"] = formatDate(sched.nextDue(n));
        row["overdueByDays"] = sched.overdueByDays(n, now);
    }
    if (n.type == NodeType::Bin) row["binType"] = n.binType;
    if (n.type == NodeType::Home) {
        ClassificationResult c = classifyWaste(n.wasteDescription);
        row["waste"] = n.wasteDescription;
        row["binType"] = c.binType;
        row["hazardous"] = c.hazardous;
    }
    return row;
}

json dayReportToJson(const DayReport& r) {
    json trucks = json::array();
    for (size_t i = 0; i < r.trucks.size(); ++i) {
        const TruckRun& t = r.trucks[i];
        trucks.push_back({{"id", t.id},
                          {"kind", t.kind},
                          {"homes", t.homes},
                          {"load", t.load},
                          {"capacity", t.capacity},
                          {"cost", t.cost},
                          {"bin", t.bin},
                          {"segments", segmentsToJson(t.segments)}});
    }
    return {{"day", r.day},
            {"date", formatDate(r.time)},
            {"due", r.due},
            {"overflowIds", r.overflowIds},
            {"overflowCount", r.overflowIds.size()},
            {"trucks", trucks},
            {"carriedOver", r.carriedOver},
            {"emptiedBins", r.emptiedBins},
            {"failed", r.failed},
            {"totalCost", r.totalCost}};
}

json simStatus(const Simulation& sim) {
    return {{"day", sim.day()}, {"date", formatDate(sim.now())}, {"startDate", formatDate(sim.startTime())}};
}

}  // namespace

void registerRoutes(httplib::Server& svr, AppState& state, const std::string& corsOrigin) {
    if (!corsOrigin.empty()) {
        svr.set_default_headers({{"Access-Control-Allow-Origin", corsOrigin},
                                 {"Access-Control-Allow-Methods", "GET, POST, OPTIONS"},
                                 {"Access-Control-Allow-Headers", "Content-Type"}});
        svr.Options(".*", [](const httplib::Request&, httplib::Response& res) { res.status = 204; });
    }

    // GET /health  (liveness probe for hosting platforms)
    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        sendJson(res, 200, {{"ok", true}});
    });

    // GET /graph
    svr.Get("/graph", [&state](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(state.mutex);
        std::time_t now = state.sim.now();
        json nodes = json::array(), edges = json::array();
        std::vector<std::string> ids = state.graph.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) {
            nodes.push_back(nodeToJson(state.graph.getNode(ids[i]), state.scheduler, now));
        }
        const std::vector<EdgeRecord>& es = state.graph.edges();
        for (size_t i = 0; i < es.size(); ++i) {
            edges.push_back({{"from", es[i].from},
                             {"to", es[i].to},
                             {"weight", es[i].weight},
                             {"zone", zoneToString(es[i].zone)}});
        }
        sendJson(res, 200, {{"ok", true}, {"nodes", nodes}, {"edges", edges}});
    });

    // POST /route   {"homeIds": [...], "mode": "priority" | "fifo"}
    svr.Post("/route", [&state](const httplib::Request& req, httplib::Response& res) {
        json body;
        if (!parseBody(req, res, body)) return;

        std::string mode = body.value("mode", std::string());
        std::unique_ptr<RouteStrategy> strategy = makeRouteStrategy(mode);
        if (!strategy) {
            sendError(res, 400, "bad_mode", "mode must be \"priority\" or \"fifo\"");
            return;
        }
        if (!body.contains("homeIds") || !body["homeIds"].is_array() || body["homeIds"].empty()) {
            sendError(res, 400, "bad_home_ids", "homeIds must be a non-empty array");
            return;
        }

        std::vector<std::string> homeIds;
        for (const json& v : body["homeIds"]) {
            if (!v.is_string()) {
                sendError(res, 400, "bad_home_ids", "homeIds must contain strings");
                return;
            }
            homeIds.push_back(v.get<std::string>());
        }

        std::lock_guard<std::mutex> lock(state.mutex);
        for (size_t i = 0; i < homeIds.size(); ++i) {
            if (!state.graph.hasNode(homeIds[i])) {
                sendError(res, 404, "unknown_node", "Unknown node id: " + homeIds[i]);
                return;
            }
            if (state.graph.getNode(homeIds[i]).type != NodeType::Home) {
                sendError(res, 400, "not_a_home", homeIds[i] + " is not a home");
                return;
            }
        }

        RouteResult r = strategy->buildRoute(state.graph, homeIds, state.sim.now());
        sendJson(res, 200,
                 {{"ok", true},
                  {"mode", r.mode},
                  {"totalCost", r.totalCost},
                  {"segments", segmentsToJson(r.segments)},
                  {"skippedHazardous", r.skippedHazardous},
                  {"unreachable", r.unreachable}});
    });

    // POST /classify   {"description": "..."}
    svr.Post("/classify", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        if (!parseBody(req, res, body)) return;
        if (!body.contains("description") || !body["description"].is_string()) {
            sendError(res, 400, "bad_description", "description must be a string");
            return;
        }
        ClassificationResult c = classifyWaste(body["description"].get<std::string>());
        sendJson(res, 200, {{"ok", true}, {"binType", c.binType}, {"hazardous", c.hazardous}});
    });

    // POST /route/hazard   {"locationId": "H5"}
    svr.Post("/route/hazard", [&state](const httplib::Request& req, httplib::Response& res) {
        json body;
        if (!parseBody(req, res, body)) return;
        if (!body.contains("locationId") || !body["locationId"].is_string()) {
            sendError(res, 400, "bad_location", "locationId must be a string");
            return;
        }
        std::string id = body["locationId"].get<std::string>();

        std::lock_guard<std::mutex> lock(state.mutex);
        if (!state.graph.hasNode(id)) {
            sendError(res, 404, "unknown_node", "Unknown node id: " + id);
            return;
        }
        HazardResult h = dispatchHazard(state.graph, id);
        if (!h.ok) {
            sendError(res, 422, h.error, h.message);
            return;
        }
        sendJson(res, 200,
                 {{"ok", true},
                  {"locationId", id},
                  {"binId", h.binId},
                  {"totalCost", h.totalCost},
                  {"segments", segmentsToJson(h.segments)},
                  {"forbiddenZones", {"residential", "commercial"}}});
    });

    // GET /schedule
    svr.Get("/schedule", [&state](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(state.mutex);
        std::time_t now = state.sim.now();
        json due = json::array();
        std::vector<DueLocation> d = state.scheduler.getDueLocations(state.graph, now);
        for (size_t i = 0; i < d.size(); ++i) {
            due.push_back({{"id", d[i].id},
                           {"type", nodeTypeToString(d[i].type)},
                           {"overdueByDays", d[i].overdueByDays}});
        }
        json overflow = json::array();  // already past 100% full: the thing we want to avoid
        std::vector<std::string> ids = state.graph.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) {
            const Node& n = state.graph.getNode(ids[i]);
            if ((n.type == NodeType::Home || n.type == NodeType::Bin) &&
                state.scheduler.percentFull(n, now) > 100.0) {
                overflow.push_back(n.id);
            }
        }
        sendJson(res, 200, {{"ok", true}, {"date", formatDate(now)}, {"day", state.sim.day()},
                            {"due", due}, {"overflow", overflow}});
    });

    // POST /collect   {"ids": ["H1", ...]}  -- marks locations as just collected
    svr.Post("/collect", [&state](const httplib::Request& req, httplib::Response& res) {
        json body;
        if (!parseBody(req, res, body)) return;
        if (!body.contains("ids") || !body["ids"].is_array()) {
            sendError(res, 400, "bad_ids", "ids must be an array");
            return;
        }
        std::lock_guard<std::mutex> lock(state.mutex);
        std::vector<std::string> ids;
        for (const json& v : body["ids"]) {
            if (!v.is_string() || !state.graph.hasNode(v.get<std::string>())) {
                sendError(res, 404, "unknown_node", "Unknown node id in ids");
                return;
            }
            ids.push_back(v.get<std::string>());
        }
        for (size_t i = 0; i < ids.size(); ++i) {
            state.sim.collect(state.graph, state.scheduler, ids[i], "manual");
        }
        sendJson(res, 200, {{"ok", true}, {"collected", ids}});
    });

    // GET /simulation
    svr.Get("/simulation", [&state](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(state.mutex);
        json j = simStatus(state.sim);
        j["ok"] = true;
        sendJson(res, 200, j);
    });

    // POST /simulate/advance
    //   {"days": 1..60, "autoCollect": bool, "mode": "priority"|"fifo",
    //    "normalTrucks": 0..20, "normalCapacity": >0, "hazardTrucks": 0..10}
    svr.Post("/simulate/advance", [&state](const httplib::Request& req, httplib::Response& res) {
        json body = json::object();
        if (!req.body.empty() && !parseBody(req, res, body)) return;
        try {
            int days = body.value("days", 1);
            bool autoCollect = body.value("autoCollect", false);
            std::string mode = body.value("mode", std::string("priority"));
            Fleet fleet;
            fleet.normalTrucks = body.value("normalTrucks", fleet.normalTrucks);
            fleet.normalCapacity = body.value("normalCapacity", fleet.normalCapacity);
            fleet.hazardTrucks = body.value("hazardTrucks", fleet.hazardTrucks);

            if (days < 1 || days > 60) {
                sendError(res, 400, "bad_days", "days must be between 1 and 60");
                return;
            }
            std::unique_ptr<RouteStrategy> strategy = makeRouteStrategy(mode);
            if (!strategy) {
                sendError(res, 400, "bad_mode", "mode must be \"priority\" or \"fifo\"");
                return;
            }
            if (fleet.normalTrucks < 0 || fleet.normalTrucks > 20 || fleet.hazardTrucks < 0 ||
                fleet.hazardTrucks > 10 || !(fleet.normalCapacity > 0) || fleet.normalCapacity > 100000) {
                sendError(res, 400, "bad_fleet",
                          "normalTrucks 0-20, hazardTrucks 0-10, normalCapacity 1-100000");
                return;
            }

            std::lock_guard<std::mutex> lock(state.mutex);
            json reports = json::array();
            for (int i = 0; i < days; ++i) {
                reports.push_back(dayReportToJson(
                    state.sim.advanceDay(state.graph, state.scheduler, autoCollect, *strategy, fleet)));
            }
            sendJson(res, 200, {{"ok", true}, {"simulation", simStatus(state.sim)}, {"days", reports}});
        } catch (const json::exception&) {
            sendError(res, 400, "bad_params", "Simulation parameters have the wrong type");
        }
    });

    // POST /simulate/reset  -- reload the original city data and go back to day 0
    svr.Post("/simulate/reset", [&state](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(state.mutex);
        try {
            state.graph = loadCity(state.cityPath, state.sim.startTime());
        } catch (const std::exception& e) {
            sendError(res, 500, "reload_failed", e.what());
            return;
        }
        state.sim.start(state.sim.startTime());
        sendJson(res, 200, {{"ok", true}, {"simulation", simStatus(state.sim)}});
    });

    // GET /database  -- node table, per-zone summary and the collection log
    svr.Get("/database", [&state](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(state.mutex);
        std::time_t now = state.sim.now();

        json nodes = json::array();
        std::map<std::string, json> zones;
        std::vector<std::string> ids = state.graph.nodeIds();
        for (size_t i = 0; i < ids.size(); ++i) {
            const Node& n = state.graph.getNode(ids[i]);
            nodes.push_back(nodeRow(state.graph, n, state.scheduler, now));

            json& z = zones[zoneToString(n.zone)];
            if (z.is_null()) {
                z = {{"zone", zoneToString(n.zone)}, {"nodes", 0}, {"collectable", 0}, {"due", 0},
                     {"overflow", 0}, {"avgPercentFull", 0.0}, {"totalFillRate", 0.0}};
            }
            z["nodes"] = z["nodes"].get<int>() + 1;
            if (n.type == NodeType::Home || n.type == NodeType::Bin) {
                z["collectable"] = z["collectable"].get<int>() + 1;
                z["avgPercentFull"] = z["avgPercentFull"].get<double>() + state.scheduler.percentFull(n, now);
                z["totalFillRate"] = z["totalFillRate"].get<double>() + n.fillRate;
                if (state.scheduler.isDue(n, now)) z["due"] = z["due"].get<int>() + 1;
                if (state.scheduler.percentFull(n, now) > 100.0) z["overflow"] = z["overflow"].get<int>() + 1;
            }
        }
        json zoneArr = json::array();
        for (std::map<std::string, json>::iterator it = zones.begin(); it != zones.end(); ++it) {
            json z = it->second;
            int c = z["collectable"].get<int>();
            z["avgPercentFull"] = c ? z["avgPercentFull"].get<double>() / c : 0.0;
            zoneArr.push_back(z);
        }

        json log = json::array();
        const std::vector<LogEntry>& entries = state.sim.log();
        for (size_t i = entries.size(); i-- > 0 && log.size() < 300;) {  // newest first
            const LogEntry& e = entries[i];
            log.push_back({{"day", e.day},
                           {"date", formatDate(e.time)},
                           {"id", e.id},
                           {"type", nodeTypeToString(e.type)},
                           {"action", e.action},
                           {"truck", e.truck},
                           {"overdueByDays", e.overdueByDays},
                           {"percentFull", e.percentFull}});
        }
        sendJson(res, 200, {{"ok", true}, {"simulation", simStatus(state.sim)}, {"nodes", nodes},
                            {"zones", zoneArr}, {"log", log}});
    });

    svr.set_exception_handler([](const httplib::Request&, httplib::Response& res, std::exception_ptr) {
        sendError(res, 500, "internal_error", "Unexpected server error");
    });
}

#include "controllers.hpp"

#include <ctime>

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

std::string todayString(std::time_t now) {
    char buf[16];
    std::tm* t = std::localtime(&now);
    std::strftime(buf, sizeof(buf), "%Y-%m-%d", t);
    return buf;
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
        std::time_t now = std::time(nullptr);
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

        RouteResult r = strategy->buildRoute(state.graph, homeIds, std::time(nullptr));
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
        std::time_t now = std::time(nullptr);
        json due = json::array();
        std::vector<DueLocation> d = state.scheduler.getDueLocations(state.graph, now);
        for (size_t i = 0; i < d.size(); ++i) {
            due.push_back({{"id", d[i].id},
                           {"type", nodeTypeToString(d[i].type)},
                           {"overdueByDays", d[i].overdueByDays}});
        }
        sendJson(res, 200, {{"ok", true}, {"date", todayString(now)}, {"due", due}});
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
        std::time_t now = std::time(nullptr);
        for (size_t i = 0; i < ids.size(); ++i) state.scheduler.markCollected(state.graph, ids[i], now);
        sendJson(res, 200, {{"ok", true}, {"collected", ids}});
    });

    svr.set_exception_handler([](const httplib::Request&, httplib::Response& res, std::exception_ptr) {
        sendError(res, 500, "internal_error", "Unexpected server error");
    });
}

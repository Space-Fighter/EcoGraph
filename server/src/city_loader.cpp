#include "city_loader.hpp"

#include <fstream>
#include <stdexcept>

#include "json.hpp"

using json = nlohmann::json;

Graph loadCity(const std::string& path, std::time_t now) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open city file: " + path);

    json doc;
    try {
        in >> doc;
    } catch (const std::exception& e) {
        throw std::runtime_error(std::string("invalid city JSON: ") + e.what());
    }

    Graph g;
    try {
        for (const json& jn : doc.at("nodes")) {
            Node n;
            n.id = jn.at("id").get<std::string>();
            n.type = nodeTypeFromString(jn.at("type").get<std::string>());
            n.zone = zoneFromString(jn.at("zone").get<std::string>());
            n.x = jn.value("x", 0.0);
            n.y = jn.value("y", 0.0);
            n.fillRate = jn.value("fillRate", 0.0);
            n.capacity = jn.value("capacity", 100.0);
            n.binType = jn.value("binType", std::string());
            n.wasteDescription = jn.value("wasteDescription", std::string());
            if (jn.contains("lastCollectedDaysAgo")) {
                n.lastCollected = now - static_cast<std::time_t>(
                                            jn.at("lastCollectedDaysAgo").get<double>() * 86400.0);
            } else {
                n.lastCollected = static_cast<std::time_t>(jn.value("lastCollected", 0LL));
            }
            g.addNode(n);
        }
        for (const json& je : doc.at("edges")) {
            g.addEdge(je.at("from").get<std::string>(), je.at("to").get<std::string>(),
                      je.at("weight").get<double>(),
                      zoneFromString(je.at("zone").get<std::string>()),
                      !je.value("directed", false));
        }
    } catch (const std::exception& e) {
        throw std::runtime_error(std::string("bad city data: ") + e.what());
    }
    return g;
}

#include "city_loader.hpp"

#include <fstream>
#include <stdexcept>

#include "geo.hpp"
#include "json.hpp"

using json = nlohmann::json;

City loadCity(const std::string& path, std::time_t now) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open city file: " + path);

    json doc;
    try {
        in >> doc;
    } catch (const std::exception& e) {
        throw std::runtime_error(std::string("invalid city JSON: ") + e.what());
    }

    City city;
    try {
        for (const json& jn : doc.at("nodes")) {
            Node n;
            n.id = jn.at("id").get<std::string>();
            n.name = jn.value("name", n.id);
            n.area = jn.value("area", std::string());
            n.type = nodeTypeFromString(jn.at("type").get<std::string>());
            n.zone = zoneFromString(jn.at("zone").get<std::string>());
            n.lat = jn.at("lat").get<double>();
            n.lng = jn.at("lng").get<double>();
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
            city.graph.addNode(n);
        }
        for (const json& je : doc.at("edges")) {
            std::string from = je.at("from").get<std::string>();
            std::string to = je.at("to").get<std::string>();
            if (!city.graph.hasNode(from) || !city.graph.hasNode(to)) {
                throw std::runtime_error("edge refers to unknown node: " + from + " - " + to);
            }
            double weight;
            if (je.contains("weight")) {
                weight = je.at("weight").get<double>();
            } else {
                const Node& a = city.graph.getNode(from);
                const Node& b = city.graph.getNode(to);
                weight = haversineKm(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR;
            }
            city.graph.addEdge(from, to, weight, zoneFromString(je.at("zone").get<std::string>()),
                               !je.value("directed", false));
        }
        if (doc.contains("areas")) {
            for (const json& ja : doc.at("areas")) {
                Area a;
                a.name = ja.at("name").get<std::string>();
                a.zone = zoneFromString(ja.at("zone").get<std::string>());
                a.lat = ja.at("lat").get<double>();
                a.lng = ja.at("lng").get<double>();
                a.radiusKm = ja.at("radiusKm").get<double>();
                city.areas.push_back(a);
            }
        }
    } catch (const std::exception& e) {
        throw std::runtime_error(std::string("bad city data: ") + e.what());
    }
    return city;
}

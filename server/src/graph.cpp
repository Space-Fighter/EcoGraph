#include "graph.hpp"

#include <algorithm>
#include <stdexcept>

std::string zoneToString(ZoneType z) {
    switch (z) {
        case ZoneType::Residential: return "residential";
        case ZoneType::Commercial: return "commercial";
        case ZoneType::Industrial: return "industrial";
        case ZoneType::Arterial: return "arterial";
    }
    return "arterial";
}

ZoneType zoneFromString(const std::string& s) {
    if (s == "residential") return ZoneType::Residential;
    if (s == "commercial") return ZoneType::Commercial;
    if (s == "industrial") return ZoneType::Industrial;
    if (s == "arterial") return ZoneType::Arterial;
    throw std::invalid_argument("unknown zone: " + s);
}

std::string nodeTypeToString(NodeType t) {
    switch (t) {
        case NodeType::Depot: return "depot";
        case NodeType::Home: return "home";
        case NodeType::Junction: return "junction";
        case NodeType::Bin: return "bin";
    }
    return "junction";
}

NodeType nodeTypeFromString(const std::string& s) {
    if (s == "depot") return NodeType::Depot;
    if (s == "home") return NodeType::Home;
    if (s == "junction") return NodeType::Junction;
    if (s == "bin") return NodeType::Bin;
    throw std::invalid_argument("unknown node type: " + s);
}

void Graph::addNode(const Node& n) {
    if (nodes_.find(n.id) == nodes_.end()) order_.push_back(n.id);
    nodes_[n.id] = n;
    adjacency_[n.id];  // make sure an (empty) adjacency list exists
}

void Graph::addNode(const std::string& id, NodeType type, ZoneType zone) {
    Node n;
    n.id = id;
    n.type = type;
    n.zone = zone;
    addNode(n);
}

void Graph::addEdge(const std::string& from, const std::string& to, double weight,
                    ZoneType zone, bool bidirectional) {
    if (!hasNode(from) || !hasNode(to)) {
        throw std::invalid_argument("addEdge: unknown node");
    }
    if (weight < 0) {
        throw std::invalid_argument("addEdge: negative weight");
    }
    adjacency_[from].push_back(Edge{to, weight, zone});
    if (bidirectional) {
        adjacency_[to].push_back(Edge{from, weight, zone});
    }
    edgeList_.push_back(EdgeRecord{from, to, weight, zone});
}

void Graph::removeNode(const std::string& id) {
    if (!hasNode(id)) throw std::out_of_range("removeNode: unknown node " + id);
    nodes_.erase(id);
    adjacency_.erase(id);
    for (std::unordered_map<std::string, std::vector<Edge> >::iterator it = adjacency_.begin();
         it != adjacency_.end(); ++it) {
        std::vector<Edge>& v = it->second;
        v.erase(std::remove_if(v.begin(), v.end(), [&id](const Edge& e) { return e.to == id; }), v.end());
    }
    edgeList_.erase(std::remove_if(edgeList_.begin(), edgeList_.end(),
                                   [&id](const EdgeRecord& r) { return r.from == id || r.to == id; }),
                    edgeList_.end());
    order_.erase(std::remove(order_.begin(), order_.end(), id), order_.end());
}

bool Graph::hasNode(const std::string& id) const {
    return nodes_.count(id) > 0;
}

const Node& Graph::getNode(const std::string& id) const {
    return nodes_.at(id);
}

Node& Graph::getNodeMutable(const std::string& id) {
    return nodes_.at(id);
}

const std::vector<Edge>& Graph::neighbors(const std::string& id) const {
    return adjacency_.at(id);
}

std::vector<std::string> Graph::nodeIds() const {
    return order_;
}

std::vector<std::string> Graph::nodeIdsByType(NodeType type) const {
    std::vector<std::string> out;
    for (size_t i = 0; i < order_.size(); ++i) {
        if (nodes_.at(order_[i]).type == type) out.push_back(order_[i]);
    }
    return out;
}

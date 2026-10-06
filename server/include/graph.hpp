#ifndef GRAPH_HPP
#define GRAPH_HPP

#include <ctime>
#include <string>
#include <unordered_map>
#include <vector>

enum class ZoneType { Residential, Commercial, Industrial, Arterial };
enum class NodeType { Depot, Home, Junction, Bin };

std::string zoneToString(ZoneType z);
ZoneType zoneFromString(const std::string& s);  // throws std::invalid_argument
std::string nodeTypeToString(NodeType t);
NodeType nodeTypeFromString(const std::string& s);  // throws std::invalid_argument

struct Node {
    std::string id;
    std::string name;  // display name, e.g. "Clement Town Campus Hostels"
    std::string area;  // locality the node belongs to
    NodeType type = NodeType::Junction;
    ZoneType zone = ZoneType::Arterial;
    double lat = 0, lng = 0;  // degrees

    // Home / Bin only
    double fillRate = 0.0;          // kg per day
    double capacity = 100.0;        // kg at which the location is "full"
    std::time_t lastCollected = 0;  // epoch seconds
    std::string binType;            // Bin: recyclable | compost | general | medical | chemical
    std::string wasteDescription;   // Home: what this home currently has out for pickup
    bool generated = false;         // added by the city builder, not part of the city file
};

struct Edge {
    std::string to;
    double weight;
    ZoneType zone;
};

struct EdgeRecord {
    std::string from, to;
    double weight;
    ZoneType zone;
};

class Graph {
public:
    void addNode(const Node& n);
    void addNode(const std::string& id, NodeType type, ZoneType zone);
    // Adds the edge in both directions unless bidirectional is false.
    void addEdge(const std::string& from, const std::string& to, double weight,
                 ZoneType zone, bool bidirectional = true);

    // Removes a node and every edge touching it. Throws std::out_of_range if id is unknown.
    void removeNode(const std::string& id);

    bool hasNode(const std::string& id) const;
    // These throw std::out_of_range if id is unknown.
    const Node& getNode(const std::string& id) const;
    Node& getNodeMutable(const std::string& id);
    const std::vector<Edge>& neighbors(const std::string& id) const;

    std::vector<std::string> nodeIds() const;  // in insertion order
    std::vector<std::string> nodeIdsByType(NodeType type) const;
    const std::vector<EdgeRecord>& edges() const { return edgeList_; }

private:
    std::unordered_map<std::string, Node> nodes_;
    std::unordered_map<std::string, std::vector<Edge>> adjacency_;
    std::vector<std::string> order_;
    std::vector<EdgeRecord> edgeList_;  // each edge once, as it was added
};

#endif

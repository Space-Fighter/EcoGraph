#ifndef CITY_LOADER_HPP
#define CITY_LOADER_HPP

#include <ctime>
#include <string>

#include "graph.hpp"

// Parses a city.json file into a Graph. "lastCollectedDaysAgo" is converted to an epoch
// timestamp relative to `now` (so the demo data is always "fresh"); an absolute
// "lastCollected" epoch is also accepted. Throws std::runtime_error on bad input.
Graph loadCity(const std::string& path, std::time_t now);

#endif

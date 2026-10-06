#ifndef CONTROLLERS_HPP
#define CONTROLLERS_HPP

#include <mutex>

#include "graph.hpp"
#include "httplib.h"
#include "scheduler.hpp"

// Everything the handlers share. One mutex guards the graph because the scheduler
// mutates lastCollected while other requests are reading it.
struct AppState {
    Graph graph;
    Scheduler scheduler;
    std::mutex mutex;
};

// corsOrigin: value for Access-Control-Allow-Origin ("" = same-origin only). Needed when
// the frontend is hosted on a different origin than the API (e.g. static site + API host).
void registerRoutes(httplib::Server& svr, AppState& state, const std::string& corsOrigin = "");

#endif

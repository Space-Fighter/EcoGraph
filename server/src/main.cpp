#include <cstdlib>
#include <ctime>
#include <iostream>

#include "city_loader.hpp"
#include "controllers.hpp"
#include "httplib.h"

namespace {
// Configuration order: command-line argument > environment variable > default, so the
// same binary runs locally, in a container, or on a PaaS that injects PORT.
std::string setting(int argc, char** argv, int argIndex, const char* envName, const char* fallback) {
    if (argc > argIndex) return argv[argIndex];
    const char* env = std::getenv(envName);
    return (env && *env) ? env : fallback;
}
}  // namespace

// usage: ecorouting [port] [city.json] [frontend-dir]
// env:   PORT, CITY_FILE, FRONTEND_DIR, CORS_ORIGIN (e.g. https://my-app.vercel.app or *)
int main(int argc, char** argv) {
    int port = std::atoi(setting(argc, argv, 1, "PORT", "8080").c_str());
    std::string cityPath = setting(argc, argv, 2, "CITY_FILE", "data/city.json");
    std::string frontendDir = setting(argc, argv, 3, "FRONTEND_DIR", "../frontend");
    const char* cors = std::getenv("CORS_ORIGIN");

    AppState state;
    state.cityPath = cityPath;
    try {
        std::time_t base = std::time(nullptr);
        City city = loadCity(cityPath, base);
        state.graph = city.graph;
        state.areas = city.areas;
        state.sim.start(base);
    } catch (const std::exception& e) {
        std::cerr << "Failed to load city: " << e.what() << std::endl;
        return 1;
    }

    httplib::Server svr;
    registerRoutes(svr, state, cors ? cors : "");
    if (!svr.set_mount_point("/", frontendDir)) {
        std::cerr << "Note: no frontend served (directory not found: " << frontendDir << ")\n";
    }

    std::cout << "EcoRouting Engine: " << state.graph.nodeIds().size() << " nodes loaded from "
              << cityPath << "\nListening on http://0.0.0.0:" << port << std::endl;
    if (!svr.listen("0.0.0.0", port)) {
        std::cerr << "Could not listen on port " << port << std::endl;
        return 1;
    }
    return 0;
}

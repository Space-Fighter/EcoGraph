cmake_minimum_required(VERSION 3.10)
project(EcoRoutingEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include third_party)

set(CORE_SOURCES
    src/graph.cpp
    src/dijkstra.cpp
    src/waste_classifier.cpp
    src/scheduler.cpp
    src/router.cpp
    src/simulation.cpp
    src/city_loader.cpp)

add_library(core STATIC ${CORE_SOURCES})

add_executable(ecorouting src/main.cpp src/controllers.cpp)
target_link_libraries(ecorouting core)
if(WIN32)
  target_link_libraries(ecorouting ws2_32)
  target_compile_definitions(ecorouting PRIVATE _WIN32_WINNT=0x0A00)
else()
  find_package(Threads REQUIRED)
  target_link_libraries(ecorouting Threads::Threads)
endif()

enable_testing()
foreach(t test_dijkstra test_domain test_simulation)
  add_executable(${t} tests/${t}.cpp)
  target_link_libraries(${t} core)
  add_test(NAME ${t} COMMAND ${t})
endforeach()

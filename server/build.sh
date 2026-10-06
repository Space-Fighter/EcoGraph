#!/bin/sh
# Builds the server and tests without CMake. Needs a g++ with C++17 and posix threads
# (e.g. the GCC 13 in C:/Strawberry/c/bin on this machine; the old C:/MinGW g++ will not work).
set -e
cd "$(dirname "$0")"
mkdir -p build
CORE="src/graph.cpp src/dijkstra.cpp src/waste_classifier.cpp src/scheduler.cpp src/router.cpp src/simulation.cpp src/city_loader.cpp"
FLAGS="-std=c++17 -O2 -Wall -Wextra -Iinclude -Ithird_party"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) LIBS="-static -lws2_32 -D_WIN32_WINNT=0x0A00"; EXE=".exe" ;;
  *) LIBS="-pthread"; EXE="" ;;
esac
g++ $FLAGS $CORE src/main.cpp src/controllers.cpp -o build/ecorouting$EXE $LIBS
g++ $FLAGS $CORE tests/test_dijkstra.cpp -o build/test_dijkstra$EXE
g++ $FLAGS $CORE tests/test_domain.cpp -o build/test_domain$EXE
g++ $FLAGS $CORE tests/test_simulation.cpp -o build/test_simulation$EXE
echo "Built: build/ecorouting$EXE, build/test_dijkstra$EXE, build/test_domain$EXE"

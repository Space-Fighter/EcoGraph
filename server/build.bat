@echo off
rem Windows (PowerShell / cmd) version of build.sh. Needs a g++ with C++17 and posix threads;
rem uses the GCC 13 in C:\Strawberry\c\bin when present (the old C:\MinGW g++ will not work).
setlocal
cd /d "%~dp0"
if exist "C:\Strawberry\c\bin\g++.exe" set "PATH=C:\Strawberry\c\bin;%PATH%"
where g++ >nul 2>nul || (echo g++ not found. Install Strawberry Perl or MSYS2 GCC and add it to PATH. & exit /b 1)
if not exist build mkdir build
set CORE=src/graph.cpp src/dijkstra.cpp src/waste_classifier.cpp src/scheduler.cpp src/router.cpp src/simulation.cpp src/city_loader.cpp src/city_generator.cpp
set FLAGS=-std=c++17 -O2 -Wall -Wextra -Iinclude -Ithird_party
g++ %FLAGS% %CORE% src/main.cpp src/controllers.cpp -o build/ecorouting.exe -static -lws2_32 -D_WIN32_WINNT=0x0A00 || exit /b 1
g++ %FLAGS% %CORE% tests/test_dijkstra.cpp -o build/test_dijkstra.exe || exit /b 1
g++ %FLAGS% %CORE% tests/test_domain.cpp -o build/test_domain.exe || exit /b 1
g++ %FLAGS% %CORE% tests/test_simulation.cpp -o build/test_simulation.exe || exit /b 1
g++ %FLAGS% %CORE% tests/test_city_data.cpp -o build/test_city_data.exe || exit /b 1
g++ %FLAGS% %CORE% tests/test_generator.cpp -o build/test_generator.exe || exit /b 1
echo Built: build\ecorouting.exe and the test binaries

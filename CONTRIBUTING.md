# Contributing to EcoGraph

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Build and run tests:
```bash
   cd server && mkdir build && cd build
   cmake .. && cmake --build .
   ./test_dijkstra && ./test_domain && ./test_simulation
```
3. Use conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
4. Open a pull request describing what changed and why.

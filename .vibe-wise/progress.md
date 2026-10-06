# Learning Progress

## Build order and delivery
- Learner asked where to start; Claude offered inside-out vs thin slice and proposed inside-out. Learner did not give their own design reasoning; approved Step 1 as proposed.
- Learner then asked for direct implementation (demo to teacher next day, ~2 hours). Learning checkpoints were skipped at their request; Claude built the rest directly.
- Implemented and verified: Graph, plain + constrained Dijkstra, classifier, scheduler, Priority/FIFO route builders (RouteStrategy polymorphism), hazard dispatch, JSON city loader, REST API (6 endpoints + /health), vanilla-JS Cytoscape frontend. Unit tests pass; all endpoints and the UI flows checked manually.
- Needs reinforcement (learner has not yet explained): why constrained Dijkstra skips edges rather than nodes, stale-entry skipping in the heap, REST/CORS basics, why the hazard route differs from the plain route. Good prep topics before the demo.

## Learner decisions
- Hosting: undecided; Vercel considered. Keep Docker-compatible but no Dockerfile for now.
- Learner commits to GitHub themselves; Claude must not run git commit/push (keeps Claude out of commit history).

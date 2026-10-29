# Build stage: compile the server and run the tests (a failing test fails the build)
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server ./
# Strip CRLF in case the repo was checked out on Windows
RUN sed -i 's/\r$//' build.sh \
    && sh build.sh \
    && for t in build/test_*; do "$t"; done

# Runtime stage: only the binary, the city data and the static frontend
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/server/build/ecorouting ./ecorouting
COPY server/data ./data
COPY frontend ./frontend
ENV CITY_FILE=/app/data/city.json \
    FRONTEND_DIR=/app/frontend \
    PORT=8080
EXPOSE 8080
# No CLI args, so the port comes from $PORT (set by hosts such as Render)
CMD ["./ecorouting"]

FROM gcc:13
RUN apt-get update && apt-get install -y cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server ./server
COPY frontend ./frontend
WORKDIR /app/server
RUN cmake -S . -B build && cmake --build build -j
EXPOSE 8080
CMD ["./build/ecorouting", "8080", "data/city.json", "../frontend"]

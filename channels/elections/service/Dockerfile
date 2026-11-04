# Build from the repository root; core embeds the same curated race catalog.
FROM rust:1-slim AS builder
WORKDIR /repo/channels/elections/service
COPY channels/elections/service/Cargo.toml channels/elections/service/Cargo.lock ./
COPY channels/elections/service/src ./src
COPY api/internal/ingestread/elections_catalog.json /repo/api/internal/ingestread/elections_catalog.json
RUN cargo build --release --locked

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /repo/channels/elections/service/target/release/elections_service /usr/local/bin/
USER 65534:65534
EXPOSE 3005
CMD ["elections_service"]

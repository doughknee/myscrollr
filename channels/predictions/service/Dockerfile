FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# No OpenSSL dependency needed — we're on rustls for both reqwest and
# tokio-tungstenite.
RUN cargo chef cook --release --recipe-path recipe.json

# Build application
COPY . .
RUN cargo build --release --bin predictions_service

FROM debian:trixie-slim
WORKDIR /app

# Sentry release tagging — the runtime reads GIT_SHA via std::env::var and
# attaches it as a Sentry scope tag. Set via Coolify build args.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/predictions_service .
COPY --from=builder /app/configs ./configs

CMD ["./predictions_service"]

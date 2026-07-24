FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Build application
COPY . .
RUN cargo build --release --bin rss_service
# ── Dev stage: hot reload (NOT the default build target) ─────────────
# Deliberately placed BEFORE the runtime stage: deploy.yml runs
# `docker build` with no --target, which builds the LAST stage. Keeping the
# production runtime last means the deploy pipeline is unaffected by this.
# docker/compose.yml selects this one explicitly with `target: dev`.
#
# Source is bind-mounted from the host and `cargo watch` rebuilds on save.
# `target/` lives in a named volume so the container's Linux artifacts never
# collide with the host's.
FROM rust:1-slim AS dev
WORKDIR /app
RUN apt-get update  && apt-get install -y --no-install-recommends ca-certificates curl pkg-config libssl-dev  && rm -rf /var/lib/apt/lists/*  && cargo install cargo-watch --locked
# -w src keeps the watcher off target/; --why logs what triggered a rebuild.
# --poll: bind mounts on Windows/macOS do not deliver inotify events
# reliably. Without it the watcher silently never fires.
CMD ["cargo", "watch", "--poll", "-w", "src", "-w", "Cargo.toml", "--why", "-x", "run --bin rss_service"]


FROM debian:trixie-slim
WORKDIR /app

# Sentry release tagging — the runtime reads GIT_SHA via std::env::var and
# attaches it as a Sentry scope tag. Set via Coolify build args.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/rss_service .
COPY --from=builder /app/configs/feeds.json ./configs/feeds.json

CMD ["./rss_service"]

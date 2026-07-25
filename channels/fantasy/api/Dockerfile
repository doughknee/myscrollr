FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy module files and download dependencies
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o fantasy-api .
# ── Dev stage: hot reload (NOT the default build target) ─────────────
# Deliberately placed BEFORE the runtime stage: deploy.yml runs
# `docker build` with no --target, which builds the LAST stage. Keeping the
# production runtime last means the deploy pipeline is unaffected by this.
# docker/compose.yml selects this one explicitly with `target: dev`.
#
# Source is bind-mounted from the host, so `air` rebuilds the binary in
# place on save — no image rebuild per edit.
FROM golang:1.25-alpine AS dev
WORKDIR /app
# air is PINNED, not @latest: v1.67.2 raised its minimum to Go 1.26 and
# broke this build with no warning. v1.67.1 is the last release that
# builds on the Go 1.25 this image pins to match go.mod. Bump both
# together or not at all.
RUN apk add --no-cache git curl && go install github.com/air-verse/air@v1.67.1
ENV GOFLAGS=-buildvcs=false
EXPOSE 8084
CMD ["air", "-c", ".air.toml"]


# --- Runtime stage ---
FROM alpine:latest

WORKDIR /root/

# Sentry release tagging — the runtime reads GIT_SHA via os.Getenv.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# Install curl for health checks
RUN apk --no-cache add curl

# Copy the binary. No migrations — core-api owns the schema (VISION 4.3).
COPY --from=builder /app/fantasy-api .

EXPOSE 8084

CMD ["./fantasy-api"]

FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install git for module fetching
RUN apk add --no-cache git

# Copy the module files
COPY go.mod ./

# Copy the source code
COPY . .

# Fetch dependencies
RUN go mod tidy
RUN go mod download

# Build the Go app
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .
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
EXPOSE 8080
CMD ["air", "-c", ".air.toml"]


######## Start a new stage from scratch #######
FROM alpine:latest

WORKDIR /root/

# Sentry release tagging — the runtime reads GIT_SHA via os.Getenv. Pass
# COOLIFY_GIT_COMMIT (or equivalent) as a build arg at image-build time.
# Defaults to "unknown" so local builds still work.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# All URL env vars (API_URL, LOGTO_URL, LOGTO_JWKS_URL, YAHOO_CALLBACK_URL)
# are supplied at runtime via K8s ConfigMap and Secrets.

# Install curl for health checks
RUN apk --no-cache add curl

# Copy the Pre-built binary from the previous stage
COPY --from=builder /app/main .
COPY --from=builder /app/migrations ./migrations

# Expose port 8080 to the outside world
EXPOSE 8080

# Command to run the executable
CMD ["./main"]

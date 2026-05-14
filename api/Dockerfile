FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install git and swag CLI
RUN apk add --no-cache git && \
    go install github.com/swaggo/swag/cmd/swag@latest

# Copy the module files
COPY go.mod ./

# Copy the source code
COPY . .

# Generate Swagger docs (--parseDependency scans sub-package core/)
RUN swag init --parseDependency

# Fetch dependencies
RUN go mod tidy
RUN go mod download

# Build the Go app
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

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
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/migrations ./migrations

# Expose port 8080 to the outside world
EXPOSE 8080

# Command to run the executable
CMD ["./main"]

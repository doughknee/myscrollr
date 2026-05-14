FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy module files and download dependencies
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o fantasy-api .

# --- Runtime stage ---
FROM alpine:latest

WORKDIR /root/

# Sentry release tagging — the runtime reads GIT_SHA via os.Getenv.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# Install curl for health checks
RUN apk --no-cache add curl

# Copy the binary and migrations from the builder
COPY --from=builder /app/fantasy-api .
COPY --from=builder /app/migrations ./migrations

EXPOSE 8084

CMD ["./fantasy-api"]

FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o rss-api .

FROM alpine:latest

# Sentry release tagging — the runtime reads GIT_SHA via os.Getenv.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/rss-api .

EXPOSE 8083

CMD ["./rss-api"]

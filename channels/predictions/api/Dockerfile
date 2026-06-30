FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o predictions-api .

FROM alpine:latest

# Sentry release tagging — the runtime reads GIT_SHA via os.Getenv.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/predictions-api .

EXPOSE 8085

CMD ["./predictions-api"]

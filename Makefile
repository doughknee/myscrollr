# MyScrollr — the single entry point for local development.
#
#   make            Show this help
#   make setup      One-time: generate every .env file
#   make up         Start the whole backend
#
# Everything local runs in Docker (docker/compose.yml). The backend
# hot-reloads: edit a Go or Rust file on the host and that one service
# rebuilds inside its container in seconds — no image rebuild per change.
#
# The two FRONT-ENDS stay native on purpose: a GUI window can't run inside a
# Linux container, and Vite/Tauri hot-reload better on the host.
#
# Full runbook: docs/LOCAL_SETUP.md

COMPOSE      := docker compose -f docker/compose.yml
COMPOSE_PRED := $(COMPOSE) --profile predictions
# Predictions is opt-in: it needs a Kalshi key. The profile turns on only
# once `make setup` (or `make kalshi-key`) has produced its env file.
COMPOSE_AUTO  = $(shell [ -f secrets/predictions.docker.env ] && echo "$(COMPOSE_PRED)" || echo "$(COMPOSE)")

.DEFAULT_GOAL := help
.PHONY: help setup doctor up down restart rebuild reset logs ps shell \
        web desktop dev kalshi-key check

# ── Help ─────────────────────────────────────────────────────────────
# Targets are documented with `##<group>: description` and grouped below.
help:
	@echo ""
	@echo "  MyScrollr - local development"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} \
	  /^[a-zA-Z_-]+:.*?##[a-z]+:/ { \
	    split($$2, p, ":"); grp = p[1]; \
	    desc = substr($$2, length(grp) + 2); \
	    if (grp != last) { printf "\033[1m  %s\033[0m\n", toupper(grp); last = grp } \
	    printf "    \033[36m%-14s\033[0m %s\n", $$1, desc \
	  }' $(MAKEFILE_LIST)
	@echo ""
	@echo "  First time?  make setup  &&  make up"
	@echo ""
	@echo "  Ports  core 18080 | fantasy 8084 | postgres 5432 | redis 6379"
	@echo "         finance 3001 | sports 3002 | rss 3004 | predictions 3005"
	@echo "         web 3000 and the desktop app run natively, not in Docker"
	@echo ""

# ── Setup ────────────────────────────────────────────────────────────
setup: ##setup: Generate every .env file (run this first)
	@node scripts/dev/setup.mjs

doctor: ##setup: Check Docker, ports and required tooling
	@node scripts/dev/doctor.mjs

kalshi-key: ##setup: Pull the Kalshi key from the cluster (needs kubectl)
	@bash scripts/dev/pull-kalshi-key.sh
	@node scripts/dev/setup.mjs --predictions-only

# ── Run ──────────────────────────────────────────────────────────────
up: ##run: Start the backend, wait until healthy (svc= for a subset)
	@node scripts/dev/doctor.mjs --quiet
	@echo "[up] infrastructure..."
	@$(COMPOSE) up -d --wait postgres redis
	@if [ -n "$(svc)" ]; then \
	  echo "[up] $(svc) only (compose pulls in what it depends on)..."; \
	  $(COMPOSE_AUTO) up -d --build $(svc); \
	else \
	  if [ -f secrets/predictions.docker.env ]; then \
	    echo "[up] all services (incl. predictions)..."; \
	  else \
	    echo "[up] all services (predictions off - run 'make kalshi-key' to enable)..."; \
	  fi; \
	  $(COMPOSE_AUTO) up -d --build --remove-orphans; \
	fi
	@bash scripts/dev/wait-healthy.sh

down: ##run: Stop the backend (keeps your database)
	@$(COMPOSE_PRED) down

restart: down up ##run: Stop and start again

dev: up ##run: Backend, then web + desktop in their own windows
	@bash scripts/dev/launch-frontends.sh

web: ##run: Marketing site only, natively (Vite :3000)
	@cd myscrollr.com && npm run dev

desktop: ##run: Desktop app only, natively (Tauri)
	@cd desktop && npm run tauri:dev

# ── Iterate ──────────────────────────────────────────────────────────
# Editing Go/Rust source needs NO command here — the containers watch and
# rebuild. `rebuild` is for dependency changes (go.mod, Cargo.toml).
rebuild: ##iterate: Rebuild images after a dependency change (svc= for one)
	@$(COMPOSE_AUTO) build $(svc)
	@$(COMPOSE_AUTO) up -d --remove-orphans $(svc)

logs: ##iterate: Tail logs, all or one with svc=core-api
	@$(COMPOSE_AUTO) logs -f --tail=80 $(svc)

ps: ##iterate: Show what's running
	@$(COMPOSE_AUTO) ps

shell: ##iterate: Open a shell in a service, svc=core-api
	@test -n "$(svc)" || { echo "usage: make shell svc=core-api"; exit 1; }
	@$(COMPOSE_AUTO) exec $(svc) sh

# ── Reset ────────────────────────────────────────────────────────────
reset: ##reset: Stop and wipe the database, Redis and build caches
	@$(COMPOSE_PRED) down -v

check: ##reset: Run the test suites that can run locally
	@echo "-- desktop --"       && cd desktop        && npm test --silent
	@echo "-- myscrollr.com --" && cd myscrollr.com  && npm test --silent
	@echo "note: Go and Rust suites run in CI, no local toolchain needed."

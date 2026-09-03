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

# ── Shell ────────────────────────────────────────────────────────────
# On Windows, make defaults to cmd.exe, which cannot parse the POSIX tests
# in the recipes below (`[ -f ... ]`, if/fi). Force a real shell.
#
# It has to be Git Bash by absolute path, NOT plain `bash`: on Windows
# `bash` resolves to the WSL launcher stub in WindowsApps, which
# fails outright when WSL has no distro installed (the recommended
# `wsl --install --no-distribution` leaves it that way). The failure looks
# nothing like a shell problem.
ifeq ($(OS),Windows_NT)
  SHELL := C:/Program Files/Git/bin/bash.exe
else
  SHELL := /bin/bash
endif

# docker/compose.override.yml is layered in automatically when it exists.
# Compose only auto-discovers an override next to the default compose.yml,
# and passing -f opts out of that discovery entirely — so name it
# explicitly. Gitignored and per-machine: host port remaps when something
# else already owns 5432/6379, extra mounts, whatever your box needs.
COMPOSE_OVERRIDE := $(wildcard docker/compose.override.yml)
COMPOSE      := docker compose -f docker/compose.yml $(if $(COMPOSE_OVERRIDE),-f $(COMPOSE_OVERRIDE))
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
	@node scripts/dev/help.mjs

# ── Setup ────────────────────────────────────────────────────────────
setup: ##setup: Generate every .env file (run this first)
	@node scripts/dev/setup.mjs

doctor: ##setup: Check Docker, ports and required tooling
	@node scripts/dev/doctor.mjs

# Predictions is optional and the cluster credential is a LIVE, real-money
# Kalshi key, so this refuses to copy it unless you ask for it by name:
# `make kalshi-key prod=1`. `make seed` gives you a working app without any
# upstream credential.
kalshi-key: ##setup: Pull the Kalshi key from the cluster (prod=1 to confirm; needs kubectl)
	@$(SHELL) scripts/dev/pull-kalshi-key.sh $(if $(prod),--prod)
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
	@$(SHELL) scripts/dev/wait-healthy.sh
	@$(COMPOSE) exec -T postgres psql -U scrollr -d scrollr -At -c "SELECT count(*) FROM trades" 2>/dev/null | grep -qx 0 && echo "[hint] no data yet - run 'make seed' to load the dev dataset." || true

# COMPOSE_AUTO, not COMPOSE_PRED: naming the predictions profile makes
# compose resolve that service, and it fails outright on the missing
# secrets/predictions.docker.env when you have no Kalshi key. That left a
# fresh checkout able to start the stack but not stop it. --remove-orphans
# still clears a predictions container left over from a run that did have
# a key.
down: ##run: Stop the backend (keeps your database)
	@$(COMPOSE_AUTO) down --remove-orphans

restart: down up ##run: Stop and start again

# ── Data ─────────────────────────────────────────────────────────────
# Local dev runs with every upstream API key blank, so the ingesters stay up
# and serve whatever is in Postgres — which on a fresh clone is nothing. This
# loads a committed snapshot instead of making anyone paste a production key
# to see a working app. See scripts/dev/seed.sh.
seed: ##run: Load the committed dev dataset (makes no API calls)
	@$(SHELL) scripts/dev/seed.sh load

seed-capture: ##setup: Re-record the dev dataset from SOURCE_DATABASE_URL
	@$(SHELL) scripts/dev/seed.sh capture

# Production's database is on DigitalOcean's PRIVATE endpoint and cannot be
# reached from a laptop, so this runs psql in a throwaway pod inside the
# cluster and streams the result back. Read-only, content tables only.
seed-capture-prod: ##setup: Re-record the dev dataset from PRODUCTION (needs kubectl)
	@$(SHELL) scripts/dev/seed.sh capture --from-cluster

dev: up ##run: Backend, then web + desktop in their own windows
	@$(SHELL) scripts/dev/launch-frontends.sh

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
	@$(COMPOSE_AUTO) down -v --remove-orphans

check: ##reset: Run the test suites that can run locally
	@echo "-- desktop --"       && cd desktop        && npm test --silent
	@echo "-- myscrollr.com --" && cd myscrollr.com  && npm test --silent
	@echo "note: Go and Rust suites run in CI, no local toolchain needed."

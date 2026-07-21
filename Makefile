# MyScrollr — local dev orchestration.
#
#   make up        Build + start the whole backend in Docker (Postgres, Redis,
#                  Core API, and every channel), then wait until it's healthy.
#   make down      Stop the backend (keeps your local database).
#   make web       Run the marketing site natively (Vite :3000).
#   make desktop   Run the Tauri desktop app natively.
#   make dev       make up, then open web + desktop in their own windows.
#
# The desktop app + website stay NATIVE on purpose — a GUI window can't run
# inside a Linux container, and both hot-reload better on the host. The
# backend runs in Docker so start/stop is one clean command. See LOCAL_SETUP.md.

COMPOSE      := docker compose -f docker-compose.dev.yml
COMPOSE_PRED := docker compose -f docker-compose.dev.yml --profile predictions

.DEFAULT_GOAL := help
.PHONY: help up down restart rebuild logs ps clean prep kalshi-key web desktop dev doctor

help: ## Show this help
	@awk 'BEGIN{FS=":.*## "} /^[a-zA-Z_-]+:.*## /{printf "  \033[36m%-11s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

doctor: ## Check that Docker is running
	@docker info >/dev/null 2>&1 && echo "Docker: ok" || { echo "Docker isn't running — start Docker Desktop first."; exit 1; }

up: doctor prep ## Build + start the full backend in Docker, wait for health
	@echo "[up] Postgres + Redis..."
	@$(COMPOSE) up -d --wait postgres redis
	@if [ -f secrets/predictions.docker.env ]; then \
	  echo "[up] building all services (incl. predictions)..."; \
	  $(COMPOSE_PRED) up -d --build --remove-orphans; \
	else \
	  echo "[up] predictions skipped (no Kalshi key — run 'make kalshi-key' to enable); building the rest..."; \
	  $(COMPOSE) up -d --build --remove-orphans; \
	fi
	@bash scripts/dev/wait-healthy.sh

down: ## Stop the backend (keeps data)
	@$(COMPOSE_PRED) down

restart: down up ## Restart the backend

rebuild: doctor prep ## Force a clean image rebuild (after backend changes), then start
	@if [ -f secrets/predictions.docker.env ]; then C="$(COMPOSE_PRED)"; else C="$(COMPOSE)"; fi; \
	 $$C build --no-cache
	@$(MAKE) up

logs: ## Tail logs — all, or one service: make logs svc=core-api
	@$(COMPOSE_PRED) logs -f --tail=80 $(svc)

ps: ## Show container status
	@$(COMPOSE_PRED) ps

clean: ## Stop the backend AND wipe the database + redis volumes
	@$(COMPOSE_PRED) down -v

prep: ## (Re)generate the predictions Kalshi secret files for Docker
	@node scripts/dev/prepare-predictions-secrets.mjs

kalshi-key: ## Pull the Kalshi key from scrollr-secrets (needs kubectl + cluster)
	@bash scripts/dev/pull-kalshi-key.sh

web: ## Run the marketing site natively (Vite :3000)
	@cd myscrollr.com && npm run dev

desktop: ## Run the Tauri desktop app natively
	@cd desktop && npm run tauri:dev

dev: up ## Start the backend, then open web + desktop in their own windows
	@bash scripts/dev/launch-frontends.sh

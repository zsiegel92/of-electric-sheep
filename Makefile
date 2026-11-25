.PHONY: install env db db-stop db-generate db-migrate db-hash db-copy-data generate \
	dev dev-backend dev-frontend dev-modal-serve dev-frontend-deployed-backend \
	build start deploy deploy-python check test-integration favicon

PYTHON = uv run --locked
MODAL = $(PYTHON) --extra modal

install:
	uv sync --locked --extra modal
	pnpm install --frozen-lockfile

env:
	node scripts/env.ts

db: env
	sh scripts/db/init-local-postgres.sh

db-stop:
	pg_ctl -D .local/postgres -m fast -w stop

db-generate:
	$(PYTHON) python -m backend.migrate diff "$(or $(NAME),schema)"

db-migrate:
	$(PYTHON) python -m backend.migrate apply

db-hash:
	$(PYTHON) python -m backend.migrate hash

db-copy-data: db-migrate
	$(PYTHON) python -m backend.copy_data

generate:
	$(PYTHON) python -m backend.openapi --client

dev: db generate
	$(MAKE) db-migrate
	pnpm exec concurrently --kill-others --names api,web "$(MAKE) dev-backend" "$(MAKE) dev-frontend"

dev-backend:
	$(PYTHON) uvicorn backend.main:app --host 127.0.0.1 --port 8080 --reload --reload-dir backend

dev-frontend:
	pnpm dev:frontend

dev-modal-serve:
	pnpm exec concurrently --kill-others --names modal,web "$(MODAL) modal serve modal_app.py" "pnpm dev:frontend --mode modal-serve"

dev-frontend-deployed-backend:
	pnpm dev:frontend --mode deployed-backend

build: generate
	pnpm build

start:
	$(PYTHON) uvicorn backend.main:app --host 127.0.0.1 --port 8080

deploy-python:
	$(MODAL) modal deploy modal_app.py

deploy: build
	SHEEP_FULL_STACK=1 $(MODAL) modal deploy modal_app.py

check: build
	$(PYTHON) ruff check
	$(PYTHON) ruff format --check
	$(MODAL) pyright
	pnpm lint
	pnpm typecheck

test-integration:
	$(PYTHON) python -m unittest discover -s tests -v

favicon:
	pnpm favicon

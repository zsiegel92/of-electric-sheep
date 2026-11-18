.PHONY: install env db db-stop generate build dev backend backend-built vite modal-backend modal-full deploy check

install:
	uv sync --locked --extra modal
	pnpm install --frozen-lockfile

env:
	sh scripts/env.sh

db: env
	sh scripts/postgres.sh start

db-stop:
	sh scripts/postgres.sh stop

generate:
	uv run --locked python -m backend.openapi
	pnpm run generate

build: generate
	pnpm run build

dev: db
	$(MAKE) -j2 backend vite

backend:
	uv run --locked uvicorn backend.main:app --host 127.0.0.1 --port 8080 --reload

backend-built: build
	uv run --locked uvicorn backend.main:app --host 127.0.0.1 --port 8080

vite:
	pnpm run dev

modal-backend:
	uv run --locked --extra modal modal serve modal_app.py

modal-full: build
	SHEEP_FULL_STACK=1 uv run --locked --extra modal modal serve modal_app.py

deploy: build
	SHEEP_FULL_STACK=1 uv run --locked --extra modal modal deploy modal_app.py

check: generate
	uv run --locked python -m unittest discover -s tests
	uv run --locked ruff check
	uv run --locked ruff format --check
	uv run --locked --extra modal pyright
	pnpm run lint
	pnpm run typecheck

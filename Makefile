.PHONY: install env db db-stop dev build start check openapi db-generate db-migrate db-studio

install:
	pnpm install --frozen-lockfile

env:
	node scripts/env.ts

db: env
	sh scripts/postgres.sh start

db-stop:
	sh scripts/postgres.sh stop

dev: db
	$(MAKE) db-migrate
	pnpm dev

build:
	pnpm build

start:
	pnpm start

check:
	pnpm lint
	pnpm typecheck

openapi:
	@pnpm --silent openapi

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-studio:
	pnpm db:studio

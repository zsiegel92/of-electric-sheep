.PHONY: install env db db-stop dev build start check db-generate db-migrate db-studio

install:
	pnpm install --frozen-lockfile

env:
	node scripts/env.ts

db: env
	sh scripts/db/init-local-postgres.sh

db-stop:
	pg_ctl -D .local/postgres -m fast -w stop

dev: db
	pnpm dev

build:
	pnpm build

start:
	pnpm start

check:
	pnpm lint
	pnpm typecheck

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-studio:
	pnpm db:studio

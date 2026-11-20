# Of Electric Sheep

TanStack Start, Better Auth, oRPC, Drizzle/PostgreSQL, and Inngest.

## Local setup

Requires Node 24+, pnpm, and PostgreSQL command-line tools.

```sh
make install
make db
make db-migrate
make dev
```

This creates `.env`, starts local Postgres, and runs the app and Inngest.

- App: [localhost:5173](http://localhost:5173)
- API docs: [localhost:5173/api/docs](http://localhost:5173/api/docs)
- Inngest: [localhost:8288](http://localhost:8288)

Set the GitHub OAuth credentials and `TYPESAFE_API_KEY` in `.env`. The local GitHub callback URL is `http://localhost:5173/api/auth/callback/github`. Restart after changing environment variables.

Ctrl-C stops the app and Inngest. `make db-stop` stops Postgres.

## Code

- `src/lib/decisions/decide.ts`: app decision logic and pipeline selection.
- `src/lib/system-one/`: TypeSafe client, schemas, and request helpers.
- `src/lib/api-keys/`: API-key queries and schemas.
- `src/lib/auth.ts`: authentication.
- `src/lib/db/schema.ts`: database tables.
- `src/server/`: routes and server functions.
- `src/lib/inngest/functions/`: background jobs, registered in `src/routes/api.inngest.ts`.

Create an API key in the app and send it as `X-API-Key` to call System One. Decisions reuse per-user pipelines, which can point to a custom TypeSafe endpoint. Pipeline rows are created on first use; Inngest receives creation and usage events.

Optional Langfuse tracing uses `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL`. Traces include full requests, image attachments, decisions, and token usage. Fetch recent pipeline spans with `pnpm run script scripts/tail-spans-from-pipeline.ts <pipeline-id>`.

## Checks

```sh
make check
pnpm test:integration
pnpm test:systemone
```

`test:integration` exercises decision processing with local Postgres, a fake TypeSafe endpoint, and stubbed Inngest publishing. `test:systemone` calls the running app and live TypeSafe API.

After schema changes, use `make db-generate` and `make db-migrate`. `make db-studio` opens Drizzle Studio.

## Deploy

Build with `make build`; run with `make start`. Configure the variables in `.env.example`, apply migrations, and set `APP_URL` and the GitHub callback URL for your domain. Register `/api/inngest` with Inngest.

On Vercel, use Node 24 and `ENABLE_EXPERIMENTAL_COREPACK=1` for the pinned pnpm version.

# Of Electric Sheep

A Vite and TanStack Router frontend, a FastAPI backend, and PostgreSQL. Hey API generates the TypeScript client from FastAPI's OpenAPI schema.

## Local development

Install Node 24+, pnpm, uv, PostgreSQL command-line tools, and [Atlas](https://atlasgo.io/getting-started). The Atlas Community CLI is sufficient.

```sh
make install
make env
make dev
```

`make dev` starts the bundled Postgres instance when `DATABASE_URL` points to it, applies migrations, and runs Vite and Uvicorn with reload. Open [localhost:5173](http://localhost:5173). Vite proxies `/api` to FastAPI on port 8080. Ctrl-C stops Vite and Uvicorn. Use `make db-stop` to stop the bundled Postgres instance.

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_GITHUB_USER_IDS`, and `TYPESAFE_API_KEY` in `.env`. Register `http://localhost:5173/api/auth/callback/github` as a GitHub OAuth callback. Run `gh api user --jq .id` to get your account ID. The allowlist applies to sign-in, existing sessions, and API keys.

Run `make generate` after changing an API contract, and commit the regenerated client in `src/generated`. Use `make build` followed by `make start` to serve the production SPA and API together on port 8080. Add the port 8080 callback to GitHub if you sign in through that origin.

## Databases and migrations

```sh
make db-generate NAME=describe_the_change
make db-migrate
```

Atlas compares the SQLModel table metadata and the SQL in `schema/` against the schema obtained by replaying `migrations/`. It writes a versioned SQL file only when it finds a change. Generation creates and drops disposable databases on the bundled local Postgres instance. For a remote target, set `ATLAS_DEV_DATABASE_URL` in your shell to a separate development Postgres connection with `CREATEDB` access.

Add trigger and function changes in handwritten SQL migrations and update their definitions in `schema/`. Atlas Community diffs tables, indexes, and constraints. Run `make db-hash` after adding or editing a pending migration. Applied migrations should stay immutable.

To copy an existing Drizzle database, set `OLD_DATABASE_URL` to the source and `DATABASE_URL` to the destination, then run `make db-copy-data`. The command applies Atlas migrations first. If the destination already has the Drizzle baseline, it verifies the full schema before recording the Atlas baseline. The copy reads a consistent source snapshot, verifies the copied rows in the same target transaction, and skips identical rows on reruns. A conflicting row aborts the copy.

## Modal

Authenticate the Modal CLI in the environment you want to use. Create a Modal Secret named `of-electric-sheep`, or export `SHEEP_MODAL_SECRET_NAME` to select another secret. Configure a database URL reachable from Modal and apply Atlas migrations to that database before deploying. Supply the auth, GitHub, allowlist, and TypeSafe settings from `.env.example` in the secret.

- `make deploy-python` deploys the FastAPI backend.
- `make deploy` builds the frontend and deploys it alongside FastAPI at the same origin.
- `make dev-modal-serve` starts `modal serve` and Vite together. Set `SHEEP_MODAL_SERVE_URL` in `.env` or your shell. To get the URL the first time, run `uv run --locked --extra modal modal serve modal_app.py` and copy the endpoint it prints.
- `make dev-frontend-deployed-backend` starts Vite against the endpoint in `SHEEP_DEPLOYED_BACKEND_URL`. Set it in `.env` or your shell.

For either Vite workflow, include `http://localhost:5173` in the backend's `AUTH_ORIGINS` and register its callback with GitHub. For a hosted full stack, include the HTTPS site origin and register its `/api/auth/callback/github` callback. The deployment targets publish the same Modal app. Use a separate Modal environment to keep a development app and secret independent of production.

## API and traces

Open `/api/docs` after sign-in. TypeSafe SDK clients can use the app's `/api` base URL with an Of Electric Sheep API key. The SDK calls `GET /api/v1/models` and `POST /api/v1/systemone`. System One supports JSON, multipart images, and zstd encoding. `POST /api/system-one/decide-by-pipeline` replays a saved pipeline.

Pipeline definitions and traces are persisted directly in Postgres. The trace dashboard supports confidence sorting, annotations, and JSONL export. Run `uv run --locked python -m scripts.tail_traces <pipeline-id>` to read recent traces from the CLI. Configure the optional Langfuse settings in `.env.example` to export generations and show observability links.

## Checks

```sh
make check
make test-integration
```

The integration suite creates a disposable Atlas-migrated database and uses a stub TypeSafe endpoint. To run the live TypeSafe smoke test against the local app, add `system-one-smoke-test` to `ALLOWED_GITHUB_USER_IDS`, set `SYSTEM_ONE_TEST_API_KEY`, restart the app, and run `pnpm test:systemone`.

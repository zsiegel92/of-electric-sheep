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

Set the GitHub OAuth credentials, `ALLOWED_GITHUB_USER_IDS`, and `TYPESAFE_API_KEY` in `.env`. The local GitHub callback URL is `http://localhost:5173/api/auth/callback/github`. Restart after changing environment variables.

Run `gh api user --jq .id` while signed into GitHub and put the resulting account ID in `ALLOWED_GITHUB_USER_IDS`. Use commas to grant access to more accounts. An empty list blocks sign-in, existing sessions, and API keys. To open access later, remove `.refine(isAllowedGitHubUser)` from `authorizedGitHubId` in `src/lib/github-access.ts`.

Ctrl-C stops the app and Inngest. `make db-stop` stops Postgres.

## Code

- `src/lib/decisions/decide.ts`: app decision logic and pipeline selection.
- In `src/lib/decisions/`, `pipeline-definitions.ts` stores definitions, `pipeline-versions.ts` reads versions and updates display metadata, and `pipeline-groups.ts` handles evolution, question links, and promotion.
- `src/lib/system-one/`: TypeSafe client, schemas, and request helpers.
- `src/lib/api-keys/`: API-key queries and schemas.
- `src/lib/auth.ts`: Better Auth setup and session lookup.
- `src/start.ts`: TanStack request authentication and CSRF policy.
- `src/lib/db/schema.ts`: database tables.
- `src/routes/`: TanStack pages and HTTP entry points.
- `src/server/`: TanStack server functions. `src/server/api/` contains the oRPC procedures, OpenAPI and Swagger setup, and TypeSafe request adaptation.
- `src/lib/inngest/functions/`: background jobs, registered in `src/routes/api.inngest.ts`.

To use the TypeSafe SDK, set its base URL to your app's `/api` URL and use an Of Electric Sheep API key. The SDK calls `POST /api/v1/systemone` for decisions and `GET /api/v1/models` for models. Both endpoints accept `Authorization: Bearer <api-key>` and appear in Swagger. Decisions reuse per-user pipelines, which can point to a custom TypeSafe endpoint. Pipeline rows are created on first use; Inngest receives creation and usage events.

Inngest saves decision traces to Postgres after each run. The trace views query Postgres, including annotation filters and confidence sorting. Fetch recent traces with `pnpm run script scripts/tail-spans-from-pipeline.ts <pipeline-id>`.

Optional Langfuse export uses `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL`. Set `LANGFUSE_PROJECT_ID` to include observability links on new trace records. Postgres traces contain the decision input state, answers, and usage. Raw image attachments still go to Langfuse when export is configured. If a trace exceeds the Inngest event size limit, Postgres keeps the trace metadata and marks the omitted payload.

## Checks

```sh
make check
pnpm test:integration
pnpm test:systemone
```

`test:integration` exercises decision processing with local Postgres, a fake TypeSafe endpoint, and stubbed Inngest publishing. `test:systemone` calls the running app and live TypeSafe API. Add `system-one-smoke-test` to your local `ALLOWED_GITHUB_USER_IDS` for that test.

After schema changes, use `make db-generate` and `make db-migrate`. `make db-studio` opens Drizzle Studio.

The database baseline is in `drizzle/0000_initial.sql`. `drizzle/0001_pipeline-invariants.sql` adds the answer-shape function, deferred constraints, and triggers that enforce pipeline immutability and complete question links. If your local database used the earlier migration history, point `DATABASE_URL` at a fresh database before running `make db-migrate`.

## Deploy to Vercel

1. Create a fresh Neon database. Use the pooled connection string for the deployed app. Run the checked-in migrations once against Neon's direct connection string from this checkout. `pnpm db:migrate` also applies future migrations.

   ```sh
   DATABASE_URL='<Neon direct connection string>' pnpm db:migrate
   ```

2. Import the Git repo into Vercel and select Node.js 24. Keep the default TanStack Start build settings. Pick a stable production domain. In your GitHub OAuth app, add `https://<domain>/api/auth/callback/github` as an authorized callback URL, or register a separate OAuth app for production.

3. Set the following Production environment variables in Vercel before deploying.

   | Variable                                   | Value                                       |
   | ------------------------------------------ | ------------------------------------------- |
   | `ENABLE_EXPERIMENTAL_COREPACK`             | `1` to use the pinned pnpm version          |
   | `DATABASE_URL`                             | Neon pooled connection string               |
   | `APP_URL`                                  | `https://<domain>`                          |
   | `AUTH_SECRET`                              | Generate with `openssl rand -hex 32`        |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Production GitHub OAuth app credentials     |
   | `ALLOWED_GITHUB_USER_IDS`                  | Your GitHub account ID                      |
   | `TYPESAFE_API_KEY`                         | Your TypeSafe API key                       |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Keys for the production Inngest environment |

4. Deploy and sync `https://<domain>/api/inngest` in Inngest. The Inngest Vercel integration can set the two Inngest keys and sync automatically. The sync endpoint must be reachable by Inngest, with Inngest's own request signing enabled. Sign in, run a test decision, and check that its trace appears.

Vercel applies environment variable changes on the next deployment. Langfuse is optional. The corresponding variables are in `.env.example`.

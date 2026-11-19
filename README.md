# Of Electric Sheep

One TanStack Start app with Better Auth, oRPC, and Drizzle/PostgreSQL.

## Run locally

Use Node 24+, pnpm, and the PostgreSQL command-line tools.

```sh
make install
make dev
```

Open [localhost:5173](http://localhost:5173). `make dev` creates `.env` if needed, starts local PostgreSQL on port 54873, and runs Vite and the Inngest dev server together. Apply migrations explicitly with `make db-migrate`. Ctrl-C stops Vite and Inngest. Use `make db-stop` to stop PostgreSQL.

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`, then restart the app. Register **`http://localhost:5173/api/auth/callback/github`** as a redirect URI on your GitHub OAuth App. The callback path changed in the migration to TanStack Start. `APP_URL` defaults to `http://localhost:5173`.

## System One smoke test

With `make dev` running, migrations applied, and `TYPESAFE_API_KEY` configured, run `pnpm test:systemone`. It upserts a local test user and API key, then sends one live decision request with yes/no, choice, and score questions. Run `pnpm run script scripts/ensure-test-user.ts` to seed the fixture on its own.

## Background jobs

Signing in with GitHub sends `auth/user.signed-in`. Open [the local Inngest dashboard](http://localhost:8288) to see the `ack-user-sign-in` run and its GitHub ID. Register additional functions in `src/routes/api.inngest.ts`.

For deployment, configure `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and sync the app's `/api/inngest` endpoint with Inngest. For self-hosting, also set `INNGEST_BASE_URL` to your Inngest server. Local dev mode is enabled by the dev command.

## Find your way around

| File                      | What to change                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `src/routes/`             | Start pages and the two catch-all routes for Better Auth and oRPC |
| `src/start.ts`            | The global sign-in policy and request middleware                  |
| `src/server/auth.ts`      | Better Auth configuration, typed `User` and `requireUser`         |
| `src/routes/api.$.ts`     | oRPC router registry and Swagger setup                            |
| `src/server/functions.ts` | Start server functions for identity and API-key management        |
| `src/lib/db/schema.ts`    | Drizzle table definitions                                         |

Add a procedure with `.route()`, `.input()`, `.output()`, and `.handler()`. oRPC validates inputs and outputs at runtime and derives the handler types and OpenAPI spec from the Zod schemas. Procedures get the authenticated user through `context.user`. The Start server functions for API keys pass along that same request context.

Sign in and open `/api/docs` for Swagger UI or `/api/openapi.json` for the live spec. The root loader calls `getCurrentUser` to read the signed-in user from Start’s request context.

Better Auth stores the session in a signed HttpOnly JWT cookie. The database schema can use the stable `githubId` claim to key application data. To add a claim, update `userSchema` and populate it in `mapProfileToUser` in `src/server/auth.ts`. The Zod schema supplies Better Auth’s additional field definitions and validators.

## System One decisions

Sign in and use **API keys** in the navbar to create, list, or revoke keys. Use **Copy** in the one-time display to save the full secret. PostgreSQL stores its hash and a display prefix. The **API keys** section in Swagger exposes key creation, reads, and revocation at `/api/api-keys`. REST clients managing keys send their session cookies and, for writes, an `Origin` header matching the app origin.

Send an OfElectricSheep key in the `X-API-Key` header to call System One without a browser session. The System One procedure middleware resolves the key's owner before sending the request to TypeSafe. Configure the upstream `TYPESAFE_BASE_URL` and `TYPESAFE_API_KEY` on the server. In Swagger, use **Authorize** to set the OfElectricSheep key.

Server functions can call `decideWithAiSdk({ model, state, questions })` from `src/lib/system-one/system-one-ai-sdk-client.ts` with a configured AI SDK decision model. The adapter maps SDK answers to the existing System One schema and uses TypeSafe metadata for choice and score confidence and score rubrics.

- `GET /api/system-one/models` lists available Jev models and aliases.
- `POST /api/system-one` evaluates named yes/no, choice, score, or bounding-box questions. It accepts JSON with inline images or multipart with a JSON `request` part and named image files.

The **System One · TypeSafe** section in `/api/docs` shows request examples and the two optional capability headers. `src/server/system-one/router.ts` registers the procedures and applies API-key auth. The decision procedure and its TypeSafe HTTP call live together in `src/lib/system-one/system-one-api-client.ts`. [TypeSafe API reference](https://api.typesafe.ai/docs)

## Database and production

- `make db-generate` generates and snapshots a migration after a schema change.
- `make db-migrate` applies migrations to `DATABASE_URL`.
- `make db-studio` opens Drizzle Studio.
- `make check` runs Biome and strict TypeScript.

Build with `make build` and run `PORT=5173 make start` to try the Node production build locally. For deployment, serve `.output/server/index.mjs`, apply migrations to the target database, and set `APP_URL` to the public HTTPS origin. Supply `DATABASE_URL`, `AUTH_SECRET`, and the GitHub credentials via your host's environment, and register `<APP_URL>/api/auth/callback/github` with GitHub.

### Vercel

Import the repo as a TanStack Start project and select Node.js 24.x. The existing Nitro plugin produces the Vercel Functions and static assets. Use the default build settings and set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in `package.json`. [Vercel's TanStack Start guide](https://vercel.com/docs/frameworks/full-stack/tanstack-start) · [Corepack setup](https://vercel.com/docs/builds/configure-a-build#corepack)

Set `APP_URL`, `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a hosted PostgreSQL `DATABASE_URL` in the project environment. Use a pooled connection string if your provider supplies one. Apply migrations separately with `make db-migrate` targeting that database. For preview sign-in, use a stable preview domain and register its exact `/api/auth/callback/github` URL too.

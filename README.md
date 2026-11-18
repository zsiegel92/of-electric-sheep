# Of Electric Sheep

One TanStack Start app with Better Auth, oRPC, and Drizzle/PostgreSQL.

## Run locally

Use Node 24+, pnpm, OpenSSL, and the PostgreSQL command-line tools.

```sh
make install
make dev
```

Open [localhost:5173](http://localhost:5173). `make dev` creates `.env` if needed, starts local PostgreSQL on port 54873, applies migrations, and starts Vite. Use `make db-stop` to stop PostgreSQL.

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`, then restart the app. Register **`http://localhost:5173/api/auth/callback/github`** as a redirect URI on your GitHub OAuth App. The callback path changed in the migration to TanStack Start. `APP_URL` defaults to `http://localhost:5173`.

## Find your way around

| File                      | What to change                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `src/routes/`             | Start pages and the two catch-all routes for Better Auth and oRPC |
| `src/start.ts`            | The global sign-in policy and request middleware                  |
| `src/server/auth.ts`      | Better Auth configuration, typed `User` and `requireUser`         |
| `src/server/api.ts`       | oRPC procedures and their Zod contracts                           |
| `src/server/functions.ts` | Start server functions that call those same procedures            |
| `src/db/schema.ts`        | Drizzle table definitions                                         |

Add a procedure with `.route()`, `.input()`, `.output()`, and `.handler()`. oRPC validates inputs and outputs at runtime and derives the handler types and OpenAPI spec from the Zod schemas. Procedures get the authenticated user through `context.user`. The Start server functions bridge that same request context into oRPC with `requireUser(context.user)`.

Sign in and open `/api/docs` for Swagger UI or `/api/openapi.json` for the live spec. Use `make openapi > openapi.json` to export it without a server or database. The example profile form calls a Start server function, and `PATCH /api/profile` exposes the same operation through HTTP.

Better Auth stores the session in a signed HttpOnly JWT cookie. The database stores application data, keyed by the stable `githubId` claim. To add a claim, update `user.additionalFields`, `mapProfileToUser`, and `userSchema` in `src/server/auth.ts`.

## Database and production

- `make db-generate` generates and snapshots a migration after a schema change.
- `make db-migrate` applies migrations to `DATABASE_URL`.
- `make db-studio` opens Drizzle Studio.
- `make check` runs Biome and strict TypeScript.

Build with `make build` and run `PORT=5173 make start` to try the Node production build locally. For deployment, serve `.output/server/index.mjs`, apply migrations to the target database, and set `APP_URL` to the public HTTPS origin. Supply `DATABASE_URL`, `AUTH_SECRET`, and the GitHub credentials via your host's environment, and register `<APP_URL>/api/auth/callback/github` with GitHub.

### Vercel

Import the repo as a TanStack Start project and select Node.js 24.x. The existing Nitro plugin produces the Vercel Functions and static assets. Use the default build settings and set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in `package.json`. [Vercel's TanStack Start guide](https://vercel.com/docs/frameworks/full-stack/tanstack-start) · [Corepack setup](https://vercel.com/docs/builds/configure-a-build#corepack)

Set `APP_URL`, `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a hosted PostgreSQL `DATABASE_URL` in the project environment. Use a pooled connection string if your provider supplies one. Apply migrations separately with `make db-migrate` targeting that database. For preview sign-in, use a stable preview domain and register its exact `/api/auth/callback/github` URL too.

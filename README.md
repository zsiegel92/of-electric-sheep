# Of Electric Sheep

FastAPI handles GitHub OAuth and serves the application and Vite build. PostgreSQL is available to application routes.

## Local development

Use Node 24+, pnpm, uv, OpenSSL, and PostgreSQL command-line tools.

```sh
make install
make dev
```

`make dev` creates local settings if needed, starts PostgreSQL, and runs FastAPI and Vite concurrently. Visit [localhost:5173](http://localhost:5173). Vite proxies `/api` and `/auth` to FastAPI on port 8080. Press Ctrl+C to stop both servers. Use `make db-stop` to stop PostgreSQL.

Run `make backend` or `make vite` to start the servers individually. To try the production build locally, stop the dev servers and run `make backend-built`, then visit [localhost:8080](http://localhost:8080).

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env` before signing in. Add both `http://localhost:5173/auth/callback/github` and `http://localhost:8080/auth/callback/github` as redirect URIs on the same GitHub OAuth App, with wildcard matching disabled. [GitHub supports multiple redirect URIs per OAuth App.](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/)

## Authentication

The public `/auth` gateway handles sign-in, the OAuth callback, and sign-out. The app-wide `Depends(require_auth)` protects API routes and the built frontend. Use `Annotated[User, Depends(get_user)]` to inject the verified user. FastAPI issues the signed session JWT in an HttpOnly cookie with a one-hour lifetime. Signing out clears the browser cookies.

Add custom claims to `User` in `backend/auth.py` and populate them in `github_user` in `backend/oauth.py`. The JWT includes the validated user model. User IDs come from GitHub's stable account ID, and sign-in requires a verified primary GitHub email.

Run `make generate` after changing an API route. It exports FastAPI's OpenAPI schema and regenerates the Zod validators, inferred types, SDK, and React Query hooks under `web/src/generated`. Run `make check` for the OAuth session integration test and Ruff, Pyright, Biome, and TypeScript checks. TypeScript 7.1 beta checks the app, and Hey API uses the TypeScript 6 API to generate its client.

## Modal

Create a Modal secret named `of-electric-sheep` in each environment with `AUTH_SECRET`, `DATABASE_URL`, `AUTH_ORIGINS` (a JSON array of exact HTTPS origins), and the two GitHub OAuth values. Use a database reachable from Modal and register `<app-origin>/auth/callback/github` with GitHub. For `modal serve`, use the development URL printed by Modal as the origin.

- `make modal-backend` serves FastAPI on Modal.
- `make modal-full` builds Vite locally and serves the full stack on Modal.
- `make deploy` deploys the full stack. Use the target Modal environment via `MODAL_ENVIRONMENT`.

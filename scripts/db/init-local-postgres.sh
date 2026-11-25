#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

database=$(node --env-file-if-exists=.env <<'JS'
const url = new URL(process.env.DATABASE_URL);
if (['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.port === '54873' && url.username === 'sheep') {
  process.stdout.write(decodeURIComponent(url.pathname.slice(1)));
}
JS
)
# A separately managed Postgres instance uses DATABASE_URL directly.
[ -n "$database" ] || exit 0

data=.local/postgres
if [ ! -f "$data/PG_VERSION" ]; then
  umask 077
  mkdir -p .local
  pwfile=$(mktemp .local/password.XXXXXX)
  trap 'rm -f "$pwfile"' EXIT HUP INT TERM
  node --env-file-if-exists=.env > "$pwfile" <<'JS'
const password = decodeURIComponent(new URL(process.env.DATABASE_URL).password);
if (!password || /[\r\n]/.test(password)) {
  throw new Error("DATABASE_URL must contain a single-line Postgres password");
}
process.stdout.write(password + "\n");
JS
  initdb -D "$data" -U sheep --auth-local=trust --auth-host=scram-sha-256 --pwfile="$pwfile"
fi

sh scripts/db/start-local-postgres.sh

if ! PGDATABASE="$database" psql -X -h "$PWD/.local" -p 54873 -U sheep -Atc 'SELECT 1' >/dev/null 2>&1; then
  createdb -h "$PWD/.local" -p 54873 -U sheep -- "$database"
fi

#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

data=.local/postgres
if [ ! -f "$data/PG_VERSION" ]; then
  umask 077
  mkdir -p .local
  pwfile=$(mktemp .local/password.XXXXXX)
  trap 'rm -f "$pwfile"' EXIT HUP INT TERM
  node > "$pwfile" <<'JS'
const { readFileSync } = require("node:fs");
const { parseEnv } = require("node:util");

const { DATABASE_URL } = parseEnv(readFileSync(".env", "utf8"));
const password = decodeURIComponent(new URL(DATABASE_URL).password);
if (!password || /[\r\n]/.test(password)) {
  throw new Error("DATABASE_URL must contain a single-line Postgres password");
}
process.stdout.write(password + "\n");
JS
  initdb -D "$data" -U sheep --auth-local=trust --auth-host=scram-sha-256 --pwfile="$pwfile"
  rm -f "$pwfile"
  trap - EXIT HUP INT TERM
fi

sh scripts/db/start-local-postgres.sh

database_exists=$(psql -X -h "$PWD/.local" -p 54873 -U sheep -d postgres -Atc \
  "select 1 from pg_database where datname = 'of_electric_sheep'")
if [ "$database_exists" != 1 ]; then
  createdb -h "$PWD/.local" -p 54873 -U sheep of_electric_sheep
fi

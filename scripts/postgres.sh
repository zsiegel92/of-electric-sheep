#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
data="$PWD/.local/postgres"

case "${1:-}" in
  start)
    umask 077
    mkdir -p .local
    if [ ! -f "$data/PG_VERSION" ]; then
      # Read the password from the generated local URL without printing it.
      url=$(sed -n 's/^DATABASE_URL=postgresql:\/\/sheep:\([0-9a-f]*\)@127\.0\.0\.1:54873\/of_electric_sheep$/\1/p' .env)
      test -n "$url"
      pwfile=$(mktemp "$PWD/.local/password.XXXXXX")
      trap 'rm -f "$pwfile"' EXIT HUP INT TERM
      printf '%s\n' "$url" > "$pwfile"
      initdb -D "$data" -U sheep --auth-local=trust --auth-host=scram-sha-256 --pwfile="$pwfile"
    fi
    if ! pg_ctl -D "$data" status >/dev/null; then
      pg_ctl -D "$data" -l "$PWD/.local/postgres.log" -o "-h 127.0.0.1 -p 54873 -k \"$PWD/.local\"" -w start
    fi
    if [ "$(psql -h "$PWD/.local" -p 54873 -U sheep -d postgres -Atc "select 1 from pg_database where datname = 'of_electric_sheep'")" != 1 ]; then
      createdb -h "$PWD/.local" -p 54873 -U sheep of_electric_sheep
    fi
    ;;
  stop)
    pg_ctl -D "$data" -m fast -w stop
    ;;
  *)
    printf 'Usage: %s start|stop\n' "$0" >&2
    exit 2
    ;;
esac

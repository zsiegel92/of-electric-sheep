#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."

data=.local/postgres
if ! pg_ctl -D "$data" status >/dev/null; then
  pg_ctl -D "$data" -l .local/postgres.log -o "-h 127.0.0.1 -p 54873 -k \"$PWD/.local\"" -w start
fi

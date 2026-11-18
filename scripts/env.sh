#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
if [ -e .env ]; then
  exit 0
fi

auth_secret=$(openssl rand -hex 32)
db_password=$(openssl rand -hex 24)
set -C
{
  printf '# Generated with openssl rand -hex 32\nAUTH_SECRET=%s\n' "$auth_secret"
  printf '# Database password generated with openssl rand -hex 24\nDATABASE_URL=postgresql://sheep:%s@127.0.0.1:54873/of_electric_sheep\n' "$db_password"
  tail -n 3 .env.example
} > .env

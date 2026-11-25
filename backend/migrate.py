"""Run Atlas against Postgres using a disposable database for schema generation."""

import argparse
import os
import re
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg import conninfo, sql

from backend.schema_sql import schema_sql
from backend.settings import settings

BASELINE = "0004"
BASELINE_COUNT = "5"


def atlas(*args, url="", dev_url="", schema=""):
    env = {
        **os.environ,
        "SHEEP_ATLAS_DATABASE": url,
        "SHEEP_ATLAS_DEV": dev_url,
        "SHEEP_ATLAS_SCHEMA": schema,
    }
    subprocess.run([env.get("ATLAS", "atlas"), *args], env=env, check=True)


def with_search_path(url: str) -> str:
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query))
    query["search_path"] = "public"
    return urlunsplit(parsed._replace(query=urlencode(query)))


@contextmanager
def dev_database() -> Iterator[str]:
    url = os.environ.get("ATLAS_DEV_DATABASE_URL", "")
    if not url:
        url = settings().database_url
        if urlsplit(url).hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise SystemExit(
                "Set ATLAS_DEV_DATABASE_URL to a scratch Postgres server with CREATEDB access."
            )
    name = f"sheep_atlas_{uuid4().hex}"
    with psycopg.connect(url, autocommit=True) as db:
        db.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        try:
            yield urlunsplit(urlsplit(url)._replace(path=f"/{name}"))
        finally:
            db.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


def schema_dump(url):
    parts = conninfo.conninfo_to_dict(url)
    pg_env = {f"PG{key.upper()}": str(value) for key, value in parts.items()}
    pg_env["PGDATABASE"] = str(parts["dbname"])
    dump = subprocess.check_output(
        [
            "pg_dump",
            "--schema-only",
            "--schema=public",
            "--no-owner",
            "--no-privileges",
            "--exclude-table=public.atlas_schema_revisions",
        ],
        env={**os.environ, **pg_env},
        text=True,
    )
    dump = re.sub(
        r"^(?:\\(?:un)?restrict |-- Dumped (?:from|by) ).*\n",
        "",
        dump,
        flags=re.MULTILINE,
    )
    return re.sub(
        r"(^CREATE TABLE [^\n]+ \(\n)(.*?)(^\);)",
        lambda match: (
            match[1]
            + ",\n".join(sorted(line.rstrip(",") for line in match[2].splitlines()))
            + "\n"
            + match[3]
        ),
        dump,
        flags=re.MULTILINE | re.DOTALL,
    )


def apply():
    url = settings().database_url
    if not url:
        raise SystemExit("Set DATABASE_URL first.")
    with psycopg.connect(url) as db:
        ((drizzle, revisions),) = db.execute(
            """SELECT to_regclass('drizzle.__drizzle_migrations'),
                      to_regclass('public.atlas_schema_revisions')"""
        ).fetchall()
    args = ["migrate", "apply", "--env", "sqlmodel"]
    if drizzle and not revisions:
        with dev_database() as scratch:
            atlas(*args, BASELINE_COUNT, url=with_search_path(scratch))
            if schema_dump(url) != schema_dump(scratch):
                raise SystemExit(
                    "DATABASE_URL does not match the Drizzle baseline. Atlas adoption stopped."
                )
        args.extend(["--baseline", BASELINE])
    atlas(*args, url=with_search_path(url))


def diff(name):
    # Community Atlas inspects table changes, while Postgres loads the handwritten
    # functions required by generated columns and installs trigger dependencies.
    with dev_database() as scratch, dev_database() as desired:
        with psycopg.connect(desired) as db:
            # SQLModel compiles this SQL from source-controlled metadata and SQL.
            ddl = sql.SQL(schema_sql())  # pyright: ignore[reportArgumentType]
            db.execute(ddl)
        atlas(
            "migrate",
            "diff",
            name,
            "--env",
            "sqlmodel",
            dev_url=with_search_path(scratch),
            schema=with_search_path(desired),
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["apply", "diff", "hash"])
    parser.add_argument("name", nargs="?", default="schema")
    args = parser.parse_args()
    try:
        if args.action == "apply":
            apply()
        elif args.action == "hash":
            atlas("migrate", "hash", "--dir", "file://migrations")
        else:
            diff(args.name)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode) from None


if __name__ == "__main__":
    main()

"""Copy the old database into the Atlas-managed database in one transaction."""

import psycopg
from psycopg import sql

from backend.settings import settings

# Questions precede definitions because the definition seals its question set.
TABLES = {
    "users": ("github_id",),
    "api_keys": ("id",),
    "decision_pipelines": ("id",),
    "decision_pipeline_questions": ("pipeline_id", "name"),
    "decision_pipeline_definitions": ("pipeline_id",),
    "decision_question_links": ("pipeline_id", "name"),
    "pipeline_question_aliases": ("pipeline_id", "question_name"),
    "decision_traces": ("pipeline_id", "trace_id"),
    "decision_trace_annotations": ("pipeline_id", "trace_id", "question_name"),
}


def copy_table(source, target, name, keys):
    table = sql.Identifier("public", name)
    stage = sql.Identifier("pg_temp", name)
    target.execute(
        sql.SQL("CREATE TEMP TABLE {} ON COMMIT DROP AS TABLE {} WITH NO DATA").format(
            stage, table
        )
    )
    columns = target.execute(
        """SELECT attname, attgenerated FROM pg_attribute WHERE attrelid = %s::regclass
           AND attnum > 0 AND NOT attisdropped ORDER BY attnum""",
        (f"public.{name}",),
    ).fetchall()
    all_columns = sql.SQL(", ").join(sql.Identifier(column) for column, _ in columns)
    # COPY preserves timestamp precision and distinguishes SQL NULL from JSON null.
    copy = sql.SQL("COPY {} ({})").format
    with (
        source.cursor().copy(
            sql.SQL("COPY (SELECT {} FROM {}) TO STDOUT").format(all_columns, table)
        ) as reader,
        target.cursor().copy(
            copy(stage, all_columns) + sql.SQL(" FROM STDIN")
        ) as writer,
    ):
        for block in reader:
            writer.write(block)
    columns = sql.SQL(", ").join(
        sql.Identifier(column) for column, generated in columns if not generated
    )
    match = sql.SQL(" AND ").join(
        sql.SQL("existing.{0} = staged.{0}").format(sql.Identifier(key)) for key in keys
    )
    result = target.execute(
        sql.SQL("""INSERT INTO {table} ({columns})
            SELECT {columns} FROM {stage} staged
            WHERE NOT EXISTS (SELECT FROM {table} existing WHERE {match})""").format(
            table=table, columns=columns, stage=stage, match=match
        )
    )
    mismatch = target.execute(
        sql.SQL("SELECT EXISTS (TABLE {} EXCEPT TABLE {})").format(stage, table)
    ).fetchone()[0]
    if mismatch:
        raise RuntimeError(f"Row mismatch in {name}; the transaction will roll back")
    count = target.execute(sql.SQL("SELECT count(*) FROM {}").format(stage)).fetchone()[
        0
    ]
    return result.rowcount, count


def main():
    config = settings()
    if not config.old_database_url or not config.database_url:
        raise SystemExit("Set OLD_DATABASE_URL and DATABASE_URL first.")
    with (
        psycopg.connect(config.old_database_url) as source,
        psycopg.connect(config.database_url) as target,
    ):
        source.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        target.execute("SET LOCAL lock_timeout = '10s'")
        target.execute(
            sql.SQL("LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE").format(
                sql.SQL(", ").join(sql.Identifier("public", name) for name in TABLES)
            )
        )
        counts = {
            name: copy_table(source, target, name, keys)
            for name, keys in TABLES.items()
        }
    for name, (inserted, verified) in counts.items():
        print(f"{name}: {inserted} inserted, {verified} verified")


if __name__ == "__main__":
    main()

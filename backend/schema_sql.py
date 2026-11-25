from pathlib import Path

from sqlalchemy.dialects.postgresql import dialect
from sqlalchemy.schema import CreateIndex, CreateTable

from backend.schema import SQLModel  # Importing the schema registers its tables.


def schema_sql() -> str:
    overlay = Path(__file__).resolve().parents[1] / "schema"
    statements = [(overlay / "before-tables.sql").read_text()]
    for table in SQLModel.metadata.sorted_tables:
        statements.append(
            str(CreateTable(table).compile(dialect=dialect())).strip() + ";"
        )
        for index in sorted(table.indexes, key=lambda index: index.name or ""):
            statements.append(str(CreateIndex(index).compile(dialect=dialect())) + ";")
    statements.append((overlay / "after-tables.sql").read_text())
    return "\n".join(statements)

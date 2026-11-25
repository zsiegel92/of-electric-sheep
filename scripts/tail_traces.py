import argparse
import json
from uuid import UUID

from backend.db import pool
from backend.traces import trace_page


def main():
    parser = argparse.ArgumentParser(
        description="Print the latest stored traces for one pipeline."
    )
    parser.add_argument("pipeline_id", type=UUID)
    args = parser.parse_args()

    with pool() as connections, connections.connection() as db:
        owner = db.execute(
            "SELECT user_id FROM decision_pipelines WHERE id = %(pipeline_id)s",
            {"pipeline_id": args.pipeline_id},
        ).fetchone()
        traces = (
            trace_page(
                db, owner["user_id"], args.pipeline_id, None, None, "all", "recent"
            ).model_dump(mode="json")["traces"]
            if owner
            else []
        )
    print(json.dumps(traces, indent=2))


if __name__ == "__main__":
    main()

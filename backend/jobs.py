import json
import os

import inngest
from fastapi import FastAPI
from inngest.fast_api import serve

from backend.db import pool
from backend.traces import DecisionTraceRecord, store_trace

TRACE_COMPLETED = "decisions/trace.completed"
# Leave room for the event envelope on plans with a 256 KiB limit.
TRACE_EVENT_BUDGET = 255 * 1024

client = inngest.Inngest(app_id="of-electric-sheep")


def publish_trace(record: DecisionTraceRecord) -> None:
    for excluded in (set(), {"state"}, {"answers"}, {"state", "answers"}):
        data = record.model_dump(mode="json", exclude=excluded, exclude_none=True)
        if excluded:
            data["payloadTruncated"] = True
        if len(json.dumps(data).encode()) <= TRACE_EVENT_BUDGET:
            client.send_sync(
                inngest.Event(
                    name=TRACE_COMPLETED,
                    id=f"decision-trace-{record.traceId}",
                    data=data,
                )
            )
            return
    raise ValueError("Decision trace metadata exceeds the Inngest event size limit.")


def persist_trace(record: DecisionTraceRecord) -> None:
    with pool().connection() as db:
        store_trace(db, record)


@client.create_function(
    fn_id="store-decision-trace", trigger=inngest.TriggerEvent(event=TRACE_COMPLETED)
)
def store_decision_trace(ctx: inngest.ContextSync) -> None:
    record = DecisionTraceRecord.model_validate(ctx.event.data)
    ctx.step.run("store-trace", persist_trace, record)


worker_app = FastAPI(openapi_url=None)
# Schema generation can import the application without cloud credentials.
if not client.is_production or os.environ.get("INNGEST_SIGNING_KEY"):
    serve(worker_app, client, [store_decision_trace], enable_unauthed_sync=False)
router = worker_app.router

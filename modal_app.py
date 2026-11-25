import os
from pathlib import Path

import modal
from fastapi import FastAPI

APP_NAME = "of-electric-sheep"
FUNCTION_NAME = "asgi_entrypoint"

app = modal.App(APP_NAME)
image = (
    modal.Image.debian_slim(python_version="3.13")
    .uv_sync(extra_options="--no-dev")
    .add_local_python_source("backend")
)
if os.environ.get("SHEEP_FULL_STACK") == "1":
    dist = Path(__file__).resolve().parent / "build" / "web"
    if not (dist / "index.html").is_file():
        raise RuntimeError("Build the Vite frontend before serving the full stack")
    image = image.add_local_dir(dist, "/root/build/web")

secret_name = os.environ.get("SHEEP_MODAL_SECRET_NAME", APP_NAME)
inngest_secret_name = os.environ.get("SHEEP_INNGEST_SECRET_NAME", "inngest")


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name(secret_name),
        modal.Secret.from_name(
            inngest_secret_name,
            required_keys=["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
        ),
    ],
)
@modal.concurrent(max_inputs=12)
@modal.asgi_app()
def asgi_entrypoint() -> FastAPI:
    from backend.main import app as fastapi_app

    return fastapi_app

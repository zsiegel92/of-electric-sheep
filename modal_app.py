import os
from pathlib import Path

import modal
from fastapi import FastAPI

app = modal.App("of-electric-sheep")
image = (
    modal.Image.debian_slim(python_version="3.13")
    .uv_sync(extra_options="--no-dev")
    .add_local_python_source("backend")
    .add_local_file("backend/login.html", "/root/backend/login.html")
)
if os.environ.get("SHEEP_FULL_STACK") == "1":
    if not Path("build/web/index.html").is_file():
        raise RuntimeError("Build the Vite frontend before serving the full stack")
    image = image.add_local_dir("build/web", "/root/build/web")


@app.function(image=image, secrets=[modal.Secret.from_name("of-electric-sheep")])
@modal.asgi_app()  # pyright: ignore[reportUnknownMemberType]
def asgi_entrypoint() -> FastAPI:
    from backend.main import app as fastapi_app  # noqa: PLC0415 - load within the Modal container

    return fastapi_app

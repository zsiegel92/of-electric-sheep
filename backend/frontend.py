from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request


def keep_api_paths_out_of_frontend(request: Request) -> None:
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        raise HTTPException(404)


router = APIRouter(dependencies=[Depends(keep_api_paths_out_of_frontend)])
dist = Path(__file__).resolve().parents[1] / "build" / "web"
if (dist / "index.html").is_file():
    if (dist / "assets").is_dir():
        router.frontend("/assets", directory=dist / "assets", fallback=None)
    router.frontend("/", directory=dist, fallback="index.html")

from pathlib import Path

from fastapi import APIRouter

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "build/web"

router = APIRouter()
if (DIST / "index.html").is_file():
    router.frontend("/", directory=DIST, fallback=None)

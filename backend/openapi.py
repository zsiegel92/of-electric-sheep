import json
from pathlib import Path

from backend.main import app

if __name__ == "__main__":
    path = Path("build/openapi.json")
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")

import argparse
import fcntl
import json
import subprocess
from pathlib import Path

from backend.main import app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", action="store_true")
    args = parser.parse_args()
    path = Path("build/openapi.json")
    path.parent.mkdir(exist_ok=True)
    # Dev and build both generate into the same directory.
    with (path.parent / ".openapi.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
        if args.client:
            subprocess.run(["pnpm", "exec", "openapi-ts"], check=True)


if __name__ == "__main__":
    main()

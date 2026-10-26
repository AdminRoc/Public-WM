#!/usr/bin/env python3
"""Build a compact hash manifest for the four committed public WM data files."""
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
MANIFEST = DATA / "release-manifest.json"


def main():
    files = {}
    for name in ("wm-items.json", "wm-item-identities.json", "avg_prices_full.json", "auction-dicts.json"):
        path = DATA / name
        raw = path.read_bytes()
        json.loads(raw.decode("utf-8"))
        files[name] = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    identity = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    doc = {
        "schema_version": 1,
        "repository": "AdminRoc/Public-WM",
        "release_id": hashlib.sha256(identity).hexdigest(),
        "files": files,
    }
    MANIFEST.write_text(json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Built Public-WM release manifest release_id={doc['release_id']} files={len(files)}")


if __name__ == "__main__":
    main()

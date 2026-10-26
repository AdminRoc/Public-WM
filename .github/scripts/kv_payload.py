#!/usr/bin/env python3
"""Build bounded, read-back-verifiable payloads for the fixed WM KV keys."""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path

ALLOWED_KEYS = {
    "avg_prices_full_json",
    "auction_dicts_json",
    "wm_items_json",
}
WM_ITEMS_FORMAT = "wfspeed-gzip-json-v1"
MAX_STORED_VALUE_BYTES = 900_000
MAX_REQUEST_BODY_BYTES = 900_000
MIN_WM_ITEMS = 1500


def _validate_json(raw: bytes) -> object:
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("KV source is not valid UTF-8 JSON") from error


def _validate_items(document: object) -> list[dict]:
    items = document.get("data") if isinstance(document, dict) else document
    if not isinstance(items, list) or len(items) < MIN_WM_ITEMS:
        raise ValueError("WM item manifest is incomplete")
    ids: set[str] = set()
    slugs: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("WM item manifest contains an invalid row")
        item_id = str(item.get("id") or "").strip()
        slug = str(item.get("slug") or "").strip()
        if not item_id or not slug or item_id in ids or slug in slugs:
            raise ValueError("WM item manifest has missing or duplicate stable identity")
        ids.add(item_id)
        slugs.add(slug)
    return items


def _wrap_wm_items(raw: bytes, document: object) -> str:
    _validate_items(document)
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    wrapper = {
        "format": WM_ITEMS_FORMAT,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "uncompressedBytes": len(raw),
        "data": base64.b64encode(compressed).decode("ascii"),
    }
    return json.dumps(wrapper, ensure_ascii=True, separators=(",", ":"))


def build_payload(key: str, raw: bytes) -> bytes:
    if key not in ALLOWED_KEYS:
        raise ValueError("KV key is outside the fixed WM data allowlist")
    document = _validate_json(raw)
    value = _wrap_wm_items(raw, document) if key == "wm_items_json" else raw.decode("utf-8")
    value_bytes = value.encode("utf-8")
    if len(value_bytes) > MAX_STORED_VALUE_BYTES:
        raise ValueError("KV value exceeds the conservative 900000-byte limit")
    payload = json.dumps(
        {"key": key, "value": value},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(payload) > MAX_REQUEST_BODY_BYTES:
        raise ValueError("Edge Function request exceeds the conservative 900000-byte limit")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", required=True, choices=sorted(ALLOWED_KEYS))
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    raw = args.source.read_bytes()
    payload = build_payload(args.key, raw)
    args.output.write_bytes(payload)
    body = json.loads(payload.decode("utf-8"))
    print(
        f"{args.key}: body={len(payload)} bytes, value={len(body['value'].encode('utf-8'))} bytes"
    )


if __name__ == "__main__":
    main()

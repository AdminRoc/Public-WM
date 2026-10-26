#!/usr/bin/env python3
"""Verify current Public-WM raw data and update only the PWM release pointer."""
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import socket
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "AdminRoc/Public-WM"
ENDPOINT = "https://market.wfspeed.run"
MANIFEST_PATH = "release-manifest.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def get(url, timeout=45, attempts=4, delay=2):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt + 1 == attempts:
                raise
        except (urllib.error.URLError, TimeoutError, socket.timeout):
            if attempt + 1 == attempts:
                raise
        time.sleep(delay * (attempt + 1))
    raise RuntimeError("unreachable GET retry state")


def current_pointer():
    url = ENDPOINT + "/api/kv?key=wm_release_meta&v=" + str(time.time_ns())
    try:
        return json.loads(get(url, 15).decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def verify_pointer_after_write(expected, attempts=5, delay=2):
    for attempt in range(attempts):
        try:
            actual = current_pointer()
        except (urllib.error.URLError, TimeoutError, socket.timeout):
            if attempt + 1 == attempts:
                raise
        else:
            if actual == expected:
                return
        if attempt + 1 < attempts:
            time.sleep(delay * (attempt + 1))
    raise SystemExit("PWM release pointer readback mismatch after bounded verification")


def main():
    token = os.environ.get("KV_WRITE_TOKEN", "")
    if not token:
        raise SystemExit("Missing KV_WRITE_TOKEN")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    remote = subprocess.check_output(["git", "ls-remote", "origin", "refs/heads/main"], cwd=ROOT, text=True).split()
    if len(commit) != 40 or not remote or remote[0].lower() != commit.lower():
        raise SystemExit("Public-WM candidate is not current remote main")
    manifest_raw = (ROOT / "data" / MANIFEST_PATH).read_bytes()
    manifest = json.loads(manifest_raw.decode("utf-8"))
    if manifest.get("schema_version") != 1 or manifest.get("repository") != REPOSITORY:
        raise SystemExit("Invalid Public-WM release manifest")
    base = f"https://raw.githubusercontent.com/{REPOSITORY}/{commit}/data/"
    if sha(get(base + MANIFEST_PATH)) != sha(manifest_raw):
        raise SystemExit("Pinned Public-WM manifest readback mismatch")
    for path, entry in manifest.get("files", {}).items():
        if path.startswith("/") or ".." in path.split("/"):
            raise SystemExit("Unsafe path in Public-WM manifest")
        raw = get(base + urllib.parse.quote(path, safe="/._-"))
        if len(raw) != entry.get("bytes") or sha(raw) != entry.get("sha256"):
            raise SystemExit("Pinned Public-WM artifact hash mismatch: " + path)

    generation = os.environ.get("GITHUB_RUN_ID", "")
    if not generation.isdigit():
        raise SystemExit("Missing numeric GitHub run id")
    pointer = {
        "schema_version": 1,
        "repository": REPOSITORY,
        "commit_sha": commit,
        "manifest_path": MANIFEST_PATH,
        "manifest_sha256": sha(manifest_raw),
        "manifest_bytes": len(manifest_raw),
        "release_id": manifest["release_id"],
        "data_revision": manifest["release_id"],
        "generation": generation,
        "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    old = current_pointer()
    if old:
        if old.get("repository") != REPOSITORY:
            raise SystemExit("Existing PWM pointer belongs to another repository")
        old_generation = str(old.get("generation", ""))
        if old_generation.isdigit() and int(old_generation) > int(generation):
            raise SystemExit("Refusing to move PWM pointer backwards")
        pointer["previous_commit_sha"] = old.get("commit_sha")
    else:
        pointer["previous_commit_sha"] = None

    value = json.dumps(pointer, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    body = json.dumps({"key": "wm_release_meta", "value": value}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(ENDPOINT + "/api/update-kv", data=body,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response.read()
    except Exception as error:
        print("PWM pointer write response inconclusive; checking readback without replay: " + type(error).__name__, file=sys.stderr)
    verify_pointer_after_write(pointer)
    print(f"PWM RELEASE POINTER OK commit={commit} files_checked={len(manifest['files'])}")


if __name__ == "__main__":
    main()

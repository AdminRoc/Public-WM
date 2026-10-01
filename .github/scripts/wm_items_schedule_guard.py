"""Avoid repeated Public-WM catalog fetches while the last complete catalog is fresh."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


WORKFLOW_FILE = "harvest-wm-items.yml"
PRODUCER_JOB = "harvest"


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp has no timezone")
    return parsed.astimezone(timezone.utc)


def should_run_harvest(
    event_name: str,
    latest_success: dict | None,
    now: datetime,
    min_age: timedelta,
    cf_schedule_fallback: bool | str = False,
) -> tuple[bool, str]:
    fallback_enabled = cf_schedule_fallback is True or str(cf_schedule_fallback).strip().lower() == "true"
    if event_name != "schedule" and not fallback_enabled:
        return True, f"{event_name} manual run bypasses the periodic freshness gate"
    if latest_success is None:
        return True, "no completed catalog harvest success found; allow recovery"
    completed_at = latest_success.get("updated_at") or latest_success.get("completed_at")
    if not completed_at:
        raise ValueError("latest successful catalog harvest has no completion timestamp")
    age = now.astimezone(timezone.utc) - parse_utc(completed_at)
    if age < -timedelta(minutes=5):
        raise ValueError("latest successful catalog harvest is unexpectedly in the future")
    if age < min_age:
        return False, f"last complete catalog harvest is only {max(0, int(age.total_seconds() // 60))} minutes old"
    return True, f"last complete catalog harvest is at least {int(min_age.total_seconds() // 60)} minutes old"


def api_json(url: str, token: str) -> dict:
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Public-WM-item-schedule-guard",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def latest_successful_harvest(repository: str, api_url: str, token: str) -> dict | None:
    base = f"{api_url.rstrip('/')}/repos/{repository}/actions"
    document = api_json(
        f"{base}/workflows/{WORKFLOW_FILE}/runs?status=completed&per_page=30", token
    )
    runs = document.get("workflow_runs") if isinstance(document, dict) else None
    if not isinstance(runs, list) or any(not isinstance(run, dict) for run in runs):
        raise ValueError("GitHub Actions API returned an invalid workflow-run list")
    for run in runs:
        run_id = run.get("id")
        if not isinstance(run_id, int):
            raise ValueError("completed workflow run has no valid ID")
        jobs_document = api_json(f"{base}/runs/{run_id}/jobs?per_page=100", token)
        jobs = jobs_document.get("jobs") if isinstance(jobs_document, dict) else None
        if not isinstance(jobs, list) or any(not isinstance(job, dict) for job in jobs):
            raise ValueError("GitHub Actions API returned an invalid job list")
        harvest = next((job for job in jobs if job.get("name") == PRODUCER_JOB), None)
        if harvest is None:
            raise ValueError("completed workflow run is missing the harvest producer job")
        if run.get("conclusion") == "success" and harvest.get("conclusion") == "success":
            return run
        if harvest.get("conclusion") in {"failure", "cancelled", "timed_out", "action_required"}:
            return None
        # Skips from a successful freshness gate are not new catalog data.
    return None


def write_output(run_capture: bool) -> int:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        print("::error::GITHUB_OUTPUT is not set")
        return 1
    with open(output_path, "a", encoding="utf-8") as output:
        output.write(f"run_capture={str(run_capture).lower()}\n")
    return 0


def main() -> int:
    event_name = os.environ.get("EVENT_NAME", "")
    fallback_input = os.environ.get("CF_SCHEDULE_FALLBACK", "false")
    if event_name != "schedule" and fallback_input.strip().lower() != "true":
        print(f"run_capture=true ({event_name or 'unknown'} manual run bypasses freshness gate)")
        return write_output(True)
    token = os.environ.get("GH_TOKEN", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    try:
        min_age = timedelta(minutes=int(os.environ.get("MIN_AGE_MINUTES", "0")))
        if min_age <= timedelta(0):
            raise ValueError("MIN_AGE_MINUTES must be positive")
        if not token or not repository:
            raise ValueError("GitHub Actions API configuration is incomplete")
        latest = latest_successful_harvest(repository, api_url, token)
        run_capture, reason = should_run_harvest(
            event_name, latest, datetime.now(timezone.utc), min_age, fallback_input
        )
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"::error::Could not verify the last catalog harvest ({type(error).__name__})")
        return 1
    print(f"run_capture={str(run_capture).lower()} ({reason})")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not run_capture and summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write(f"### Scheduled Public-WM catalog run skipped\n\n{reason}.\n")
    return write_output(run_capture)


if __name__ == "__main__":
    sys.exit(main())

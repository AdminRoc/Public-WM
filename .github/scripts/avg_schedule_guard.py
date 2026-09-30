"""Avoid duplicate scheduled WM average scrapes while recovering missed slots."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


WORKFLOW_FILE = "refresh-avg-prices.yml"


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp has no timezone")
    return parsed.astimezone(timezone.utc)


def should_run_capture(
    event_name: str,
    latest_success: dict | None,
    now: datetime,
    min_age: timedelta,
) -> tuple[bool, str]:
    if event_name != "schedule":
        return True, f"{event_name} run bypasses the scheduled freshness gate"
    if latest_success is None:
        return True, "no successful refresh run found; allow scheduled recovery"

    completed_at = latest_success.get("updated_at") or latest_success.get("completed_at")
    if not completed_at:
        raise ValueError("latest successful refresh has no completion timestamp")
    age = now.astimezone(timezone.utc) - parse_utc(completed_at)
    if age < -timedelta(minutes=5):
        raise ValueError("latest successful refresh completion is unexpectedly in the future")
    if age < min_age:
        age_minutes = max(0, int(age.total_seconds() // 60))
        return False, f"last successful refresh is only {age_minutes} minutes old"
    return True, f"last successful refresh is at least {int(min_age.total_seconds() // 60)} minutes old"


def api_json(url: str, token: str) -> dict:
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Public-WM-average-schedule-guard",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def latest_successful_run(repository: str, api_url: str, token: str) -> dict | None:
    url = (
        f"{api_url.rstrip('/')}/repos/{repository}/actions/workflows/"
        f"{WORKFLOW_FILE}/runs?status=completed&per_page=30"
    )
    document = api_json(url, token)
    runs = document.get("workflow_runs") if isinstance(document, dict) else None
    if not isinstance(runs, list) or any(not isinstance(run, dict) for run in runs):
        raise ValueError("GitHub Actions API returned an invalid workflow-run list")
    return next((run for run in runs if run.get("conclusion") == "success"), None)


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
    if event_name != "schedule":
        print(f"run_capture=true ({event_name or 'unknown'} run bypasses schedule gate)")
        return write_output(True)

    token = os.environ.get("GH_TOKEN", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    if not token or not repository:
        print("::error::Schedule freshness gate is missing GitHub API configuration")
        return 1

    try:
        latest = latest_successful_run(repository, api_url, token)
        min_age = timedelta(minutes=int(os.environ.get("MIN_AGE_MINUTES", "45")))
        if min_age <= timedelta(0):
            raise ValueError("MIN_AGE_MINUTES must be positive")
        run_capture, reason = should_run_capture(
            event_name, latest, datetime.now(timezone.utc), min_age
        )
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as error:
        # Uncertain GitHub state must not launch another full upstream collection.
        print(f"::error::Could not verify the last average refresh ({type(error).__name__})")
        return 1

    print(f"run_capture={str(run_capture).lower()} ({reason})")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not run_capture and summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write(f"### Scheduled Public-WM refresh skipped\n\n{reason}.\n")
    return write_output(run_capture)


if __name__ == "__main__":
    sys.exit(main())

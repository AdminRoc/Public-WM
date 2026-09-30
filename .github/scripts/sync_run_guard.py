"""Allow KV sync only after an actual upstream producer job succeeds."""

from __future__ import annotations

import json
import os
import sys
from urllib.request import Request, urlopen


PRODUCER_JOBS = {
    "刷新全量均价数据": "refresh",
    "刷新拍卖字典": "harvest",
}


def should_sync(
    event_name: str,
    workflow_name: str,
    parent_conclusion: str,
    jobs: list[dict],
) -> tuple[bool, str]:
    if event_name == "workflow_dispatch":
        return True, "manual KV publication is explicitly requested"
    if event_name != "workflow_run":
        return False, f"unsupported trigger {event_name!r}; skip publication"
    if parent_conclusion != "success":
        return False, "upstream workflow did not complete successfully"

    producer_job = PRODUCER_JOBS.get(workflow_name)
    if producer_job is None:
        return False, f"no producer job contract is defined for {workflow_name!r}"
    job = next((entry for entry in jobs if entry.get("name") == producer_job), None)
    if job is None:
        raise ValueError(f"upstream producer job {producer_job!r} is missing")
    if job.get("conclusion") != "success":
        return False, f"upstream producer job {producer_job!r} did not run successfully"
    return True, f"upstream producer job {producer_job!r} succeeded"


def api_json(url: str, token: str) -> dict:
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Public-WM-sync-run-guard",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def parent_jobs(repository: str, run_id: str, api_url: str, token: str) -> list[dict]:
    if not run_id.isdigit():
        raise ValueError("parent workflow run ID is invalid")
    url = f"{api_url.rstrip('/')}/repos/{repository}/actions/runs/{run_id}/jobs?per_page=100"
    document = api_json(url, token)
    jobs = document.get("jobs") if isinstance(document, dict) else None
    if not isinstance(jobs, list) or any(not isinstance(job, dict) for job in jobs):
        raise ValueError("GitHub Actions API returned an invalid parent-job list")
    return jobs


def write_output(do_sync: bool) -> int:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        print("::error::GITHUB_OUTPUT is not set")
        return 1
    with open(output_path, "a", encoding="utf-8") as output:
        output.write(f"do_sync={str(do_sync).lower()}\n")
    return 0


def main() -> int:
    event_name = os.environ.get("EVENT_NAME", "")
    if event_name == "workflow_dispatch":
        print("do_sync=true (manual KV publication)")
        return write_output(True)

    token = os.environ.get("GH_TOKEN", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("PARENT_RUN_ID", "")
    workflow_name = os.environ.get("PARENT_WORKFLOW_NAME", "")
    conclusion = os.environ.get("PARENT_CONCLUSION", "")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    if not token or not repository:
        print("::error::Workflow-run guard is missing GitHub API configuration")
        return 1
    if conclusion != "success":
        print("do_sync=false (upstream workflow did not succeed)")
        return write_output(False)

    try:
        jobs = parent_jobs(repository, run_id, api_url, token)
        do_sync, reason = should_sync(event_name, workflow_name, conclusion, jobs)
    except (OSError, ValueError, KeyError, TypeError) as error:
        # Do not publish artifacts when the producer's actual job state is unknown.
        print(f"::error::Could not verify upstream producer job ({type(error).__name__})")
        return 1
    print(f"do_sync={str(do_sync).lower()} ({reason})")
    return write_output(do_sync)


if __name__ == "__main__":
    sys.exit(main())

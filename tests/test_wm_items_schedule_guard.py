import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github" / "scripts"))
from wm_items_schedule_guard import latest_successful_harvest, should_run_harvest


NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
WINDOW = timedelta(minutes=110)


class WmItemsScheduleGuardTests(unittest.TestCase):
    def test_manual_dispatch_bypasses_gate(self):
        run, _ = should_run_harvest("workflow_dispatch", None, NOW, WINDOW)
        self.assertTrue(run)

    def test_flagged_cloudflare_dispatch_obeys_gate(self):
        recent = {"updated_at": "2026-10-01T11:00:00Z"}
        run, _ = should_run_harvest("workflow_dispatch", recent, NOW, WINDOW, "true")
        self.assertFalse(run)

    def test_expected_two_hour_slot_is_not_suppressed_after_threshold(self):
        previous = {"updated_at": "2026-10-01T10:10:00Z"}
        run, _ = should_run_harvest("schedule", previous, NOW, WINDOW)
        self.assertTrue(run)

    def test_recent_schedule_success_skips_fallback(self):
        previous = {"updated_at": "2026-10-01T11:00:00Z"}
        run, reason = should_run_harvest("schedule", previous, NOW, WINDOW)
        self.assertFalse(run)
        self.assertIn("60 minutes old", reason)

    def test_no_success_or_failed_producer_allows_recovery(self):
        self.assertTrue(should_run_harvest("schedule", None, NOW, WINDOW)[0])

    def test_invalid_or_future_timestamp_fails_closed(self):
        for latest in ({"updated_at": "bad"}, {"updated_at": "2026-10-01T12:10:00Z"}):
            with self.subTest(latest=latest), self.assertRaises(ValueError):
                should_run_harvest("schedule", latest, NOW, WINDOW)

    @patch("wm_items_schedule_guard.api_json")
    def test_skipped_gate_run_does_not_reset_success_age(self, api_json):
        recent_skip = {"id": 2, "conclusion": "success", "updated_at": "2026-10-01T11:55:00Z"}
        previous_harvest = {"id": 1, "conclusion": "success", "updated_at": "2026-10-01T10:00:00Z"}
        api_json.side_effect = [
            {"workflow_runs": [recent_skip, previous_harvest]},
            {"jobs": [{"name": "schedule_guard", "conclusion": "success"}, {"name": "harvest", "conclusion": "skipped"}]},
            {"jobs": [{"name": "harvest", "conclusion": "success"}]},
        ]
        result = latest_successful_harvest("AdminRoc/Public-WM", "https://api.github.com", "dummy")
        self.assertEqual(result, previous_harvest)

    @patch("wm_items_schedule_guard.api_json")
    def test_latest_failed_harvest_allows_retry(self, api_json):
        failed = {"id": 2, "conclusion": "failure"}
        prior = {"id": 1, "conclusion": "success"}
        api_json.side_effect = [
            {"workflow_runs": [failed, prior]},
            {"jobs": [{"name": "harvest", "conclusion": "failure"}]},
        ]
        self.assertIsNone(latest_successful_harvest("AdminRoc/Public-WM", "https://api.github.com", "dummy"))


if __name__ == "__main__":
    unittest.main()

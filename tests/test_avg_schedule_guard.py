import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.github' / 'scripts'))
from avg_schedule_guard import latest_successful_run, should_run_capture


class AverageScheduleGuardTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
        self.window = timedelta(minutes=45)

    def test_manual_dispatch_is_never_suppressed(self):
        run, _ = should_run_capture('workflow_dispatch', None, self.now, self.window)
        self.assertTrue(run)

    def test_no_successful_run_allows_scheduled_recovery(self):
        run, _ = should_run_capture('schedule', None, self.now, self.window)
        self.assertTrue(run)

    def test_recent_success_skips_duplicate_capture(self):
        latest = {'updated_at': '2026-10-01T11:30:00Z'}
        run, reason = should_run_capture('schedule', latest, self.now, self.window)
        self.assertFalse(run)
        self.assertIn('30 minutes old', reason)

    def test_stale_success_allows_recovery(self):
        latest = {'updated_at': '2026-10-01T11:15:00Z'}
        run, _ = should_run_capture('schedule', latest, self.now, self.window)
        self.assertTrue(run)

    def test_missing_or_invalid_timestamp_fails_closed(self):
        for latest in ({}, {'updated_at': 'not-a-timestamp'}):
            with self.subTest(latest=latest), self.assertRaises(ValueError):
                should_run_capture('schedule', latest, self.now, self.window)

    @patch('avg_schedule_guard.api_json')
    def test_latest_success_is_selected_even_after_a_failed_run(self, api_json):
        api_json.side_effect = [
            {'workflow_runs': [
                {'id': 42, 'conclusion': 'failure', 'updated_at': '2026-10-01T11:59:00Z'},
                {'id': 41, 'conclusion': 'success', 'updated_at': '2026-10-01T11:30:00Z'},
            ]},
            {'jobs': [{'name': 'refresh', 'conclusion': 'success'}]},
        ]
        result = latest_successful_run('AdminRoc/Public-WM', 'https://api.github.com', 'test')
        self.assertEqual(result['id'], 41)

    @patch('avg_schedule_guard.api_json')
    def test_green_workflow_with_skipped_refresh_is_not_a_successful_scrape(self, api_json):
        api_json.side_effect = [
            {'workflow_runs': [
                {'id': 42, 'conclusion': 'success', 'updated_at': '2026-10-01T11:45:00Z'},
                {'id': 41, 'conclusion': 'success', 'updated_at': '2026-10-01T11:30:00Z'},
            ]},
            {'jobs': [{'name': 'refresh', 'conclusion': 'skipped'}]},
            {'jobs': [{'name': 'refresh', 'conclusion': 'success'}]},
        ]
        result = latest_successful_run('AdminRoc/Public-WM', 'https://api.github.com', 'test')
        self.assertEqual(result['id'], 41)

    @patch('avg_schedule_guard.api_json')
    def test_malformed_run_list_fails_closed(self, api_json):
        api_json.return_value = {'workflow_runs': None}
        with self.assertRaisesRegex(ValueError, 'invalid workflow-run list'):
            latest_successful_run('AdminRoc/Public-WM', 'https://api.github.com', 'test')


if __name__ == '__main__':
    unittest.main()

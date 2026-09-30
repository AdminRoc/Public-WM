import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.github' / 'scripts'))
from sync_run_guard import parent_jobs, should_sync


class SyncRunGuardTests(unittest.TestCase):
    def test_manual_dispatch_stays_available(self):
        run, _ = should_sync('workflow_dispatch', '', '', [])
        self.assertTrue(run)

    def test_skipped_average_producer_does_not_sync(self):
        run, _ = should_sync(
            'workflow_run', '刷新全量均价数据', 'success',
            [{'name': 'refresh', 'conclusion': 'skipped'}],
        )
        self.assertFalse(run)

    def test_successful_average_producer_syncs(self):
        run, _ = should_sync(
            'workflow_run', '刷新全量均价数据', 'success',
            [{'name': 'refresh', 'conclusion': 'success'}],
        )
        self.assertTrue(run)

    def test_successful_auction_producer_syncs(self):
        run, _ = should_sync(
            'workflow_run', '刷新拍卖字典', 'success',
            [{'name': 'harvest', 'conclusion': 'success'}],
        )
        self.assertTrue(run)

    def test_failed_parent_never_syncs(self):
        run, _ = should_sync(
            'workflow_run', '刷新拍卖字典', 'failure',
            [{'name': 'harvest', 'conclusion': 'success'}],
        )
        self.assertFalse(run)

    def test_unknown_workflow_is_not_published(self):
        run, _ = should_sync('workflow_run', 'unknown', 'success', [])
        self.assertFalse(run)

    def test_missing_expected_job_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'producer job'):
            should_sync('workflow_run', '刷新全量均价数据', 'success', [])

    @patch('sync_run_guard.api_json')
    def test_parent_job_list_is_read_from_actions_api(self, api_json):
        api_json.return_value = {'jobs': [{'name': 'refresh', 'conclusion': 'skipped'}]}
        jobs = parent_jobs('AdminRoc/Public-WM', '1234', 'https://api.github.com', 'test')
        self.assertEqual(jobs[0]['conclusion'], 'skipped')

    @patch('sync_run_guard.api_json')
    def test_malformed_parent_job_list_fails_closed(self, api_json):
        api_json.return_value = {'jobs': None}
        with self.assertRaisesRegex(ValueError, 'invalid parent-job list'):
            parent_jobs('AdminRoc/Public-WM', '1234', 'https://api.github.com', 'test')


if __name__ == '__main__':
    unittest.main()

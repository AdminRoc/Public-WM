import pathlib
import unittest


WORKFLOW = pathlib.Path(__file__).resolve().parents[1] / ".github/workflows/sync-kv.yml"


class SyncKvReadbackAuthTests(unittest.TestCase):
    def test_bwm_readback_uses_the_bwm_write_token(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('"Authorization: Bearer ${BWM_KV_WRITE_TOKEN}"', workflow)
        self.assertIn('https://boss.wfspeed.run/api/kv?key=${key}&verify=${expected}', workflow)

    def test_pwm_publishes_only_the_verified_release_pointer(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('Publish and verify the small PWM release pointer', workflow)
        self.assertIn('python3 .github/scripts/publish_release_pointer.py', workflow)
        self.assertNotIn('https://market.wfspeed.run/api/update-kv', workflow)

    def test_oversized_bwm_catalog_is_skipped_when_verified_and_ambiguous_writes_are_read_back(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('if [ "$key" = "wm_items_json" ] && verify_readback', workflow)
        self.assertIn('400|401|403|404|405|413|422)', workflow)
        self.assertIn('checking fresh readback before any retry', workflow)
        self.assertIn('write outcome is uncertain and readback unavailable; refusing replay', workflow)


if __name__ == "__main__":
    unittest.main()

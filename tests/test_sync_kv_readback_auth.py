import pathlib
import unittest


WORKFLOW = pathlib.Path(__file__).resolve().parents[1] / ".github/workflows/sync-kv.yml"


class SyncKvReadbackAuthTests(unittest.TestCase):
    def test_bwm_readback_uses_the_bwm_write_token(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            'verify_readback "https://boss.wfspeed.run/api/kv" "$key" "$src" "${BWM_KV_WRITE_TOKEN}"',
            workflow,
        )
        self.assertIn('"Authorization: Bearer ${token}"', workflow)

    def test_pwm_public_readback_remains_unauthenticated(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            'verify_readback "https://market.wfspeed.run/api/kv" "$key" "$src" || fail=1',
            workflow,
        )


if __name__ == "__main__":
    unittest.main()

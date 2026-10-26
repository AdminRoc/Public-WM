import base64
import gzip
import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

from kv_payload import (  # noqa: E402
    ALLOWED_KEYS,
    MAX_REQUEST_BODY_BYTES,
    MAX_STORED_VALUE_BYTES,
    WM_ITEMS_FORMAT,
    build_payload,
)


class KvPayloadTests(unittest.TestCase):
    def test_current_fixed_key_sources_fit_and_round_trip(self):
        sources = {
            "avg_prices_full_json": ROOT / "data" / "avg_prices_full.json",
            "auction_dicts_json": ROOT / "data" / "auction-dicts.json",
            "wm_items_json": ROOT / "data" / "wm-items.json",
        }
        self.assertEqual(set(sources), ALLOWED_KEYS)
        for key, path in sources.items():
            with self.subTest(key=key):
                raw = path.read_bytes()
                payload = build_payload(key, raw)
                self.assertLessEqual(len(payload), MAX_REQUEST_BODY_BYTES)
                parsed = json.loads(payload.decode("utf-8"))
                self.assertEqual(parsed["key"], key)
                self.assertLessEqual(
                    len(parsed["value"].encode("utf-8")), MAX_STORED_VALUE_BYTES
                )
                if key == "wm_items_json":
                    wrapper = json.loads(parsed["value"])
                    self.assertEqual(wrapper["format"], WM_ITEMS_FORMAT)
                    unpacked = gzip.decompress(base64.b64decode(wrapper["data"], validate=True))
                    self.assertEqual(unpacked, raw)
                    self.assertEqual(wrapper["sha256"], hashlib.sha256(raw).hexdigest())
                    self.assertEqual(wrapper["uncompressedBytes"], len(raw))
                    document = json.loads(unpacked.decode("utf-8"))
                    items = document.get("data") if isinstance(document, dict) else document
                    self.assertGreaterEqual(len(items), 1500)
                    self.assertEqual(len({item["id"] for item in items}), len(items))
                    self.assertEqual(len({item["slug"] for item in items}), len(items))
                else:
                    self.assertEqual(parsed["value"], raw.decode("utf-8"))

    def test_rejects_unlisted_keys_and_invalid_item_identity(self):
        with self.assertRaisesRegex(ValueError, "allowlist"):
            build_payload("user_session", b"{}")
        invalid = json.dumps(
            {"data": [{"id": "duplicate", "slug": "one"}] * 1500}
        ).encode("utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            build_payload("wm_items_json", invalid)

    def test_rejects_values_that_would_exceed_the_provider_request_limit(self):
        oversized = json.dumps({"data": "x" * MAX_REQUEST_BODY_BYTES}).encode("utf-8")
        with self.assertRaisesRegex(ValueError, "900000-byte"):
            build_payload("auction_dicts_json", oversized)

    def test_gzip_output_is_deterministic_for_a_fixed_catalog(self):
        source = (ROOT / "data" / "wm-items.json").read_bytes()
        self.assertEqual(
            build_payload("wm_items_json", source),
            build_payload("wm_items_json", source),
        )


if __name__ == "__main__":
    unittest.main()

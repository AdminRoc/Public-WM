import importlib.util
import pathlib
import socket
import unittest
import urllib.error
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "publish_release_pointer", ROOT / ".github/scripts/publish_release_pointer.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b"ok"


class PublishReleasePointerTests(unittest.TestCase):
    @mock.patch.object(MODULE.time, "sleep")
    @mock.patch.object(MODULE.urllib.request, "urlopen")
    def test_get_retries_timeout_then_returns_response(self, urlopen, sleep):
        urlopen.side_effect = [socket.timeout("temporary"), Response()]
        self.assertEqual(MODULE.get("https://example.test", attempts=2, delay=0), b"ok")
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(0)

    @mock.patch.object(MODULE.time, "sleep")
    @mock.patch.object(MODULE.urllib.request, "urlopen")
    def test_get_does_not_retry_client_errors(self, urlopen, _sleep):
        urlopen.side_effect = urllib.error.HTTPError(
            "https://example.test", 404, "missing", {}, None
        )
        with self.assertRaises(urllib.error.HTTPError):
            MODULE.get("https://example.test", attempts=4, delay=0)
        urlopen.assert_called_once()

    @mock.patch.object(MODULE.time, "sleep")
    def test_readback_polls_until_expected_pointer_is_visible(self, _sleep):
        expected = {"generation": "2"}
        with mock.patch.object(MODULE, "current_pointer", side_effect=[None, expected]):
            MODULE.verify_pointer_after_write(expected, attempts=2, delay=0)

    @mock.patch.object(MODULE.time, "sleep")
    def test_readback_stops_after_bounded_mismatches(self, _sleep):
        with mock.patch.object(MODULE, "current_pointer", return_value={"generation": "1"}):
            with self.assertRaisesRegex(SystemExit, "bounded verification"):
                MODULE.verify_pointer_after_write({"generation": "2"}, attempts=2, delay=0)


if __name__ == "__main__":
    unittest.main()

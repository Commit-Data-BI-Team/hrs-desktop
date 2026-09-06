import base64
import json
import os
import sys
import time
import unittest
from unittest.mock import patch


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPTS = os.path.join(ROOT, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from selenium.common.exceptions import NoSuchElementException

from meetings_fetch import (
    OAUTH_CAPTURE_PREFIX,
    extract_access_token_from_performance_entries,
    extract_access_token_from_oauth_capture,
    find_duo_action_button,
    chrome_binary_version,
    looks_like_graph_access_token,
)


def encode_segment(value):
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def graph_token():
    return ".".join(
        [
            encode_segment({"alg": "RS256", "typ": "JWT"}),
            encode_segment(
                {
                    "aud": "https://graph.microsoft.com",
                    "scp": "Calendars.Read User.Read",
                    "exp": int(time.time()) + 3600,
                }
            ),
            "signature_value_long_enough_for_validation",
        ]
    )


class FakeButton:
    def __init__(self, label):
        self.text = label

    def is_displayed(self):
        return True

    def is_enabled(self):
        return True

    def get_attribute(self, _name):
        return None


class FakeFrame:
    def __init__(self, controls=None, frames=None):
        self.controls = controls or []
        self.frames = frames or []


class FakeSwitchTo:
    def __init__(self, driver):
        self.driver = driver

    def default_content(self):
        self.driver.context_stack = [self.driver.root]

    def frame(self, frame):
        self.driver.context_stack.append(frame)

    def parent_frame(self):
        if len(self.driver.context_stack) > 1:
            self.driver.context_stack.pop()


class FakeDriver:
    def __init__(self, root):
        self.root = root
        self.context_stack = [root]
        self.switch_to = FakeSwitchTo(self)

    @property
    def context(self):
        return self.context_stack[-1]

    def find_elements(self, _by, selector):
        if selector == "iframe, frame":
            return self.context.frames
        return self.context.controls

    def find_element(self, _by, _selector):
        raise NoSuchElementException()


class FakeOAuthDriver:
    current_url = "https://developer.microsoft.com/en-us/graph/graph-explorer"

    def __init__(self, values):
        self.values = values

    def execute_script(self, *_args):
        return self.values


class MeetingsTokenCaptureTests(unittest.TestCase):
    def test_accepts_long_opaque_graph_access_tokens_but_not_abbreviated_values(self):
        self.assertTrue(looks_like_graph_access_token("opaque_" + "x" * 220))
        self.assertFalse(looks_like_graph_access_token("eyJ.short.parts"))

    @patch("meetings_fetch.subprocess.check_output", return_value="Google Chrome 128.0.0.0")
    @patch("meetings_fetch.os.name", "nt")
    def test_windows_chrome_version_probe_is_headless(self, check_output):
        self.assertEqual(chrome_binary_version(r"C:\portable\chrome.exe"), "128.0.0.0")
        command = check_output.call_args.args[0]
        self.assertIn("--headless=new", command)

    def test_reads_graph_bearer_token_from_chrome_performance_log(self):
        token = graph_token()
        entries = [
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.requestWillBeSentExtraInfo",
                            "params": {
                                "headers": {"Authorization": "Bearer " + token}
                            },
                        }
                    }
                )
            }
        ]

        self.assertEqual(extract_access_token_from_performance_entries(entries), token)

    def test_rejects_truncated_graph_explorer_display_token(self):
        entries = [
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Network.requestWillBeSentExtraInfo",
                            "params": {
                                "headers": {"Authorization": "Bearer eyJ.short.parts"}
                            },
                        }
                    }
                )
            }
        ]

        self.assertIsNone(extract_access_token_from_performance_entries(entries))

    def test_reads_full_token_preserved_before_graph_explorer_clears_fragment(self):
        token = graph_token()
        driver = FakeOAuthDriver(
            [f"{OAUTH_CAPTURE_PREFIX}#access_token={token}&token_type=Bearer"]
        )

        self.assertEqual(extract_access_token_from_oauth_capture(driver), token)

    def test_reads_oauth_fragment_from_chrome_frame_navigation_log(self):
        token = graph_token()
        entries = [
            {
                "message": json.dumps(
                    {
                        "message": {
                            "method": "Page.frameNavigated",
                            "params": {
                                "frame": {
                                    "url": "https://developer.microsoft.com/en-us/graph/graph-explorer#access_token="
                                    + token
                                    + "&token_type=Bearer"
                                }
                            },
                        }
                    }
                )
            }
        ]

        self.assertEqual(extract_access_token_from_performance_entries(entries), token)

    def test_finds_duo_action_inside_nested_authentication_frames(self):
        push_button = FakeButton("Send me a push")
        driver = FakeDriver(
            FakeFrame(frames=[FakeFrame(frames=[FakeFrame(controls=[push_button])])])
        )

        self.assertIs(find_duo_action_button(driver, "push"), push_button)
        self.assertEqual(len(driver.context_stack), 3)


if __name__ == "__main__":
    unittest.main()

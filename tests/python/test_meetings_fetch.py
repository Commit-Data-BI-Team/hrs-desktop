import base64
import io
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
    duo_request_state,
    looks_like_graph_access_token,
    microsoft_sign_in_error_message,
    request_duo_action,
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


class FakeBody:
    def __init__(self, text):
        self.text = text


class FakeSignInDriver:
    def __init__(self, text):
        self.text = text

    def find_element(self, _by, _selector):
        return FakeBody(self.text)


class MeetingsTokenCaptureTests(unittest.TestCase):
    @patch(
        "meetings_fetch.sys.stdin",
        new_callable=lambda: io.StringIO(
            '{"action":"passcode","passcode":"123456"}\n'
        ),
    )
    def test_reads_duo_passcode_without_logging_or_storing_it(self, _stdin):
        self.assertEqual(request_duo_action(), ("passcode", "123456"))

    @patch(
        "meetings_fetch.sys.stdin",
        new_callable=lambda: io.StringIO(
            '{"action":"passcode","passcode":"not-a-code"}\n'
        ),
    )
    def test_rejects_invalid_duo_passcode(self, _stdin):
        with self.assertRaisesRegex(RuntimeError, "valid numeric DUO passcode"):
            request_duo_action()

    def test_confirms_duo_push_delivery_and_manual_open_hint(self):
        state, message = duo_request_state(
            FakeSignInDriver(
                "Pushed a login request to your device. Please open Duo Mobile and check for Duo Push requests manually."
            ),
            "push",
        )

        self.assertEqual(state, "manual")
        self.assertIsNone(message)

    def test_reports_expired_duo_prompt_instead_of_claiming_delivery(self):
        state, message = duo_request_state(FakeSignInDriver("Login timed out."), "push")

        self.assertEqual(state, "error")
        self.assertIn("DUO login window expired", message)

    def test_reports_incorrect_microsoft_credentials_immediately(self):
        message = microsoft_sign_in_error_message(
            FakeSignInDriver(
                "Your account or password is incorrect. If you don't remember your password, reset it now."
            )
        )

        self.assertIn("rejected the saved username or password", message)

    def test_does_not_treat_regular_microsoft_page_as_sign_in_error(self):
        self.assertIsNone(
            microsoft_sign_in_error_message(FakeSignInDriver("Approve sign in request"))
        )

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

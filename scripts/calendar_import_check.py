"""Offline import check for the *shipped* calendar runtime. No account or authentication."""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote


def check_windows_browser():
    if os.name != "nt":
        raise RuntimeError("Windows browser verification requires Windows.")
    import selenium
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    manager = Path(selenium.__file__).parent / "webdriver" / "common" / "windows" / "selenium-manager.exe"
    subprocess.run([str(manager), "--version"], check=True, capture_output=True, timeout=20)
    with tempfile.TemporaryDirectory(prefix="HRS isolated calendar ") as profile:
        options = webdriver.ChromeOptions()
        for flag in ("--headless=new", "--no-first-run", "--disable-sync", "--disable-background-networking", "--disable-component-update"):
            options.add_argument(flag)
        options.add_argument("--user-data-dir=" + profile)
        driver_path = shutil.which("chromedriver")
        driver = webdriver.Chrome(service=Service(driver_path) if driver_path else Service(), options=options)
        try:
            driver.get("data:text/html;charset=utf-8," + quote("<title>בדיקת לוח שנה</title>"))
            if driver.title != "בדיקת לוח שנה":
                raise RuntimeError("Isolated Windows browser did not render the local fixture.")
        finally:
            driver.quit()


def main(check_browser=False):
    from meetings_fetch import fetch_events, normalize_calendar_events
    import requests
    if not Path(requests.certs.where()).is_file():
        raise RuntimeError("Calendar runtime is missing its certificate bundle.")
    if check_browser:
        check_windows_browser()
    root = "https://graph.microsoft.com/v1.0/me/calendarView"
    # URL is only a fixture key: the injected transport cannot make network requests.
    pages = {
        root: {"value": [{"subject": "פגישת בדיקה", "start": {"dateTime": "2026-11-16T07:00:00.0000000", "timeZone": "UTC"},
                          "end": {"dateTime": "2026-11-16T08:00:00", "timeZone": "UTC"},
                          "attendees": [{"emailAddress": {"name": "בודק", "address": "fixture@example.invalid"}}]}],
               "@odata.nextLink": root + "?page=2"},
        root + "?page=2": {"value": [None, {"subject": "Local review", "start": {"dateTime": "2026-11-18T09:00:00", "timeZone": "Israel Standard Time"},
                                           "end": {"dateTime": "2026-11-18T10:00:00", "timeZone": "Israel Standard Time"}}]},
    }
    class Reply:
        status_code = 200
        def __init__(self, value):
            self.value = value
        def json(self):
            return self.value
    events = fetch_events(root, {}, get=lambda url, **_: Reply(pages[url]))
    meetings = normalize_calendar_events(events, "Asia/Jerusalem")
    print(json.dumps({"month":"2026-11", "count":len(meetings), "meetings":meetings}, ensure_ascii=True))
    return 0

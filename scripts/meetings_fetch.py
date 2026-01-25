import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import csv
import pytz
import requests
from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchElementException,
    NoSuchWindowException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
import subprocess


GRAPH_EXPLORER_URL = "https://developer.microsoft.com/en-us/graph/graph-explorer"
WINDOWS_TZ_MAP = {
    "Israel Standard Time": "Asia/Jerusalem",
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "E. Europe Standard Time": "Europe/Bucharest",
    "Eastern Standard Time": "America/New_York",
    "Central Europe Standard Time": "Europe/Budapest",
    "W. Europe Standard Time": "Europe/Berlin",
    "Pacific Standard Time": "America/Los_Angeles",
}


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--browser",
        choices=["safari", "chrome"],
        default="safari",
        help="Browser to use for Selenium.",
    )
    parser.add_argument(
        "--month",
        default=None,
        help="Month in YYYY-MM format (defaults to current UTC month).",
    )
    parser.add_argument(
        "--tz",
        default="Asia/Jerusalem",
        help="Timezone for output formatting.",
    )
    parser.add_argument(
        "--csv",
        default=None,
        help="Optional path to write CSV output.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run Chrome in headless mode (ignored for Safari).",
    )
    parser.add_argument(
        "--attendance",
        action="store_true",
        help="Include attendance lookup (requires extra permissions).",
    )
    return parser.parse_args()


def month_range(month_value: str | None) -> tuple[str, str, str]:
    now = datetime.now(timezone.utc)
    if month_value:
        try:
            year, month = month_value.split("-")
            start = datetime(int(year), int(month), 1, tzinfo=timezone.utc)
        except ValueError:
            raise ValueError("Invalid --month format. Use YYYY-MM.")
    else:
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    if start.month == 12:
        next_month = datetime(start.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        next_month = datetime(start.year, start.month + 1, 1, tzinfo=timezone.utc)
    end = min(now, next_month - timedelta(seconds=1))
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    return start_iso, end_iso, start.strftime("%Y-%m")


def dismiss_safari_cookie_prompt(delay: float = 5.0):
    time.sleep(delay)
    applescript = r'''
    tell application "System Events"
      tell process "Safari"
        if exists window 1 then
          try
            click button "Allow" of window 1
          end try
        end if
      end tell
    end tell
    '''
    subprocess.run(["osascript", "-e", applescript], check=False)


def build_driver(browser: str, headless: bool):
    if browser == "chrome":
        options = webdriver.ChromeOptions()
        profile_dir = os.getenv("MEETINGS_CHROME_PROFILE", "").strip()
        if profile_dir:
            options.add_argument(f"--user-data-dir={profile_dir}")
            options.add_argument("--profile-directory=Default")
        options.add_argument("--start-maximized")
        if headless:
            log("Background mode enabled. Running Chrome headless.")
            options.add_argument("--headless=new")
            options.add_argument("--window-size=1280,900")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")
        return webdriver.Chrome(options=options)
    return webdriver.Safari()


def fetch_events(url: str, headers: dict) -> list[dict]:
    events = []
    while url:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            response_json = response.json()
            events.extend(response_json.get("value", []))
            url = response_json.get("@odata.nextLink")
        else:
            log(
                f"Failed to fetch results. Status: {response.status_code}, Body: {response.text}"
            )
            url = None
    return events


def escape_odata_string(value: str) -> str:
    return value.replace("'", "''")


def normalize_iso_datetime(value: str) -> str:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    if "." not in value:
        return value
    base, rest = value.split(".", 1)
    offset = ""
    frac = rest
    if "+" in rest:
        frac, offset = rest.split("+", 1)
        offset = f"+{offset}"
    elif "-" in rest:
        frac, offset = rest.split("-", 1)
        offset = f"-{offset}"
    frac = (frac + "000000")[:6]
    return f"{base}.{frac}{offset}"


def resolve_timezone(label: str | None, default_tz: pytz.BaseTzInfo) -> pytz.BaseTzInfo:
    if label:
        if "/" in label:
            try:
                return pytz.timezone(label)
            except Exception:
                pass
        mapped = WINDOWS_TZ_MAP.get(label)
        if mapped:
            try:
                return pytz.timezone(mapped)
            except Exception:
                pass
    return default_tz


def parse_event_time(part: dict | None, output_tz: pytz.BaseTzInfo) -> datetime | None:
    if not part:
        return None
    raw = part.get("dateTime")
    if not raw:
        return None
    value = normalize_iso_datetime(raw)
    try:
        parsed = datetime.fromisoformat(value)
    except Exception:
        return None
    if parsed.tzinfo is None:
        source_tz = resolve_timezone(part.get("timeZone"), output_tz)
        parsed = source_tz.localize(parsed)
    return parsed.astimezone(output_tz)


def fetch_attendance(join_url: str | None, headers: dict) -> tuple[int, list[str]] | None:
    if not join_url:
        return None
    try:
        response = requests.get(
            "https://graph.microsoft.com/v1.0/me/onlineMeetings",
            headers=headers,
            params={"$filter": f"joinWebUrl eq '{escape_odata_string(join_url)}'"},
        )
        if response.status_code != 200:
            log(f"Attendance lookup failed: {response.status_code} {response.text}")
            return None
        meetings = response.json().get("value", [])
        if not meetings:
            return None
        meeting_id = meetings[0].get("id")
        if not meeting_id:
            return None
        reports_response = requests.get(
            f"https://graph.microsoft.com/v1.0/me/onlineMeetings/{meeting_id}/attendanceReports",
            headers=headers,
        )
        if reports_response.status_code != 200:
            log(f"Attendance reports failed: {reports_response.status_code} {reports_response.text}")
            return None
        reports = reports_response.json().get("value", [])
        if not reports:
            return None
        reports.sort(key=lambda report: report.get("createdDateTime", ""))
        report_id = reports[-1].get("id")
        if not report_id:
            return None
        records_response = requests.get(
            f"https://graph.microsoft.com/v1.0/me/onlineMeetings/{meeting_id}/attendanceReports/{report_id}/attendanceRecords",
            headers=headers,
        )
        if records_response.status_code != 200:
            log(f"Attendance records failed: {records_response.status_code} {records_response.text}")
            return None
        records = records_response.json().get("value", [])
        emails = set()
        for record in records:
            identity = record.get("identity") or {}
            user = identity.get("user") or {}
            email = user.get("email")
            if email:
                emails.add(email)
        return len(records), sorted(emails)
    except Exception as exc:
        log(f"Attendance lookup error: {exc}")
    return None


def looks_like_jwt(value: str) -> bool:
    parts = value.split(".")
    if len(parts) != 3:
        return False
    return all(len(part) > 10 for part in parts)


def extract_token_from_object(data: dict) -> str | None:
    for key in ("secret", "accessToken", "access_token"):
        value = data.get(key)
        if isinstance(value, str) and looks_like_jwt(value):
            return value
    for value in data.values():
        if isinstance(value, dict):
            token = extract_token_from_object(value)
            if token:
                return token
    return None


def extract_access_token(driver) -> str | None:
    try:
        entries = driver.execute_script(
            "return Object.entries(window.localStorage || {}).concat(Object.entries(window.sessionStorage || {}));"
        )
    except Exception as exc:
        log(f"Failed to read storage for token: {exc}")
        return None

    tokens = []
    for _key, raw in entries:
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            if isinstance(raw, str) and looks_like_jwt(raw):
                return raw
            continue
        if isinstance(data, dict):
            if data.get("credentialType") == "AccessToken":
                tokens.append(data)
            else:
                for value in data.values():
                    if isinstance(value, dict) and value.get("credentialType") == "AccessToken":
                        tokens.append(value)
            token = extract_token_from_object(data)
            if token:
                return token
    for token in tokens:
        target = (token.get("target") or "").lower()
        if "graph.microsoft.com" in target:
            secret = token.get("secret")
            if secret:
                return secret
    for token in tokens:
        secret = token.get("secret")
        if secret:
            return secret
    return None


def wait_for_access_token(driver, timeout_seconds: int = 20) -> str | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        token = extract_access_token(driver)
        if token:
            return token
        time.sleep(1.0)
    return None


def trigger_token_request(driver) -> None:
    selectors = [
        (By.XPATH, '//*[@id="request-area"]/div[1]/div[1]/div/button[4]'),
        (By.XPATH, "//button[contains(., 'Access token')]"),
        (By.CSS_SELECTOR, "button[aria-label='Access token']"),
    ]
    for selector in selectors:
        try:
            token_button = WebDriverWait(driver, 6).until(
                EC.element_to_be_clickable(selector)
            )
            token_button.click()
            time.sleep(1)
            break
        except TimeoutException:
            continue

    try:
        run_query_button = WebDriverWait(driver, 8).until(
            EC.element_to_be_clickable(
                (By.XPATH, "//*[@id='main-content']/div[2]/div/div[4]/button")
            )
        )
        run_query_button.click()
        time.sleep(2)
    except TimeoutException:
        return


def extract_token_from_dom(driver) -> str | None:
    try:
        return driver.execute_script(
            """
            const looksLikeJwt = value => {
              if (typeof value !== 'string') return false;
              const parts = value.split('.');
              return parts.length === 3 && parts[0].length > 10 && parts[1].length > 10;
            };
            const fields = Array.from(document.querySelectorAll('input, textarea'));
            for (const field of fields) {
              const value = field.value || field.getAttribute('value') || '';
              if (looksLikeJwt(value)) return value;
            }
            const text = document.body ? document.body.innerText : '';
            if (text) {
              const match = text.match(/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/);
              if (match) return match[0];
            }
            return null;
            """
        )
    except Exception as exc:
        log(f"Failed to read token from DOM: {exc}")
    return None


def try_select_account_tile(driver, username: str | None) -> bool:
    def click_first(elements: list) -> bool:
        for element in elements:
            try:
                text = (element.text or "").strip().lower()
                if "use another account" in text:
                    continue
                element.click()
                return True
            except Exception:
                continue
        return False

    selectors = []
    if username:
        safe_username = username.lower()
        selectors.append(
            (
                By.XPATH,
                "//div[@role='button'][.//*[contains(translate(text(),"
                " 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),"
                f" '{safe_username}')]]",
            )
        )
        selectors.append(
            (
                By.XPATH,
                f"//*[contains(text(), '{username}')]/ancestor::div[@role='button'][1]",
            )
        )
    selectors.append((By.CSS_SELECTOR, "div[data-test-id='accountTile']"))
    selectors.append((By.CSS_SELECTOR, "div[data-test-id='tile']"))
    selectors.append((By.CSS_SELECTOR, "#tilesHolder div[role='button']"))
    selectors.append((By.CSS_SELECTOR, "#tilesHolder div[role='listitem']"))
    selectors.append((By.CSS_SELECTOR, "div[role='option']"))

    for selector in selectors:
        try:
            elements = driver.find_elements(*selector)
        except Exception:
            elements = []
        if elements:
            if click_first(elements):
                return True
    return False


def main() -> int:
    args = parse_args()
    username = os.getenv("MS_USERNAME", "").strip()
    password = os.getenv("MS_PASSWORD", "").strip()

    start_of_month, end_of_month, month_key = month_range(args.month)
    api_url = (
        "https://graph.microsoft.com/v1.0/me/events"
        f"?$filter=start/dateTime ge '{start_of_month}' and end/dateTime le '{end_of_month}'"
        "&$select=subject,start,end,attendees,onlineMeeting,onlineMeetingUrl"
        "&$top=200"
    )

    driver = build_driver(args.browser, args.headless)

    try:
        driver.get(GRAPH_EXPLORER_URL)
        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )
        log("Graph Explorer loaded.")
        access_token = wait_for_access_token(driver, 10)
        if access_token:
            log("Using existing Microsoft session.")

        sign_in_clicked = False
        if not access_token:
            try:
                sign_in_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable(
                        (
                            By.CSS_SELECTOR,
                            "#root > div > div > div.___1cj2dat.f22iagw.f122n59.f1869bpl.f4ey0zi.ff2sm71.f1db7c0c.febqm8h > div.___cnp5r70.f22iagw.f122n59.f1l02sjl.f1immsc2.f1q8lukm > button:nth-child(10)",
                        )
                    )
                )
                sign_in_button.click()
                sign_in_clicked = True
            except TimeoutException:
                log("Sign In button not found. Assuming session is already active.")

        time.sleep(2)

        if sign_in_clicked and not access_token:
            credentials_available = bool(username and password)
            if not credentials_available:
                log("Missing MS_USERNAME or MS_PASSWORD for sign-in.")

            if sign_in_clicked:
                login_window_found = False
                for handle in driver.window_handles:
                    driver.switch_to.window(handle)
                    if "Sign in" in driver.title:
                        login_window_found = True
                        break

                if not login_window_found:
                    log("Login window not found.")
                    sign_in_clicked = False

                if sign_in_clicked:
                    WebDriverWait(driver, 20).until(
                        EC.presence_of_element_located((By.TAG_NAME, "body"))
                    )

                    if args.browser == "safari":
                        dismiss_safari_cookie_prompt()

                    account_picked = False
                    username_field = None
                    try:
                        username_field = WebDriverWait(driver, 8).until(
                            EC.presence_of_element_located((By.NAME, "loginfmt"))
                        )
                    except TimeoutException:
                        time.sleep(1)
                        account_picked = try_select_account_tile(
                            driver, username if username else None
                        )
                        if account_picked:
                            log("Selected existing account tile.")

                    if username_field:
                        if not username:
                            log("Username required but MS_USERNAME is empty.")
                            sign_in_clicked = False
                        else:
                            username_field.send_keys(username)
                            username_field.send_keys(Keys.RETURN)
                    elif not account_picked:
                        log("Username field not found. Skipping login and reusing session.")
                        sign_in_clicked = False
                        driver.switch_to.window(driver.window_handles[0])
                        access_token = wait_for_access_token(driver, 20)
                        if access_token:
                            log("Recovered access token from existing session.")
                        else:
                            log("No access token found after skipping login.")

                if sign_in_clicked:
                    password_field = None
                    password_used = False
                    try:
                        password_field = WebDriverWait(driver, 8).until(
                            EC.presence_of_element_located((By.NAME, "passwd"))
                        )
                    except TimeoutException:
                        password_field = None
                    if password_field:
                        if not password:
                            log("Password required but MS_PASSWORD is empty.")
                            sign_in_clicked = False
                        else:
                            password_field.send_keys(password)
                            password_field.send_keys(Keys.RETURN)
                            password_used = True

                if sign_in_clicked:
                    try:
                        time.sleep(2)
                        sign_in_button_after_password = WebDriverWait(driver, 6).until(
                            EC.element_to_be_clickable((By.ID, "idSIButton9"))
                        )
                        sign_in_button_after_password.click()
                        if password_used:
                            log("Clicked sign-in button after password.")
                        else:
                            log("Clicked continue button after account selection.")
                    except TimeoutException as exc:
                        if password_used:
                            log(f"Sign In button after password not found. {exc}")
                    except StaleElementReferenceException:
                        try:
                            sign_in_button_after_password = WebDriverWait(driver, 6).until(
                                EC.element_to_be_clickable((By.ID, "idSIButton9"))
                            )
                            sign_in_button_after_password.click()
                        except Exception as exc:
                            log(f"Failed to click Sign In button. {exc}")

                if sign_in_clicked:
                    try:
                        send_me_push_button = WebDriverWait(driver, 10).until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, "button.auth-button.positive"))
                        )
                        send_me_push_button.click()
                        driver.switch_to.default_content()
                        time.sleep(10)
                    except TimeoutException:
                        log("Duo push button not found. Continuing.")

                    try:
                        time.sleep(5)
                        stay_signed_in_button = WebDriverWait(driver, 10).until(
                            EC.element_to_be_clickable((By.ID, "idBtn_Back"))
                        )
                        stay_signed_in_button.click()
                    except TimeoutException:
                        pass

                if sign_in_clicked and not access_token:
                    graph_window_found = False
                    for handle in driver.window_handles:
                        driver.switch_to.window(handle)
                        if "Graph Explorer" in driver.title:
                            graph_window_found = True
                            break
                    if not graph_window_found:
                        driver.get(GRAPH_EXPLORER_URL)
                        WebDriverWait(driver, 20).until(
                            EC.presence_of_element_located((By.TAG_NAME, "body"))
                        )
                    log("Waiting for access token after sign-in...")
                    access_token = wait_for_access_token(driver, 60)
                    if access_token:
                        log("Access token found after sign-in.")

        graph_explorer_window_found = False
        for handle in driver.window_handles:
            driver.switch_to.window(handle)
            if "Graph Explorer" in driver.title:
                graph_explorer_window_found = True
                break
        if not graph_explorer_window_found:
            log("Graph Explorer window not found.")
            return 1

        try:
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located(
                    (By.XPATH, "//*[@id='main-content']/div[2]/div/div[4]/button")
                )
            )
        except (TimeoutException, NoSuchWindowException) as exc:
            log(f"Timed out waiting for Run query button. {exc}")
            if access_token:
                log("Proceeding with cached access token.")
            else:
                return 1

        time.sleep(5)

        if not args.headless:
            try:
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located(
                        (By.XPATH, '//*[@id="request-area"]/div[1]/div[1]/div/button[4]')
                    )
                ).click()

                time.sleep(2)

                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located(
                        (By.XPATH, '//*[@id="styles-auth"]/div/div[1]/button')
                    )
                ).click()

                access_token = subprocess.check_output("pbpaste", shell=True).decode().strip()
            except TimeoutException as exc:
                log(f"Failed to locate token controls. {exc}")
        if not access_token:
            access_token = wait_for_access_token(driver, 20)
        if not access_token:
            log("Triggering token request from Graph Explorer UI...")
            trigger_token_request(driver)
            access_token = wait_for_access_token(driver, 20)
        if not access_token:
            access_token = extract_token_from_dom(driver)
        if not access_token:
            log("Failed to obtain access token from Graph Explorer.")
            return 1

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Prefer": f'outlook.timezone="{args.tz}"',
        }

        all_events = fetch_events(api_url, headers)

        meetings = []
        tz = pytz.timezone(args.tz)
        for event in all_events:
            subject = event.get("subject", "No Subject")
            start_part = event.get("start", {})
            end_part = event.get("end", {})
            attendees_raw = event.get("attendees", [])
            attendee_names = []
            attendee_emails = []
            for attendee in attendees_raw:
                email_info = attendee.get("emailAddress") or {}
                name = email_info.get("name")
                address = email_info.get("address")
                if name:
                    attendee_names.append(name)
                if address:
                    attendee_emails.append(address)
            attendees = ", ".join(attendee_names)
            join_url = event.get("onlineMeetingUrl") or (event.get("onlineMeeting") or {}).get("joinUrl")
            start_local = parse_event_time(start_part, tz)
            end_local = parse_event_time(end_part, tz)
            if not start_local or not end_local:
                continue
            attendance_info = fetch_attendance(join_url, headers) if args.attendance else None
            attendance_count = attendance_info[0] if attendance_info else None
            attendance_emails = attendance_info[1] if attendance_info else []
            meetings.append(
                {
                    "subject": subject,
                    "startTime": start_local.strftime("%Y-%m-%d %H:%M:%S"),
                    "endTime": end_local.strftime("%Y-%m-%d %H:%M:%S"),
                    "participants": attendees,
                    "attendanceCount": attendance_count,
                    "attendanceEmails": attendance_emails,
                    "attendeeEmails": attendee_emails,
                }
            )

        if args.csv:
            with open(args.csv, "w", newline="", encoding="utf-8") as csvfile:
                writer = csv.DictWriter(
                    csvfile,
                    fieldnames=[
                        "Meeting Name",
                        "Start Time",
                        "End Time",
                        "Attendance",
                        "Participants",
                    ],
                )
                writer.writeheader()
                for meeting in meetings:
                    writer.writerow(
                        {
                            "Meeting Name": meeting["subject"],
                            "Start Time": meeting["startTime"],
                            "End Time": meeting["endTime"],
                            "Attendance": ", ".join(meeting.get("attendanceEmails", []))
                            or meeting.get("attendanceCount"),
                            "Participants": meeting["participants"],
                        }
                    )

        output = {"month": month_key, "count": len(meetings), "meetings": meetings}
        print(json.dumps(output, ensure_ascii=False))
        return 0
    finally:
        driver.quit()


if __name__ == "__main__":
    sys.exit(main())

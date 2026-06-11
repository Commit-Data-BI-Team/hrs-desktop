import argparse
import base64
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlparse

import csv
import shutil
import pytz
import requests
from urllib3.exceptions import ProtocolError
from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchElementException,
    NoSuchWindowException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
import subprocess


GRAPH_EXPLORER_URL = "https://developer.microsoft.com/en-us/graph/graph-explorer"
GRAPH_EXPLORER_CLIENT_ID = "de8bc8b5-d9f9-48b1-a8ad-b748da725064"
GRAPH_EXPLORER_SCOPES = (
    "https://graph.microsoft.com/Calendars.Read "
    "https://graph.microsoft.com/User.Read "
    "openid profile"
)
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


try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


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
    args = parser.parse_args()
    if args.browser == "safari" and sys.platform != "darwin":
        args.browser = "chrome"
    return args


def month_range(month_value: str | None, timezone_name: str) -> tuple[str, str, str]:
    try:
        local_tz = pytz.timezone(timezone_name)
    except Exception:
        local_tz = pytz.timezone("Asia/Jerusalem")
    now = datetime.now(local_tz)
    if month_value:
        try:
            year, month = month_value.split("-")
            start = local_tz.localize(datetime(int(year), int(month), 1))
        except ValueError:
            raise ValueError("Invalid --month format. Use YYYY-MM.")
    else:
        start = local_tz.localize(datetime(now.year, now.month, 1))
    if start.month == 12:
        next_month = local_tz.localize(datetime(start.year + 1, 1, 1))
    else:
        next_month = local_tz.localize(datetime(start.year, start.month + 1, 1))
    end = next_month - timedelta(seconds=1)
    start_iso = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
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


def version_tuple(value: str) -> tuple[int, ...]:
    parts = []
    for part in value.split("."):
        if not part.isdigit():
            break
        parts.append(int(part))
    return tuple(parts)


def executable_file(path: str | None) -> str | None:
    if path and os.path.isfile(path) and (os.name == "nt" or os.access(path, os.X_OK)):
        return path
    return None


def selenium_cache_kind_root(kind: str) -> str:
    return os.path.expanduser(os.path.join("~", ".cache", "selenium", kind))


def selenium_cache_entries(kind: str) -> list[tuple[tuple[int, ...], str, str]]:
    root = selenium_cache_kind_root(kind)
    if not os.path.isdir(root):
        return []
    entries: list[tuple[tuple[int, ...], str, str]] = []
    for arch in os.listdir(root):
        arch_root = os.path.join(root, arch)
        if not os.path.isdir(arch_root):
            continue
        for version in os.listdir(arch_root):
            version_root = os.path.join(arch_root, version)
            if os.path.isdir(version_root):
                entries.append((version_tuple(version), version, version_root))
    return sorted(entries, reverse=True)


def find_cached_executable(root: str, names: set[str]) -> str | None:
    for current_root, _dirs, files in os.walk(root):
        for filename in files:
            if filename in names:
                found = executable_file(os.path.join(current_root, filename))
                if found:
                    return found
    return None


def discover_chrome_binary() -> str | None:
    env_path = executable_file(
        os.getenv("MEETINGS_CHROME_BINARY", "").strip()
        or os.getenv("AGENDA_CHROME_BINARY", "").strip()
        or os.getenv("CHROME_BINARY", "").strip()
    )
    if env_path:
        return env_path
    if os.name == "nt":
        candidates = [
            os.path.join(os.getenv("PROGRAMFILES", ""), "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(os.getenv("PROGRAMFILES(X86)", ""), "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(os.getenv("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(os.getenv("PROGRAMFILES", ""), "Chromium", "Application", "chrome.exe"),
        ]
    else:
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            shutil.which("google-chrome") or "",
            shutil.which("chromium") or "",
            shutil.which("chromium-browser") or "",
        ]
    for candidate in candidates:
        found = executable_file(candidate)
        if found:
            return found
    cached = cached_chrome_binaries()
    return cached[0][2] if cached else None


def cached_chrome_binaries() -> list[tuple[tuple[int, ...], str, str]]:
    cached: list[tuple[tuple[int, ...], str, str]] = []
    executable_names = {"chrome.exe"} if os.name == "nt" else {"Google Chrome for Testing", "chrome"}
    for version_data, version, root in selenium_cache_entries("chrome"):
        candidate = find_cached_executable(root, executable_names)
        if candidate:
            cached.append((version_data, version, candidate))
    return sorted(cached, reverse=True)


def cached_chromedrivers() -> list[tuple[tuple[int, ...], str, str]]:
    cached: list[tuple[tuple[int, ...], str, str]] = []
    executable_names = {"chromedriver.exe"} if os.name == "nt" else {"chromedriver"}
    for version_data, version, root in selenium_cache_entries("chromedriver"):
        candidate = find_cached_executable(root, executable_names)
        if candidate:
            cached.append((version_data, version, candidate))
    return sorted(cached, reverse=True)


def cached_chrome_driver_pair() -> tuple[str, str] | None:
    drivers_by_major = {
        version.split(".", 1)[0]: (version, path)
        for _version_tuple, version, path in cached_chromedrivers()
        if version
    }
    for _version_tuple, chrome_version, chrome_path in cached_chrome_binaries():
        major = chrome_version.split(".", 1)[0]
        driver = drivers_by_major.get(major)
        if driver:
            driver_version, driver_path = driver
            log(
                "Using cached Chrome for Testing pair "
                f"chrome={chrome_version} chromedriver={driver_version}"
            )
            return chrome_path, driver_path
    return None


def chrome_binary_version(binary_path: str | None) -> str | None:
    if not binary_path:
        return None
    try:
        output = subprocess.check_output([binary_path, "--version"], text=True, timeout=5)
    except Exception:
        return None
    match = output.strip().split()
    for part in match:
        if part and part[0].isdigit():
            return part
    return None


def discover_chromedriver(chrome_version: str | None) -> str | None:
    env_path = executable_file(
        os.getenv("MEETINGS_CHROMEDRIVER", "").strip()
        or os.getenv("AGENDA_CHROMEDRIVER", "").strip()
        or os.getenv("CHROMEDRIVER", "").strip()
    )
    if env_path:
        return env_path
    found = executable_file(shutil.which("chromedriver"))
    if found:
        return found
    chrome_major = chrome_version.split(".", 1)[0] if chrome_version else None
    cached = [
        (version_data, version, candidate)
        for version_data, version, candidate in cached_chromedrivers()
        if chrome_major and version.startswith(f"{chrome_major}.")
    ]
    if cached:
        return cached[0][2]
    if chrome_major:
        log(f"No cached ChromeDriver matched Chrome major version {chrome_major}.")
    return None


def build_driver(browser: str, headless: bool):
    if browser == "chrome":
        options = webdriver.ChromeOptions()
        chrome_binary = discover_chrome_binary()
        chrome_version = chrome_binary_version(chrome_binary)
        chromedriver = discover_chromedriver(chrome_version)
        if chrome_binary and chrome_version and not chromedriver:
            pair = cached_chrome_driver_pair()
            if pair:
                chrome_binary, chromedriver = pair
                chrome_version = chrome_binary_version(chrome_binary)
        if chrome_binary:
            options.binary_location = chrome_binary
            log(f"Using Chrome binary: {chrome_binary}")
        if chromedriver:
            log(f"Using ChromeDriver: {chromedriver}")
        profile_dir = (
            os.getenv("AGENDA_CHROME_PROFILE", "").strip()
            or os.getenv("MEETINGS_CHROME_PROFILE", "").strip()
        )
        if profile_dir:
            options.add_argument(f"--user-data-dir={profile_dir}")
            options.add_argument("--profile-directory=Default")
        options.add_argument("--disable-logging")
        options.add_argument("--log-level=3")
        options.add_argument("--silent")
        options.add_experimental_option("excludeSwitches", ["enable-logging"])
        if not (os.name == "nt" and headless):
            options.add_argument("--start-maximized")
        if headless:
            log("Background mode enabled. Running Chrome headless.")
            options.add_argument("--headless=new")
            options.add_argument("--window-size=1280,900")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")
            if os.name == "nt":
                options.add_argument("--disable-features=MediaRouter,OptimizationHints,Translate")
                options.add_argument("--remote-debugging-pipe")
        if chromedriver:
            service = ChromeService(executable_path=chromedriver, log_output=subprocess.DEVNULL)
            return webdriver.Chrome(service=service, options=options)
        return webdriver.Chrome(options=options)
    return webdriver.Safari()


def fetch_events(url: str, headers: dict) -> list[dict]:
    events = []
    while url:
        response = requests.get(url, headers=headers, timeout=60)
        if response.status_code == 200:
            response_json = response.json()
            events.extend(response_json.get("value", []))
            url = response_json.get("@odata.nextLink")
        else:
            raise RuntimeError(
                f"Graph calendar request failed {response.status_code}: {response.text[:500]}"
            )
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
    if not part or not isinstance(part, dict):
        return None
    raw = part.get("dateTime")
    if not raw or not isinstance(raw, str):
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


def event_subject_for_log(event: object, index: int) -> str:
    if not isinstance(event, dict):
        return f"event_{index + 1}"
    subject = event.get("subject")
    if isinstance(subject, str) and subject.strip():
        return subject.strip()[:120]
    return f"event_{index + 1}"


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


def normalize_token_value(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    clean = value.strip().strip('"').strip("'")
    if clean.lower().startswith("bearer "):
        clean = clean.split(None, 1)[1].strip()
    return clean


def looks_like_jwt(value: str) -> bool:
    value = normalize_token_value(value)
    parts = value.split(".")
    if len(parts) != 3:
        return False
    if not all(len(part) > 10 for part in parts):
        return False
    try:
        padded = parts[0] + "=" * (-len(parts[0]) % 4)
        header = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        return isinstance(header, dict) and bool(header.get("alg"))
    except Exception:
        return False


def decode_jwt_payload(value: str) -> dict:
    value = normalize_token_value(value)
    parts = value.split(".")
    if len(parts) != 3:
        return {}
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def token_rejection_reason(value: str | None) -> str:
    token = normalize_token_value(value)
    if not token:
        return "empty"
    parts = token.split(".")
    if len(parts) != 3:
        return "not_jwt"
    if not all(len(part) > 10 for part in parts):
        return "short_jwt_parts"
    if not looks_like_jwt(token):
        return "bad_jwt_header"
    payload = decode_jwt_payload(token)
    if not payload:
        return "bad_jwt_payload"
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and exp < time.time() + 60:
        return "expired"
    audience = str(payload.get("aud") or "").lower()
    scopes = str(payload.get("scp") or "").lower()
    roles = payload.get("roles")
    is_graph_audience = (
        "graph.microsoft.com" in audience
        or audience == "00000003-0000-0000-c000-000000000000"
    )
    has_graph_scope = any(scope in scopes for scope in ["calendars.read", "calendars.readbasic", "user.read"])
    if is_graph_audience and (has_graph_scope or isinstance(roles, list)):
        return "accepted"
    if is_graph_audience:
        return "accepted"
    return "not_graph_access_token"


def looks_like_graph_access_token(value: str) -> bool:
    return token_rejection_reason(value) == "accepted"


def build_direct_graph_authorize_url() -> str:
    params = {
        "client_id": GRAPH_EXPLORER_CLIENT_ID,
        "response_type": "token",
        "redirect_uri": GRAPH_EXPLORER_URL,
        "response_mode": "fragment",
        "scope": GRAPH_EXPLORER_SCOPES,
        "prompt": "select_account",
    }
    return f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?{urlencode(params)}"


def extract_access_token_from_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    for part in (parsed.fragment, parsed.query):
        if not part:
            continue
        values = parse_qs(part)
        for key in ("access_token", "token"):
            token = normalize_token_value((values.get(key) or [None])[0])
            if looks_like_graph_access_token(token):
                return token
    return None


def wait_for_access_token_in_current_url(driver, timeout_seconds: int = 12) -> str | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            token = extract_access_token_from_url(driver.current_url)
            if token:
                log("Microsoft Graph token acquired from Microsoft redirect URL.")
                return token
        except Exception:
            pass
        time.sleep(0.5)
    return None


def click_stay_signed_in_confirmation(driver) -> bool:
    try:
        body_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
    except Exception:
        body_text = ""
    if "stay signed in" not in body_text and "keep me signed in" not in body_text:
        return False
    selectors = [
        (By.ID, "idSIButton9"),
        (By.CSS_SELECTOR, "input[type='submit']"),
        (By.XPATH, "//button[contains(., 'Yes') or contains(., 'Continue')]"),
    ]
    for selector in selectors:
        try:
            button = WebDriverWait(driver, 2).until(EC.element_to_be_clickable(selector))
            button.click()
            log("Clicked stay-signed-in confirmation.")
            return True
        except TimeoutException:
            continue
        except StaleElementReferenceException:
            continue
    return False


def wait_for_microsoft_redirect_after_duo(driver, timeout_seconds: int = 90) -> str | None:
    deadline = time.time() + timeout_seconds
    last_log = 0.0
    while time.time() < deadline:
        token = wait_for_access_token_in_current_url(driver, 1)
        if token:
            return token
        try:
            if click_stay_signed_in_confirmation(driver):
                time.sleep(2)
                continue
        except (WebDriverException, ProtocolError, OSError) as exc:
            if not is_browser_transport_error(exc):
                raise
        token = extract_access_token(driver)
        if token:
            log("Microsoft Graph token acquired after DUO redirect.")
            return token
        now = time.time()
        if now - last_log > 10:
            log("Waiting for Microsoft redirect after DUO approval.")
            last_log = now
        time.sleep(1.0)
    return None


def collect_token_candidates_from_object(data, source: str, key: str) -> list[dict]:
    candidates = []
    if isinstance(data, str):
        token = normalize_token_value(data)
        if token.count(".") == 2:
            candidates.append({"source": source, "key": key, "token": token})
        return candidates
    if isinstance(data, list):
        for index, value in enumerate(data[:50]):
            candidates.extend(collect_token_candidates_from_object(value, source, f"{key}[{index}]"))
        return candidates
    if not isinstance(data, dict):
        return candidates
    credential_type = data.get("credentialType")
    target = data.get("target") or data.get("scopes") or data.get("scope")
    for token_key in ("secret", "accessToken", "access_token"):
        token = normalize_token_value(data.get(token_key))
        if token:
            candidates.append({
                "source": source,
                "key": f"{key}.{token_key}",
                "credentialType": credential_type,
                "target": target,
                "token": token,
            })
    for child_key, value in data.items():
        if child_key in {"secret", "accessToken", "access_token", "idToken", "id_token"}:
            continue
        candidates.extend(collect_token_candidates_from_object(value, source, f"{key}.{child_key}"))
    return candidates


def select_calendar_token(candidates: list[dict], context: str) -> str | None:
    for candidate in candidates:
        token = normalize_token_value(candidate.get("token"))
        reason = token_rejection_reason(token)
        if reason == "accepted":
            log(f"Microsoft Graph token acquired from {context}.")
            return token
    return None


def extract_access_token_from_indexeddb(driver) -> str | None:
    try:
        candidates = driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            const output = [];
            const maxCandidates = 80;
            const scan = (value, path, depth = 0) => {
              if (output.length >= maxCandidates || depth > 8 || value == null) return;
              if (typeof value === 'string') {
                if (value.includes('.') || value.includes('AccessToken') || value.includes('graph.microsoft.com')) {
                  output.push({key: path, value});
                }
                return;
              }
              if (Array.isArray(value)) {
                for (let index = 0; index < value.length && index < 50; index += 1) scan(value[index], `${path}[${index}]`, depth + 1);
                return;
              }
              if (typeof value !== 'object') return;
              for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`, depth + 1);
            };
            const readStore = (db, storeName) => new Promise(resolve => {
              const rows = [];
              let count = 0;
              try {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const request = store.openCursor();
                request.onerror = () => resolve(rows);
                request.onsuccess = event => {
                  const cursor = event.target.result;
                  if (!cursor || count >= 400) return resolve(rows);
                  rows.push({key: String(cursor.key), value: cursor.value});
                  count += 1;
                  cursor.continue();
                };
              } catch (_error) {
                resolve(rows);
              }
            });
            const openDatabase = name => new Promise(resolve => {
              try {
                const request = indexedDB.open(name);
                request.onerror = () => resolve(null);
                request.onsuccess = () => resolve(request.result);
                request.onblocked = () => resolve(null);
              } catch (_error) {
                resolve(null);
              }
            });
            (async () => {
              try {
                if (!window.indexedDB || !indexedDB.databases) return done([]);
                const databases = await indexedDB.databases();
                for (const databaseInfo of databases) {
                  if (output.length >= maxCandidates) break;
                  const dbName = databaseInfo && databaseInfo.name;
                  if (!dbName) continue;
                  const db = await openDatabase(dbName);
                  if (!db) continue;
                  for (const storeName of Array.from(db.objectStoreNames || [])) {
                    if (output.length >= maxCandidates) break;
                    const rows = await readStore(db, storeName);
                    for (const row of rows) {
                      scan(row.value, `${dbName}.${storeName}.${row.key}`);
                      if (output.length >= maxCandidates) break;
                    }
                  }
                  db.close();
                }
                done(output);
              } catch (_error) {
                done([]);
              }
            })();
            """
        )
    except Exception as exc:
        log(f"Failed to read token candidates from IndexedDB: {exc}")
        return None
    normalized_candidates = []
    if not isinstance(candidates, list):
        return None
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            continue
        value = candidate.get("value")
        key = str(candidate.get("key") or f"candidate_{index}")[:120]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                normalized_candidates.extend(collect_token_candidates_from_object(parsed, "indexeddb", key))
                continue
            except Exception:
                pass
        normalized_candidates.extend(collect_token_candidates_from_object(value, "indexeddb", key))
    return select_calendar_token(normalized_candidates, "IndexedDB")


def graph_secret_from_token_record(record: dict) -> str | None:
    secret = normalize_token_value(record.get("secret"))
    if not looks_like_graph_access_token(secret):
        return None
    target = (record.get("target") or record.get("scopes") or "").lower()
    if target and "graph.microsoft.com" not in target:
        return None
    return secret


def extract_token_from_object(data: dict) -> str | None:
    for key in ("secret", "accessToken", "access_token"):
        value = normalize_token_value(data.get(key))
        if looks_like_graph_access_token(value):
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

    candidates = []
    tokens = []
    for _key, raw in entries:
        if not raw:
            continue
        storage_key = str(_key)[:120]
        try:
            data = json.loads(raw)
        except Exception:
            raw_token = normalize_token_value(raw)
            if raw_token.count(".") == 2:
                candidates.append({"source": "browser_storage_raw", "key": storage_key, "token": raw_token})
            continue
        if isinstance(data, dict):
            candidates.extend(collect_token_candidates_from_object(data, "browser_storage", storage_key))
            if data.get("credentialType") == "AccessToken":
                tokens.append(data)
            else:
                for value in data.values():
                    if isinstance(value, dict) and value.get("credentialType") == "AccessToken":
                        tokens.append(value)
    for token in tokens:
        secret = graph_secret_from_token_record(token)
        if secret:
            return secret
    for token in tokens:
        secret = normalize_token_value(token.get("secret"))
        if looks_like_graph_access_token(secret):
            return secret
    selected = select_calendar_token(candidates, "browser storage")
    if selected:
        return selected
    for _key, raw in entries:
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, dict):
            secret = extract_token_from_object(data)
            if secret:
                return secret
    return None


def wait_for_access_token(driver, timeout_seconds: int = 20, include_indexeddb: bool = True) -> str | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        token = extract_access_token(driver)
        if token:
            return token
        if include_indexeddb:
            token = extract_access_token_from_indexeddb(driver)
            if token:
                return token
        time.sleep(1.0)
    return None


def click_first_available(driver, selectors: list[tuple[str, str]], timeout_seconds: int = 5) -> bool:
    for selector in selectors:
        try:
            element = WebDriverWait(driver, timeout_seconds).until(
                EC.element_to_be_clickable(selector)
            )
            element.click()
            return True
        except TimeoutException:
            continue
        except StaleElementReferenceException:
            continue
    return False


def open_access_token_panel(driver) -> bool:
    selectors = [
        (By.XPATH, '//*[@id="request-area"]/div[1]/div[1]/div/button[4]'),
        (By.XPATH, "//button[contains(., 'Access token')]"),
        (By.CSS_SELECTOR, "button[aria-label='Access token']"),
    ]
    if not click_first_available(driver, selectors, 6):
        log("Graph Explorer access token panel not found.")
        return False
    log("Opened Graph Explorer access token panel.")
    time.sleep(1)
    return True


def trigger_token_request(driver) -> None:
    open_access_token_panel(driver)


def extract_token_from_dom(driver) -> str | None:
    try:
        raw_candidates = driver.execute_script(
            """
            const candidates = [];
            const seen = new Set();
            const addCandidate = (value, source, key) => {
              if (typeof value !== 'string') return false;
              const matches = value.match(/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/g) || [];
              for (const match of matches) {
                if (seen.has(match)) continue;
                seen.add(match);
                candidates.push({ source, key, token: match });
                if (candidates.length >= 80) return;
              }
            };
            const fields = Array.from(document.querySelectorAll('input, textarea'));
            fields.forEach((field, index) => {
              const value = field.value || field.getAttribute('value') || '';
              addCandidate(value, field.tagName.toLowerCase(), `field_${index}`);
            });
            const text = document.body ? document.body.innerText : '';
            addCandidate(text, 'body', 'innerText');
            return candidates;
            """
        )
        candidates = raw_candidates if isinstance(raw_candidates, list) else []
        token = select_calendar_token(candidates, "Graph Explorer access token panel")
        if token:
            return token
        if candidates:
            sample = normalize_token_value(candidates[0].get("token"))
            log(f"No usable calendar token in Graph Explorer panel. first_reason={token_rejection_reason(sample)}")
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


def click_graph_sign_in(driver) -> bool:
    selectors = [
        (
            By.CSS_SELECTOR,
            "#root > div > div > div.___1cj2dat.f22iagw.f122n59.f1869bpl.f4ey0zi.ff2sm71.f1db7c0c.febqm8h > div.___cnp5r70.f22iagw.f122n59.f1l02sjl.f1immsc2.f1q8lukm > button:nth-child(10)",
        ),
        (By.XPATH, "//button[contains(., 'Sign in') or contains(., 'Sign In')]"),
        (By.CSS_SELECTOR, "button[aria-label*='Sign in' i]"),
    ]
    for selector in selectors:
        try:
            button = WebDriverWait(driver, 6).until(EC.element_to_be_clickable(selector))
            button.click()
            return True
        except TimeoutException:
            continue
    return False


def find_graph_explorer_window(driver) -> bool:
    for handle in driver.window_handles:
        try:
            driver.switch_to.window(handle)
            if "Graph Explorer" in driver.title or "developer.microsoft.com" in (driver.current_url or ""):
                return True
        except NoSuchWindowException:
            continue
    return False


def find_login_window(driver) -> bool:
    for handle in driver.window_handles:
        try:
            driver.switch_to.window(handle)
            title = driver.title or ""
            current_url = driver.current_url or ""
            if "Sign in" in title or "login.microsoftonline.com" in current_url:
                return True
        except NoSuchWindowException:
            continue
    return False


def wait_for_login_window(driver, timeout_seconds: int = 20) -> bool:
    deadline = time.time() + timeout_seconds
    last_log = 0.0
    while time.time() < deadline:
        if find_login_window(driver):
            return True
        now = time.time()
        if now - last_log > 8:
            log("Waiting for Microsoft sign-in window.")
            last_log = now
        time.sleep(0.5)
    return False


def is_browser_transport_error(exc: Exception) -> bool:
    message = repr(exc).lower()
    return any(
        term in message
        for term in [
            "no such window",
            "target window already closed",
            "web view not found",
            "connection reset",
            "connection refused",
            "connection broken",
            "protocolerror",
            "invalid session",
            "session deleted",
            "disconnected",
            "failed to decode response",
        ]
    )


def restart_graph_driver(driver, browser: str, headless: bool, reason: str):
    log(f"Restarting browser automation for token recovery. reason={str(reason)[:180]}")
    try:
        driver.quit()
    except Exception:
        pass
    new_driver = build_driver(browser, headless)
    new_driver.get(GRAPH_EXPLORER_URL)
    WebDriverWait(new_driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    log("Graph Explorer reloaded after browser automation restart.")
    return new_driver


def wait_for_graph_explorer_after_duo(driver, timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    last_log = 0.0
    while time.time() < deadline:
        try:
            if find_graph_explorer_window(driver):
                return True
        except (WebDriverException, ProtocolError, OSError) as exc:
            if not is_browser_transport_error(exc):
                raise
        now = time.time()
        if now - last_log > 10:
            log("Waiting for Microsoft sign-in to return to Graph Explorer after DUO approval.")
            last_log = now
        time.sleep(1.0)
    try:
        driver.get(GRAPH_EXPLORER_URL)
        WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        log("Reloaded Graph Explorer after DUO approval.")
        return True
    except Exception as exc:
        log(f"Failed to reload Graph Explorer after DUO approval. {exc}")
        return False


def obtain_graph_token_via_browser(browser: str, headless: bool) -> str:
    username = os.getenv("MS_USERNAME", "").strip()
    password = os.getenv("MS_PASSWORD", "").strip()
    duo_clicked = False
    auth_window_closed = False

    log(f"Opening {browser.title()} for Microsoft Graph authentication.")
    driver = build_driver(browser, headless)
    try:
        driver.get(GRAPH_EXPLORER_URL)
        WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        log("Graph Explorer loaded.")

        access_token = wait_for_access_token(driver, 10)
        if access_token:
            log("Using existing Microsoft session.")
            return access_token

        sign_in_clicked = click_graph_sign_in(driver)
        if sign_in_clicked:
            log("Clicked Graph Explorer sign-in.")
        else:
            log("Sign-in button not found. Checking existing session.")

        time.sleep(2)

        if sign_in_clicked:
            login_window_found = wait_for_login_window(driver, 20)
            if not login_window_found:
                log("Graph Explorer sign-in did not expose Microsoft login. Opening direct Microsoft Graph authorization.")
                driver.get(build_direct_graph_authorize_url())
                WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                access_token = wait_for_access_token_in_current_url(driver, 4)
                if access_token:
                    return access_token
                login_window_found = wait_for_login_window(driver, 20)
            if login_window_found:
                WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                if browser == "safari":
                    dismiss_safari_cookie_prompt()

                account_picked = False
                username_field = None
                try:
                    username_field = WebDriverWait(driver, 8).until(
                        EC.presence_of_element_located((By.NAME, "loginfmt"))
                    )
                except TimeoutException:
                    account_picked = try_select_account_tile(driver, username if username else None)
                    if account_picked:
                        log("Selected existing account tile.")

                if username_field:
                    if not username:
                        log("Username required but MS_USERNAME is empty.")
                    else:
                        username_field.send_keys(username)
                        username_field.send_keys(Keys.RETURN)
                elif not account_picked:
                    log("Username field not found. Reusing current browser session.")
                    if find_graph_explorer_window(driver):
                        access_token = wait_for_access_token(driver, 20)
                        if access_token:
                            log("Recovered Graph access token from existing session.")
                            return access_token
                password_field = None
                try:
                    password_field = WebDriverWait(driver, 8).until(
                        EC.presence_of_element_located((By.NAME, "passwd"))
                    )
                except TimeoutException:
                    password_field = None
                except (NoSuchWindowException, WebDriverException) as exc:
                    if isinstance(exc, NoSuchWindowException) or is_browser_transport_error(exc):
                        auth_window_closed = True
                    log(f"Password step unavailable after account selection. Continuing. reason={exc.__class__.__name__}")

                password_used = False
                if password_field:
                    if not password:
                        log("Password required but MS_PASSWORD is empty.")
                    else:
                        password_field.send_keys(password)
                        password_field.send_keys(Keys.RETURN)
                        password_used = True

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
                except TimeoutException:
                    pass
                except StaleElementReferenceException:
                    try:
                        sign_in_button_after_password = WebDriverWait(driver, 6).until(
                            EC.element_to_be_clickable((By.ID, "idSIButton9"))
                        )
                        sign_in_button_after_password.click()
                    except Exception:
                        log("Failed to click final sign-in button. Continuing.")
                except (NoSuchWindowException, WebDriverException) as exc:
                    if isinstance(exc, NoSuchWindowException) or is_browser_transport_error(exc):
                        auth_window_closed = True
                    log(f"Microsoft continue step unavailable. Continuing. reason={exc.__class__.__name__}")

                if auth_window_closed:
                    log("Microsoft auth window closed before DUO inspection. Continuing token recovery from Graph Explorer.")
                else:
                    try:
                        send_me_push_button = WebDriverWait(driver, 10).until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, "button.auth-button.positive"))
                        )
                        send_me_push_button.click()
                        duo_clicked = True
                        log("Clicked DUO push button.")
                        log("Waiting for DUO approval on user's phone.")
                        driver.switch_to.default_content()
                        time.sleep(10)
                    except TimeoutException:
                        log("DUO push button not found. Continuing.")
                    except (NoSuchWindowException, WebDriverException, ProtocolError, OSError) as exc:
                        if isinstance(exc, NoSuchWindowException) or is_browser_transport_error(exc):
                            auth_window_closed = True
                            log(
                                "Microsoft auth window closed while checking DUO. "
                                "Continuing token recovery from Graph Explorer."
                            )
                        else:
                            raise

                if duo_clicked:
                    access_token = wait_for_microsoft_redirect_after_duo(driver, 90)
                elif not auth_window_closed:
                    click_stay_signed_in_confirmation(driver)
                    access_token = wait_for_access_token_in_current_url(driver, 20)
                else:
                    access_token = None
                if access_token:
                    return access_token
            else:
                log("Microsoft sign-in window not detected after direct authorization. Continuing token recovery.")

        try:
            graph_window_found = find_graph_explorer_window(driver)
            if not graph_window_found:
                driver.get(GRAPH_EXPLORER_URL)
                WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        except (WebDriverException, ProtocolError, OSError) as exc:
            if not is_browser_transport_error(exc):
                raise
            driver = restart_graph_driver(driver, browser, headless, str(exc))

        log("Waiting for Graph access token.")
        try:
            if duo_clicked:
                wait_for_graph_explorer_after_duo(driver, 60)
            access_token = wait_for_access_token(driver, 30, include_indexeddb=True)
            if not access_token:
                log("Triggering token request from Graph Explorer UI.")
                trigger_token_request(driver)
                access_token = wait_for_access_token(driver, 30, include_indexeddb=True)
            if not access_token:
                access_token = extract_token_from_dom(driver)
        except (WebDriverException, ProtocolError, OSError) as exc:
            if not is_browser_transport_error(exc):
                raise
            driver = restart_graph_driver(driver, browser, headless, str(exc))
            if duo_clicked:
                wait_for_graph_explorer_after_duo(driver, 60)
            access_token = wait_for_access_token(driver, 30, include_indexeddb=True)
            if not access_token:
                trigger_token_request(driver)
                access_token = wait_for_access_token(driver, 30, include_indexeddb=True)
            if not access_token:
                access_token = extract_token_from_dom(driver)

        if not access_token:
            raise RuntimeError("Failed to obtain Graph access token from browser automation.")
        access_token = normalize_token_value(access_token)
        if not looks_like_graph_access_token(access_token):
            raise RuntimeError(
                "Graph Explorer returned an invalid Microsoft Graph access token. "
                f"reason={token_rejection_reason(access_token)}"
            )
        log("Graph access token acquired.")
        return access_token
    finally:
        driver.quit()


def main() -> int:
    args = parse_args()
    username = os.getenv("MS_USERNAME", "").strip()
    password = os.getenv("MS_PASSWORD", "").strip()

    start_of_month, end_of_month, month_key = month_range(args.month, args.tz)
    api_url = (
        "https://graph.microsoft.com/v1.0/me/calendarView"
        f"?startDateTime={start_of_month}&endDateTime={end_of_month}"
        "&$select=subject,start,end,attendees,onlineMeeting,onlineMeetingUrl"
        "&$orderby=start/dateTime"
        "&$top=200"
    )
    log(f"Meeting date window: {month_key} ({start_of_month} -> {end_of_month}).")

    access_token = obtain_graph_token_via_browser(args.browser, args.headless)

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": f'outlook.timezone="{args.tz}"',
    }

    log("Fetching calendarView events from Microsoft Graph.")
    all_events = fetch_events(api_url, headers)
    log(f"Microsoft Graph returned {len(all_events)} raw calendar events.")

    meetings = []
    tz = pytz.timezone(args.tz)
    skipped_events = 0
    for index, event in enumerate(all_events):
        try:
            if not isinstance(event, dict):
                skipped_events += 1
                log(f"Skipping malformed calendar event {index + 1}: payload is {type(event).__name__}.")
                continue

            raw_subject = event.get("subject")
            subject = raw_subject.strip() if isinstance(raw_subject, str) and raw_subject.strip() else "No Subject"
            start_part = event.get("start") if isinstance(event.get("start"), dict) else None
            end_part = event.get("end") if isinstance(event.get("end"), dict) else None
            attendees_raw = event.get("attendees")
            if not isinstance(attendees_raw, list):
                attendees_raw = []

            attendee_names = []
            attendee_emails = []
            for attendee in attendees_raw:
                if not isinstance(attendee, dict):
                    continue
                email_info = attendee.get("emailAddress") or {}
                if not isinstance(email_info, dict):
                    continue
                name = email_info.get("name")
                address = email_info.get("address")
                if isinstance(name, str) and name:
                    attendee_names.append(name)
                if isinstance(address, str) and address:
                    attendee_emails.append(address)
            attendees = ", ".join(attendee_names)

            online_meeting = event.get("onlineMeeting") if isinstance(event.get("onlineMeeting"), dict) else {}
            join_url = event.get("onlineMeetingUrl") or online_meeting.get("joinUrl")
            if not isinstance(join_url, str):
                join_url = None

            start_local = parse_event_time(start_part, tz)
            end_local = parse_event_time(end_part, tz)
            if not start_local or not end_local:
                skipped_events += 1
                log(f"Skipping calendar event without valid times: {event_subject_for_log(event, index)}.")
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
        except Exception as exc:
            skipped_events += 1
            log(
                "Skipping calendar event after normalization error: "
                f"{event_subject_for_log(event, index)} reason={exc.__class__.__name__}: {exc}"
            )

    if skipped_events:
        log(f"Skipped {skipped_events} malformed calendar events.")

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
    print(json.dumps(output, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

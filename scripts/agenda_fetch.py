from __future__ import annotations

import json
import os
import sys
import time
import csv
import hashlib
import re
import base64
from datetime import datetime, timedelta, timezone

import pytz
import requests
from urllib3.exceptions import ProtocolError
from selenium.common.exceptions import (
    NoSuchWindowException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from meetings_fetch import (
    GRAPH_EXPLORER_URL,
    build_driver,
    dismiss_safari_cookie_prompt,
    trigger_token_request,
    try_select_account_tile,
)

ISRAEL_TZ = pytz.timezone("Asia/Jerusalem")
OUTPUT_DIR = os.path.expanduser("~/Desktop/graph_outlook_export")
MAX_EMAILS = int(os.getenv("AGENDA_MAX_EMAILS", "500"))
AI_MODEL = os.getenv("AGENDA_AI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
MAX_AI_THREADS_PER_BATCH = int(os.getenv("AGENDA_MAX_AI_THREADS_PER_BATCH", "20"))
MAX_AI_MESSAGES_PER_THREAD = int(os.getenv("AGENDA_MAX_AI_MESSAGES_PER_THREAD", "20"))
MAX_AI_PREVIEW_CHARS = int(os.getenv("AGENDA_MAX_AI_PREVIEW_CHARS", "700"))
MAX_AI_PAYLOAD_CHARS = int(os.getenv("AGENDA_MAX_AI_PAYLOAD_CHARS", "50000"))
MAX_AI_OUTPUT_TASKS = int(os.getenv("AGENDA_MAX_AI_OUTPUT_TASKS", str(MAX_EMAILS)))
MAX_AI_OUTPUT_SUMMARIES = int(os.getenv("AGENDA_MAX_AI_OUTPUT_SUMMARIES", str(MAX_EMAILS)))
MAX_AI_OUTPUT_REPLIES = int(os.getenv("AGENDA_MAX_AI_OUTPUT_REPLIES", str(MAX_EMAILS)))
MAX_AI_OUTPUT_FOLLOWUPS = int(os.getenv("AGENDA_MAX_AI_OUTPUT_FOLLOWUPS", "80"))
MAX_AI_OUTPUT_PROJECT_SIGNALS = int(os.getenv("AGENDA_MAX_AI_OUTPUT_PROJECT_SIGNALS", "80"))
MAX_AI_OUTPUT_MEETING_PREP = int(os.getenv("AGENDA_MAX_AI_OUTPUT_MEETING_PREP", "80"))
OPENAI_CONNECT_TIMEOUT = int(os.getenv("AGENDA_OPENAI_CONNECT_TIMEOUT", "20"))
OPENAI_READ_TIMEOUT = int(os.getenv("AGENDA_OPENAI_READ_TIMEOUT", "240"))
OPENAI_BATCH_RETRIES = int(os.getenv("AGENDA_OPENAI_BATCH_RETRIES", "2"))
MAX_AI_BATCH_SPLIT_DEPTH = int(os.getenv("AGENDA_MAX_AI_BATCH_SPLIT_DEPTH", "4"))


def log(message: str) -> None:
    print(f"[AGENDA GRAPH AUTOMATION] {message}", file=sys.stderr, flush=True)


def normalize_token_value(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    clean = value.strip().strip('"').strip("'")
    if clean.lower().startswith("bearer "):
        clean = clean.split(None, 1)[1].strip()
    return clean


def decode_base64url_json(segment: str) -> dict:
    try:
        padded = segment + "=" * (-len(segment) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        payload = json.loads(decoded)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def decode_jwt_header(value: str) -> dict:
    token = normalize_token_value(value)
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    return decode_base64url_json(parts[0])


def decode_jwt_payload(value: str) -> dict:
    token = normalize_token_value(value)
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    return decode_base64url_json(parts[1])


def token_rejection_reason(value: str | None) -> str:
    token = normalize_token_value(value)
    if not token:
        return "empty"
    parts = token.split(".")
    if len(parts) != 3:
        return "not_jwt"
    if not all(len(part) > 10 for part in parts):
        return "short_jwt_parts"
    header = decode_jwt_header(token)
    if not header.get("alg"):
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
    has_graph_scope = any(scope in scopes for scope in ["mail.read", "calendars.read", "user.read"])
    if not is_graph_audience and not has_graph_scope and not isinstance(roles, list):
        return "not_graph_access_token"
    return "accepted"


def looks_like_graph_access_token(value: str | None) -> bool:
    return token_rejection_reason(value) == "accepted"


def safe_debug_value(value: object, max_len: int = 72) -> str:
    text = clean_text(str(value or ""), max_len)
    return text or "-"


def token_debug_payload(value: str | None) -> dict:
    payload = decode_jwt_payload(normalize_token_value(value))
    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        exp_status = "valid" if exp >= time.time() + 60 else "expired"
    else:
        exp_status = "missing"
    return {
        "aud": safe_debug_value(payload.get("aud")),
        "scp": safe_debug_value(payload.get("scp"), 120),
        "roles": "yes" if isinstance(payload.get("roles"), list) else "no",
        "exp": exp_status,
    }


def token_candidate_summary(candidate: dict) -> str:
    payload = token_debug_payload(candidate.get("token"))
    return (
        f"source={safe_debug_value(candidate.get('source'), 40)} "
        f"key={safe_debug_value(candidate.get('key'), 60)} "
        f"credentialType={safe_debug_value(candidate.get('credentialType'), 40)} "
        f"target={safe_debug_value(candidate.get('target'), 100)} "
        f"aud={payload['aud']} scp={payload['scp']} roles={payload['roles']} exp={payload['exp']}"
    )


def collect_token_candidates_from_object(data: object, source: str, key: str) -> list[dict]:
    candidates: list[dict] = []
    if isinstance(data, str):
        token = normalize_token_value(data)
        if token.count(".") == 2:
            candidates.append({"source": source, "key": key, "token": token})
        return candidates
    if isinstance(data, list):
        for index, value in enumerate(data):
            candidates.extend(collect_token_candidates_from_object(value, source, f"{key}[{index}]"))
        return candidates
    if not isinstance(data, dict):
        return candidates

    credential_type = data.get("credentialType")
    target = data.get("target") or data.get("scopes") or data.get("scope")
    for token_key in ("secret", "accessToken", "access_token"):
        token = normalize_token_value(data.get(token_key))
        if token:
            candidates.append(
                {
                    "source": source,
                    "key": f"{key}.{token_key}",
                    "credentialType": credential_type,
                    "target": target,
                    "token": token,
                }
            )
    for child_key, value in data.items():
        if child_key in {"secret", "accessToken", "access_token", "idToken", "id_token"}:
            continue
        candidates.extend(collect_token_candidates_from_object(value, source, f"{key}.{child_key}"))
    return candidates


def select_graph_token_from_candidates(candidates: list[dict], context: str) -> str | None:
    for candidate in candidates:
        token = normalize_token_value(candidate.get("token"))
        reason = token_rejection_reason(token)
        if reason == "accepted":
            log(f"Microsoft Graph token acquired from {context}.")
            return token
    return None


def extract_access_token(driver) -> str | None:
    try:
        entries = driver.execute_script(
            "return Object.entries(window.localStorage || {}).concat(Object.entries(window.sessionStorage || {}));"
        )
    except Exception as exc:
        log(f"Failed to read browser storage for Agenda token: {exc}")
        return None

    candidates: list[dict] = []
    for key, raw in entries:
        if not raw:
            continue
        storage_key = safe_debug_value(key, 80)
        try:
            parsed = json.loads(raw)
            candidates.extend(collect_token_candidates_from_object(parsed, "browser_storage", storage_key))
        except Exception:
            token = normalize_token_value(raw)
            if token.count(".") == 2:
                candidates.append({"source": "browser_storage_raw", "key": storage_key, "token": token})
    return select_graph_token_from_candidates(candidates, "browser storage")


def extract_access_token_from_indexeddb(driver) -> str | None:
    try:
        candidates = driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            const maxRecordsPerStore = 400;
            const maxCandidates = 80;
            const output = [];

            const looksInteresting = value => {
              if (typeof value !== 'string') return false;
              return value.includes('.') || value.includes('AccessToken') || value.includes('graph.microsoft.com');
            };

            const scan = (value, path, depth = 0) => {
              if (output.length >= maxCandidates || depth > 8 || value == null) return;
              if (typeof value === 'string') {
                if (looksInteresting(value)) output.push({source: 'indexeddb', key: path, value});
                return;
              }
              if (Array.isArray(value)) {
                for (let index = 0; index < value.length && index < 50; index += 1) {
                  scan(value[index], `${path}[${index}]`, depth + 1);
                }
                return;
              }
              if (typeof value !== 'object') return;
              for (const [key, child] of Object.entries(value)) {
                if (output.length >= maxCandidates) return;
                scan(child, `${path}.${key}`, depth + 1);
              }
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
                  if (!cursor || count >= maxRecordsPerStore) return resolve(rows);
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
                  const storeNames = Array.from(db.objectStoreNames || []);
                  for (const storeName of storeNames) {
                    if (output.length >= maxCandidates) break;
                    const rows = await readStore(db, storeName);
                    for (const row of rows) {
                      scan(row.value, `${dbName}.${storeName}.${row.key}`);
                      if (output.length >= maxCandidates) break;
                    }
                  }
                  db.close();
                }
                done(output.slice(0, maxCandidates));
              } catch (_error) {
                done([]);
              }
            })();
            """
        )
    except Exception as exc:
        log(f"Failed to read Agenda token candidates from IndexedDB: {exc}")
        return None

    if not isinstance(candidates, list):
        return None
    normalized_candidates: list[dict] = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            continue
        value = candidate.get("value")
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                normalized_candidates.extend(
                    collect_token_candidates_from_object(
                        parsed,
                        "indexeddb",
                        safe_debug_value(candidate.get("key"), 120),
                    )
                )
                continue
            except Exception:
                pass
        normalized_candidates.extend(
            collect_token_candidates_from_object(
                value,
                "indexeddb",
                safe_debug_value(candidate.get("key") or f"candidate_{index}", 120),
            )
        )
    return select_graph_token_from_candidates(normalized_candidates, "IndexedDB")


def extract_token_from_dom(driver) -> str | None:
    try:
        candidates = driver.execute_script(
            """
            const values = [];
            const pushValue = (source, value) => {
              if (typeof value !== 'string') return;
              const matches = value.match(/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/g) || [];
              for (const match of matches.slice(0, 20)) {
                values.push({source, token: match});
              }
            };
            for (const field of Array.from(document.querySelectorAll('input, textarea'))) {
              pushValue(field.tagName.toLowerCase(), field.value || field.getAttribute('value') || '');
            }
            pushValue('body_text', document.body ? document.body.innerText : '');
            return values.slice(0, 40);
            """
        )
    except Exception as exc:
        log(f"Failed to read Agenda token candidates from DOM: {exc}")
        return None
    if not isinstance(candidates, list):
        return None
    normalized_candidates = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            continue
        normalized_candidates.append(
            {
                "source": f"dom:{safe_debug_value(candidate.get('source'), 40)}",
                "key": f"candidate_{index}",
                "token": normalize_token_value(candidate.get("token")),
            }
        )
    return select_graph_token_from_candidates(normalized_candidates, "DOM")


def wait_for_access_token(driver, timeout_seconds: int = 20, include_indexeddb: bool = False) -> str | None:
    deadline = time.time() + timeout_seconds
    last_log = 0.0
    while time.time() < deadline:
        token = extract_access_token(driver)
        if token:
            return token
        if include_indexeddb:
            token = extract_access_token_from_indexeddb(driver)
            if token:
                return token
        now = time.time()
        if now - last_log > 10:
            log("Waiting for Microsoft Graph authorization to finish.")
            last_log = now
        time.sleep(1.0)
    return None


def ensure_output_dir() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def now_windows() -> tuple[str, str, str, str, datetime, datetime, datetime, datetime]:
    now_local = datetime.now(ISRAEL_TZ)
    mail_start_local = now_local - timedelta(days=7)
    mail_end_local = now_local

    mail_start_utc = mail_start_local.astimezone(timezone.utc)
    mail_end_utc = mail_end_local.astimezone(timezone.utc)

    days_since_sunday = (now_local.weekday() + 1) % 7
    week_start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=days_since_sunday
    )
    week_end_local = week_start_local + timedelta(days=7)

    week_start_utc = week_start_local.astimezone(timezone.utc)
    week_end_utc = week_end_local.astimezone(timezone.utc)

    return (
        mail_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        mail_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        week_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        week_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        mail_start_local,
        mail_end_local,
        week_start_local,
        week_end_local,
    )


def fetch_graph_items(url: str, headers: dict, max_items: int | None = None) -> list[dict]:
    items: list[dict] = []
    while url:
        response = requests.get(url, headers=headers, timeout=60)
        if response.status_code != 200:
            raise RuntimeError(f"Graph request failed {response.status_code}: {response.text}")
        payload = response.json()
        batch = payload.get("value", [])
        items.extend(batch)
        if max_items is not None and len(items) >= max_items:
            return items[:max_items]
        url = payload.get("@odata.nextLink")
    return items


def convert_graph_datetime_to_israel(date_string: str | None) -> str | None:
    if not date_string:
        return None
    try:
        clean_value = date_string.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_value)
        if dt.tzinfo is None:
            dt = pytz.utc.localize(dt)
        return dt.astimezone(ISRAEL_TZ).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return date_string


def parse_graph_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return pytz.utc.localize(parsed)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def save_rows(rows: list[dict], filename: str) -> None:
    path = os.path.join(OUTPUT_DIR, filename)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with open(path, "w", newline="", encoding="utf-8-sig") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        if fieldnames:
            writer.writeheader()
            writer.writerows(rows)


def clean_text(value: str | None, max_len: int = 220) -> str:
    if not value:
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."


def safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def clean_subject(value: str | None) -> str:
    text = clean_text(value, 180)
    text = re.sub(r"^(\s*(re|fw|fwd)\s*:\s*)+", "", text, flags=re.IGNORECASE)
    return text or "Untitled item"


def compact_csv(value: str | None, max_len: int = 180) -> str:
    if not value:
        return ""
    parts = [clean_text(part, 80) for part in str(value).split(",")]
    compact = ", ".join(part for part in parts if part)
    return clean_text(compact, max_len)


def stable_item_id(item: dict) -> str:
    raw = "|".join(
        [
            str(item.get("Type") or ""),
            str(item.get("Title") or ""),
            str(item.get("Owner Email") or item.get("Owner") or ""),
            str(item.get("Start Date") or ""),
        ]
    )
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"agenda-{digest}"


def split_terms(value: str | None) -> list[str]:
    if not value:
        return []
    terms: list[str] = []
    for term in re.split(r"[,;\n]+", value):
        clean = clean_text(term, 80).strip().lower()
        if clean and clean not in terms:
            terms.append(clean)
    return terms


def normalize_tuning_key(value: object) -> str:
    return re.sub(r"\s+", " ", clean_text(str(value or ""), 240).strip().lower())


def load_agenda_tuning() -> dict:
    raw = os.getenv("AGENDA_TUNING_JSON", "").strip()
    if not raw:
        return {"hiddenThreads": set(), "hiddenSenders": set(), "importantTerms": []}
    try:
        payload = json.loads(raw)
    except Exception:
        return {"hiddenThreads": set(), "hiddenSenders": set(), "importantTerms": []}
    if not isinstance(payload, dict):
        return {"hiddenThreads": set(), "hiddenSenders": set(), "importantTerms": []}
    hidden_threads = {
        normalize_tuning_key(value)
        for value in payload.get("hiddenThreads", [])
        if normalize_tuning_key(value)
    }
    hidden_senders = {
        normalize_tuning_key(value)
        for value in payload.get("hiddenSenders", [])
        if normalize_tuning_key(value)
    }
    important_terms = [
        clean_text(str(value or ""), 160)
        for value in payload.get("importantTerms", [])
        if clean_text(str(value or ""), 160)
    ][:40]
    return {
        "hiddenThreads": hidden_threads,
        "hiddenSenders": hidden_senders,
        "importantTerms": important_terms,
    }


def row_is_tuned_out(row: dict, tuning: dict) -> bool:
    hidden_threads = tuning.get("hiddenThreads") or set()
    hidden_senders = tuning.get("hiddenSenders") or set()
    thread_candidates = [
        row.get("Conversation Id"),
        row.get("Message Id"),
        row.get("Title"),
        stable_item_id(row),
    ]
    if any(normalize_tuning_key(value) in hidden_threads for value in thread_candidates if value):
        return True
    sender_candidates = [
        row.get("Owner Email"),
        row.get("Owner"),
    ]
    return any(normalize_tuning_key(value) in hidden_senders for value in sender_candidates if value)


def recipient_names(recipients: list[dict] | None) -> str:
    if not recipients:
        return ""
    names = []
    for recipient in recipients:
        address = recipient.get("emailAddress", {}) if isinstance(recipient, dict) else {}
        name = clean_text(address.get("name"), 100)
        email = clean_text(address.get("address"), 120)
        if name or email:
            names.append(name or email)
    return ", ".join(names)


def recipient_emails(recipients: list[dict] | None) -> str:
    if not recipients:
        return ""
    emails = []
    for recipient in recipients:
        address = recipient.get("emailAddress", {}) if isinstance(recipient, dict) else {}
        email = clean_text(address.get("address"), 120).lower()
        if email:
            emails.append(email)
    return ", ".join(emails)


def message_body_text(message: dict, max_len: int = 1600) -> str:
    body = message.get("body") if isinstance(message, dict) else None
    content = ""
    if isinstance(body, dict):
        content = str(body.get("content") or "")
    if not content:
        content = str(message.get("bodyPreview") or "")
    content = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", content)
    content = re.sub(r"(?s)<br\s*/?>", "\n", content)
    content = re.sub(r"(?s)</p\s*>", "\n", content)
    content = re.sub(r"(?s)<[^>]+>", " ", content)
    content = (
        content.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return clean_text(content, max_len)


def graph_message_to_thread_message(message: dict, folder: str) -> dict:
    sender = message.get("from", {}).get("emailAddress", {})
    timestamp = message.get("receivedDateTime") or message.get("sentDateTime")
    return {
        "folder": folder,
        "messageId": message.get("id"),
        "subject": clean_subject(message.get("subject")),
        "from": clean_text(sender.get("name") or sender.get("address"), 120),
        "fromEmail": clean_text(sender.get("address"), 120),
        "to": recipient_names(message.get("toRecipients")),
        "toEmails": recipient_emails(message.get("toRecipients")),
        "cc": recipient_names(message.get("ccRecipients")),
        "ccEmails": recipient_emails(message.get("ccRecipients")),
        "time": convert_graph_datetime_to_israel(timestamp),
        "preview": message_body_text(message, 1600),
        "link": message.get("webLink") or "",
    }


def row_blob(row: dict) -> str:
    return " ".join(
        [
            str(row.get("Title") or ""),
            str(row.get("Owner") or ""),
            str(row.get("Owner Email") or ""),
            str(row.get("To") or ""),
            str(row.get("To Emails") or ""),
            str(row.get("Cc") or ""),
            str(row.get("Cc Emails") or ""),
            str(row.get("Preview") or ""),
        ]
    ).lower()


def person_terms(names: list[str], tags: list[str]) -> list[str]:
    terms = []
    for term in [*names, *tags]:
        clean = str(term or "").strip().lower()
        if clean and clean not in terms:
            terms.append(clean)
    return terms


def identity_terms(me_profile: dict | None = None) -> tuple[list[str], list[str]]:
    names = split_terms(os.getenv("AGENDA_PERSON_NAMES"))
    tags = split_terms(os.getenv("AGENDA_PERSON_TAGS"))
    username = os.getenv("MS_USERNAME", "").strip().lower()
    if username and username not in tags:
        tags.append(username)
    if me_profile:
        for value in [
            me_profile.get("displayName"),
            me_profile.get("mail"),
            me_profile.get("userPrincipalName"),
        ]:
            clean = clean_text(value, 100).lower()
            if clean and clean not in tags:
                tags.append(clean)
    return names, tags


def row_content_blob(row: dict) -> str:
    values = [
        str(row.get("Title") or ""),
        str(row.get("Preview") or ""),
    ]
    for message in row.get("Thread Messages", []):
        if not isinstance(message, dict):
            continue
        values.extend(
            [
                str(message.get("subject") or ""),
                str(message.get("preview") or ""),
            ]
        )
    return " ".join(values).lower()


def row_mentions_identity(row: dict, names: list[str], tags: list[str]) -> bool:
    blob = row_content_blob(row)
    return any(term and term in blob for term in person_terms(names, tags))


def row_to_identity(row: dict, tags: list[str]) -> bool:
    recipients = f"{row.get('To Emails') or ''}".lower()
    return any(term and "@" in term and term in recipients for term in tags)


def row_cc_identity(row: dict, tags: list[str]) -> bool:
    recipients = f"{row.get('Cc Emails') or ''}".lower()
    return any(term and "@" in term and term in recipients for term in tags)


def row_direct_to_identity(row: dict, tags: list[str]) -> bool:
    return row_to_identity(row, tags)


def row_owner_is_identity(row: dict, names: list[str], tags: list[str]) -> bool:
    owner_blob = f"{row.get('Owner') or ''} {row.get('Owner Email') or ''}".lower()
    return any(term and term in owner_blob for term in person_terms(names, tags))


def thread_has_identity_sent_message(row: dict, names: list[str], tags: list[str]) -> bool:
    for message in row.get("Thread Messages", []):
        if not isinstance(message, dict):
            continue
        if str(message.get("folder") or "").lower() == "sent":
            return True
        sender_blob = f"{message.get('from') or ''} {message.get('fromEmail') or ''}".lower()
        if sender_blob and any(term and term in sender_blob for term in person_terms(names, tags)):
            return True
    return False


def row_has_personal_involvement(row: dict, names: list[str], tags: list[str]) -> bool:
    return (
        row_owner_is_identity(row, names, tags)
        or thread_has_identity_sent_message(row, names, tags)
        or bool(row.get("Identity Sent In Thread") is True)
    )


def latest_thread_message(row: dict) -> dict | None:
    messages = [message for message in row.get("Thread Messages", []) if isinstance(message, dict)]
    if not messages:
        return None
    return sorted(messages, key=lambda value: value.get("time") or "")[-1]


def latest_message_from_identity(row: dict, names: list[str], tags: list[str]) -> bool:
    latest = latest_thread_message(row)
    if not latest:
        return False
    if str(latest.get("folder") or "").lower() == "sent":
        return True
    sender_blob = f"{latest.get('from') or ''} {latest.get('fromEmail') or ''}".lower()
    return any(term and term in sender_blob for term in person_terms(names, tags))


def row_known_context_match(row: dict, names: list[str], tags: list[str]) -> bool:
    blob = row_content_blob(row)
    context_terms = [
        term
        for term in person_terms(names, tags)
        if "@" not in term and len(term) >= 3
    ]
    return any(term in blob for term in context_terms)


def message_to_identity(message: dict, tags: list[str]) -> bool:
    to_emails = str(message.get("toEmails") or "").lower()
    return any(term and "@" in term and term in to_emails for term in tags)


def message_mentions_identity(message: dict, names: list[str], tags: list[str]) -> bool:
    blob = f"{message.get('subject') or ''} {message.get('preview') or ''}".lower()
    return any(term and term in blob for term in person_terms(names, tags))


def direct_ask_evidence(row: dict, names: list[str], tags: list[str]) -> str:
    messages = [message for message in row.get("Thread Messages", []) if isinstance(message, dict)]
    latest_sent_time = ""
    for message in messages:
        if str(message.get("folder") or "").lower() == "sent":
            latest_sent_time = max(latest_sent_time, str(message.get("time") or ""))

    candidates = sorted(messages, key=lambda value: value.get("time") or "")
    for message in reversed(candidates):
        if str(message.get("folder") or "").lower() == "sent":
            continue
        message_time = str(message.get("time") or "")
        if latest_sent_time and message_time and message_time <= latest_sent_time:
            continue
        text = f"{message.get('subject') or ''} {message.get('preview') or ''}"
        if not is_actionable_text(text):
            continue
        if message_to_identity(message, tags) or message_mentions_identity(message, names, tags):
            return clean_text(message.get("preview") or message.get("subject"), 220)

    text = f"{row.get('Title') or ''} {row.get('Preview') or ''}"
    if is_actionable_text(text) and (row_to_identity(row, tags) or row_mentions_identity(row, names, tags)):
        return clean_text(row.get("Preview") or row.get("Title"), 220)
    return ""


def row_has_direct_ask(row: dict, names: list[str], tags: list[str]) -> bool:
    return bool(direct_ask_evidence(row, names, tags))


def row_is_person_relevant(row: dict, names: list[str], tags: list[str]) -> bool:
    if row_has_personal_involvement(row, names, tags):
        return True
    if row_has_direct_ask(row, names, tags):
        return True
    return row_known_context_match(row, names, tags) and row_mentions_identity(row, names, tags)


def ai_thread_relevance_score(row: dict, names: list[str], tags: list[str]) -> int:
    score = 0
    role = row.get("Recipient Role")
    if role == "To":
        score += 90
    elif role == "Cc":
        score += 5
    if row_direct_to_identity(row, tags):
        score += 80
    if row_mentions_identity(row, names, tags):
        score += 65
    if row_has_personal_involvement(row, names, tags):
        score += 120
    if is_actionable_text(f"{row.get('Title') or ''} {row.get('Preview') or ''}"):
        score += 45
    if str(row.get("Status") or "").lower() == "unread":
        score += 25
    if str(row.get("Priority") or "").lower() == "high":
        score += 25
    if any(term in row_blob(row) for term in ["failed", "blocked", "urgent", "דחוף", "תקלה"]):
        score += 20
    return score


def is_actionable_text(text: str) -> bool:
    normalized = text.lower()
    keywords = [
        "please",
        "need",
        "needs",
        "can you",
        "could you",
        "follow up",
        "review",
        "approve",
        "confirm",
        "send",
        "fix",
        "check",
        "failed",
        "blocked",
        "urgent",
        "נא",
        "צריך",
        "צריכה",
        "לטיפול",
        "אישור",
        "בדיקה",
        "בדיקות",
        "תבדוק",
        "תעדכן",
        "תגובה",
    ]
    return "?" in normalized or any(keyword in normalized for keyword in keywords)


def is_followup_text(text: str) -> bool:
    normalized = text.lower()
    keywords = [
        "waiting",
        "follow up",
        "pending",
        "blocked by",
        "after you",
        "let me know",
        "update me",
        "מחכה",
        "ממתין",
        "ממתינה",
        "תעדכן",
        "עדכון",
    ]
    return any(keyword in normalized for keyword in keywords)


def is_project_signal_text(text: str) -> bool:
    normalized = text.lower()
    keywords = [
        "blocked",
        "risk",
        "delay",
        "deadline",
        "production",
        "incident",
        "failed",
        "issue",
        "status",
        "decision",
        "תקלה",
        "חסום",
        "סיכון",
        "דחוף",
        "החלטה",
    ]
    return any(keyword in normalized for keyword in keywords)


def priority_for_row(row: dict) -> str:
    blob = row_blob(row)
    if str(row.get("Priority") or "").lower() == "high":
        return "High"
    if any(term in blob for term in ["urgent", "blocked", "failed", "דחוף", "תקלה"]):
        return "High"
    if any(term in blob for term in ["please", "need", "צריך", "לטיפול", "אישור"]):
        return "Medium"
    return "Low"


def infer_project_label(row: dict) -> str:
    subject = clean_subject(row.get("Title"))
    blob = f"{subject} {row.get('Preview') or ''}".lower()
    known_projects = [
        ("VRPathways", ["vrpathways", "vr pathways", "vr-pathways"]),
        ("Geotwins", ["geotwins", "geo twins", "geo-twins"]),
        ("CBS", ["cbs price", "cbs"]),
        ("Weizmann", ["weizmann"]),
        ("Valinor", ["valinor"]),
        ("AGMA", ["agma"]),
        ("Exponet", ["exponet"]),
    ]
    for label, terms in known_projects:
        if any(term in blob for term in terms):
            return label
    owner_email = clean_text(row.get("Owner Email"), 120)
    if "|" in subject:
        return clean_text(subject.split("|", 1)[0], 120)
    if " - " in subject:
        return clean_text(subject.split(" - ", 1)[0], 120)
    if owner_email and "@" in owner_email:
        domain = owner_email.split("@", 1)[1].split(".", 1)[0]
        if domain and domain.lower() not in {"comm-it", "commit", "commit"}:
            return clean_text(domain.title(), 120)
    return "General"


def build_thread_timeline_from_row(row: dict) -> list[dict]:
    messages = row.get("Thread Messages", [])
    compact = compact_thread_messages(messages if isinstance(messages, list) else [])
    if not compact:
        return []
    selected = compact if len(compact) <= 3 else [compact[0], *compact[-2:]]
    return [
        {
            "time": clean_text(message.get("time"), 40),
            "from": clean_text(message.get("from"), 100),
            "direction": clean_text(message.get("folder"), 20),
            "preview": clean_text(message.get("preview"), 220),
        }
        for message in selected
        if message.get("preview") or message.get("from") or message.get("time")
    ]


def make_insight(
    kind: str,
    row: dict,
    title: str,
    summary: str,
    action: str,
    reason: str,
    names: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict:
    names = names or []
    tags = tags or []
    category_labels = {
        "task": "Task",
        "summary": "Project signal",
        "reply": "Need reply",
        "followup": "Follow up",
        "meetingPrep": "Meeting prep",
        "projectSignal": "Project signal",
    }
    insight = {
        **row,
        "id": stable_item_id({**row, "Type": kind, "Title": title}),
        "kind": kind,
        "category": kind,
        "categoryLabel": category_labels.get(kind, kind.title()),
        "priority": priority_for_row(row),
        "title": clean_text(title, 180),
        "summary": clean_text(summary, 420),
        "suggestedAction": clean_text(action, 260),
        "reason": clean_text(reason, 220),
        "owner": clean_text(row.get("Owner"), 100),
        "ownerEmail": clean_text(row.get("Owner Email"), 120),
        "whenLabel": clean_text(row.get("Start Date"), 40),
        "sourceTitle": clean_subject(row.get("Title")),
        "project": clean_text(row.get("Project") or row.get("Customer") or infer_project_label(row), 120),
        "customer": clean_text(row.get("Customer") or infer_project_label(row), 120),
        "sourceSender": clean_text(row.get("Owner"), 100),
        "sourceSenderEmail": clean_text(row.get("Owner Email"), 120),
        "relevanceScore": safe_int(row.get("Relevance Score"), 0),
        "threadKey": row.get("Conversation Id") or row.get("Message Id") or stable_item_id(row),
        "link": row.get("Link") or "",
        "sourceIds": [row.get("Message Id") or row.get("Conversation Id") or stable_item_id(row)],
        "sourceRole": clean_text(row.get("Recipient Role"), 30),
        "sourceType": "Outlook",
        "directAskEvidence": clean_text(direct_ask_evidence(row, names, tags), 260),
        "latestMessageFromIdentity": latest_message_from_identity(row, names, tags),
        "ccOnly": row_cc_identity(row, tags) and not row_to_identity(row, tags),
        "latestAt": clean_text(row.get("Start Date"), 40),
        "threadTimeline": build_thread_timeline_from_row(row),
        "aiSource": "local",
    }
    insight["actionTitle"] = insight["title"]
    insight["brief"] = insight["summary"]
    return insight


def unique_by_thread(items: list[dict], limit: int) -> list[dict]:
    seen = set()
    output = []
    priority_order = {"High": 0, "Medium": 1, "Low": 2}
    for item in sorted(items, key=lambda value: priority_order.get(value.get("priority"), 9)):
        key = f"{item.get('kind')}|{item.get('threadKey')}"
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
        if len(output) >= limit:
            break
    return output


def build_local_sections(
    email_rows: list[dict],
    meeting_rows: list[dict],
    meeting_count: int,
    names: list[str],
    tags: list[str],
) -> tuple[dict, str, list[str]]:
    related_rows = [
        row
        for row in email_rows
        if row_is_person_relevant(row, names, tags)
    ]
    direct_rows = [
        row
        for row in email_rows
        if (row.get("Recipient Role") == "To" or row_direct_to_identity(row, tags))
        and row_has_personal_involvement(row, names, tags)
    ]
    task_candidates = [
        row
        for row in related_rows
        if is_actionable_text(f"{row.get('Title') or ''} {row.get('Preview') or ''}")
        and not latest_message_from_identity(row, names, tags)
    ]
    reply_candidates = [
        row
        for row in task_candidates
        if str(row.get("Mission Reason") or "").lower().startswith("no sent reply")
        and row_has_direct_ask(row, names, tags)
        and not latest_message_from_identity(row, names, tags)
    ]
    followup_candidates = [
        row
        for row in related_rows
        if row.get("Direction") == "Sent"
        or latest_message_from_identity(row, names, tags)
        or (thread_has_identity_sent_message(row, names, tags) and is_followup_text(row_blob(row)))
    ]
    project_signal_candidates = [
        row
        for row in related_rows
        if is_project_signal_text(row_blob(row))
    ]
    meeting_prep_candidates = [
        row
        for row in meeting_rows
        if row_is_person_relevant(row, names, tags)
        or row_mentions_identity(row, names, tags)
        or row_known_context_match(row, names, tags)
    ]

    tasks = unique_by_thread(
        [
            make_insight(
                "task",
                row,
                clean_subject(row.get("Title")),
                row.get("Preview") or "Mail appears to contain an action related to your configured identity.",
                "Handle the requested action, then mark this card resolved.",
                "Matched your configured name/tag and contains actionable language.",
                names,
                tags,
            )
            for row in task_candidates
        ],
        12,
    )
    email_summaries = unique_by_thread(
        [
            make_insight(
                "projectSignal",
                row,
                clean_subject(row.get("Title")),
                row.get("Preview") or "This thread contains a project status signal.",
                "Review the project signal and decide whether it needs an action.",
                "Matched project/status/risk language in a personally relevant thread.",
                names,
                tags,
            )
            for row in project_signal_candidates or direct_rows
        ],
        16,
    )
    need_reply = unique_by_thread(
        [
            make_insight(
                "reply",
                row,
                f"Reply: {clean_subject(row.get('Title'))}",
                row.get("Preview") or "This related mail may need your response.",
                "Reply, delegate, or mark resolved if no response is needed.",
                "Related to your configured identity and no later sent reply was found.",
                names,
                tags,
            )
            for row in reply_candidates
        ],
        12,
    )
    followups = unique_by_thread(
        [
            make_insight(
                "followup",
                row,
                f"Follow up: {clean_subject(row.get('Title'))}",
                row.get("Preview") or "You sent a message in this thread and may be waiting on an answer.",
                "Follow up or mark resolved if the dependency is no longer active.",
                "You sent in this thread or the thread contains waiting/follow-up language.",
                names,
                tags,
            )
            for row in followup_candidates
        ],
        12,
    )
    meeting_prep = unique_by_thread(
        [
            make_insight(
                "meetingPrep",
                row,
                f"Prepare: {clean_subject(row.get('Title'))}",
                row.get("Preview") or "Upcoming meeting with configured identity or tracked tags.",
                "Prepare decisions, blockers, and updates before this meeting.",
                "Meeting is connected to your configured identity or tracked aliases.",
                names,
                tags,
            )
            for row in meeting_prep_candidates
        ],
        8,
    )
    brief = (
        f"Focus on {len(tasks)} concrete tasks, {len(need_reply)} replies, "
        f"{len(followups)} follow-ups, and {len(meeting_prep)} meeting-prep items."
    )
    focus = [
        "Need Reply includes only threads with a direct unresolved ask to your configured identity.",
        "Passive CC/FYI threads are excluded unless you sent in the thread or were explicitly asked in the message body.",
        "Use Not relevant, Hide sender, and Important in the UI to tune future runs.",
    ]
    return {
        "tasks": tasks,
        "emailSummaries": email_summaries,
        "needReply": need_reply,
        "followUps": followups,
        "projectSignals": email_summaries,
        "meetingPrep": meeting_prep,
    }, brief, focus


def normalize_ai_insight(kind: str, value: dict) -> dict | None:
    if not isinstance(value, dict):
        return None
    title = clean_text(value.get("title") or value.get("actionTitle"), 180)
    summary = clean_text(value.get("summary") or value.get("brief"), 420)
    if not title or not summary:
        return None
    category_labels = {
        "task": "Task",
        "summary": "Project signal",
        "reply": "Need reply",
        "followup": "Follow up",
        "meetingPrep": "Meeting prep",
        "projectSignal": "Project signal",
    }
    return {
        "id": clean_text(value.get("id") or stable_item_id({"Type": kind, "Title": title}), 80),
        "kind": kind,
        "category": kind,
        "categoryLabel": category_labels.get(kind, kind.title()),
        "priority": clean_text(value.get("priority") or "Medium", 20),
        "owner": clean_text(value.get("owner"), 120),
        "ownerEmail": clean_text(value.get("ownerEmail"), 160),
        "title": title,
        "summary": summary,
        "titleHe": clean_text(value.get("titleHe"), 180),
        "summaryHe": clean_text(value.get("summaryHe"), 420),
        "actionTitle": title,
        "brief": summary,
        "suggestedAction": clean_text(value.get("suggestedAction"), 260),
        "suggestedActionHe": clean_text(value.get("suggestedActionHe"), 260),
        "reason": clean_text(value.get("reason"), 220),
        "reasonHe": clean_text(value.get("reasonHe"), 220),
        "whenLabel": clean_text(value.get("whenLabel"), 40),
        "project": clean_text(value.get("project") or value.get("customer"), 120),
        "customer": clean_text(value.get("customer") or value.get("project"), 120),
        "sourceSender": clean_text(value.get("sourceSender") or value.get("owner"), 120),
        "sourceSenderEmail": clean_text(value.get("sourceSenderEmail") or value.get("ownerEmail"), 160),
        "relevanceScore": safe_int(value.get("relevanceScore"), 0),
        "threadKey": clean_text(value.get("threadKey") or title, 120),
        "link": clean_text(value.get("link"), 500),
        "sourceIds": value.get("sourceIds") if isinstance(value.get("sourceIds"), list) else [],
        "sourceRole": clean_text(value.get("sourceRole"), 30),
        "sourceType": clean_text(value.get("sourceType") or "Outlook", 30),
        "directAskEvidence": clean_text(value.get("directAskEvidence"), 260),
        "latestMessageFromIdentity": bool(value.get("latestMessageFromIdentity")),
        "ccOnly": bool(value.get("ccOnly")),
        "latestAt": clean_text(value.get("latestAt") or value.get("whenLabel"), 40),
        "threadTimeline": value.get("threadTimeline") if isinstance(value.get("threadTimeline"), list) else [],
        "aiSource": "openai",
    }


def compact_thread_messages(messages: list[dict]) -> list[dict]:
    if not isinstance(messages, list):
        return []
    clean_messages = sorted(
        [message for message in messages if isinstance(message, dict)],
        key=lambda value: value.get("time") or "",
    )
    if len(clean_messages) > MAX_AI_MESSAGES_PER_THREAD:
        head_count = min(2, MAX_AI_MESSAGES_PER_THREAD)
        tail_count = max(MAX_AI_MESSAGES_PER_THREAD - head_count, 0)
        selected = [*clean_messages[:head_count]]
        if tail_count:
            selected.extend(clean_messages[-tail_count:])
    else:
        selected = clean_messages

    compact = []
    seen_ids = set()
    for message in selected:
        message_id = message.get("messageId") or f"{message.get('folder')}|{message.get('time')}|{message.get('fromEmail')}"
        if message_id in seen_ids:
            continue
        seen_ids.add(message_id)
        compact.append(
            {
                "folder": clean_text(message.get("folder"), 20),
                "messageId": clean_text(message.get("messageId"), 80),
                "from": clean_text(message.get("from"), 100),
                "fromEmail": clean_text(message.get("fromEmail"), 120),
                "to": compact_csv(message.get("to"), 160),
                "cc": compact_csv(message.get("cc"), 160),
                "time": clean_text(message.get("time"), 40),
                "preview": clean_text(message.get("preview"), MAX_AI_PREVIEW_CHARS),
            }
        )
    return compact


def build_ai_threads(email_rows: list[dict], names: list[str], tags: list[str]) -> list[dict]:
    compact_threads = []
    seen = set()
    relevant_rows = [
        row for row in email_rows
        if row_is_person_relevant(row, names, tags)
    ]
    sorted_rows = sorted(
        relevant_rows,
        key=lambda row: (
            ai_thread_relevance_score(row, names, tags),
            clean_text(row.get("Start Date"), 40),
        ),
        reverse=True,
    )
    for row in sorted_rows:
        thread_key = row.get("Conversation Id") or row.get("Message Id") or stable_item_id(row)
        if thread_key in seen:
            continue
        seen.add(thread_key)
        compact_threads.append({
            "threadKey": clean_text(thread_key, 120),
            "messageId": clean_text(row.get("Message Id"), 80),
            "subject": clean_text(row.get("Title"), 180),
            "from": clean_text(row.get("Owner"), 100),
            "fromEmail": clean_text(row.get("Owner Email"), 120),
            "to": compact_csv(row.get("To"), 180),
            "toEmails": compact_csv(row.get("To Emails"), 180),
            "cc": compact_csv(row.get("Cc"), 180),
            "ccEmails": compact_csv(row.get("Cc Emails"), 180),
            "recipientRole": clean_text(row.get("Recipient Role"), 20),
            "received": clean_text(row.get("Start Date"), 40),
            "importance": clean_text(row.get("Priority"), 20),
            "status": clean_text(row.get("Status"), 20),
            "preview": clean_text(row.get("Preview"), MAX_AI_PREVIEW_CHARS),
            "threadMessages": compact_thread_messages(row.get("Thread Messages", [])),
            "link": clean_text(row.get("Link"), 500),
            "missionReason": clean_text(row.get("Mission Reason"), 160),
            "personalInvolvement": row_has_personal_involvement(row, names, tags),
            "ownerMatchesIdentity": row_owner_is_identity(row, names, tags),
            "identitySentInThread": thread_has_identity_sent_message(row, names, tags),
            "latestMessageFromIdentity": latest_message_from_identity(row, names, tags),
            "directAskToIdentity": row_has_direct_ask(row, names, tags),
            "directAskEvidence": direct_ask_evidence(row, names, tags),
            "ccOnly": row_cc_identity(row, tags) and not row_to_identity(row, tags),
            "project": clean_text(row.get("Project") or row.get("Customer") or infer_project_label(row), 120),
            "customer": clean_text(row.get("Customer") or infer_project_label(row), 120),
            "relevanceScore": ai_thread_relevance_score(row, names, tags),
        })
    log(
        "Prepared person-relevant agenda threads "
        f"for AI: {len(compact_threads)} of {len(email_rows)} unanswered rows."
    )
    return compact_threads


def build_ai_prompt(
    threads: list[dict],
    names: list[str],
    tags: list[str],
    tuning: dict,
    meeting_count: int,
    me_profile: dict | None,
    batch_index: int,
    total_batches: int,
    total_threads: int,
) -> dict:
    return {
        "today": datetime.now(ISRAEL_TZ).strftime("%Y-%m-%d"),
        "identity": {
            "configuredNames": names,
            "configuredTags": tags,
            "me": me_profile or {},
        },
        "userTuning": {
            "importantTerms": tuning.get("importantTerms", []),
            "hiddenThreadsCount": len(tuning.get("hiddenThreads") or []),
            "hiddenSendersCount": len(tuning.get("hiddenSenders") or []),
        },
        "batch": {
            "index": batch_index,
            "total": total_batches,
            "threadsInBatch": len(threads),
            "totalThreadsAcrossAllBatches": total_threads,
        },
        "rules": [
            "This is one batch from a larger agenda. Analyze only this batch; other batches will be merged later.",
            "Thread messages are chronological. Read the whole thread state before deciding; the newest unresolved messages override older requests.",
            "Only include threads that are personally relevant: identitySentInThread, ownerMatchesIdentity, or directAskToIdentity.",
            "Exclude passive CC, FYI, newsletters, digests, and automated notifications. CC-only threads are not personal unless the configured person is explicitly asked in the message body.",
            "Tasks: extract concrete project/task work from the full thread. Prefer items owned by, assigned to, sent by, or explicitly requested from the configured person.",
                        "Every task needs an owner when the owner is inferable. Use the configured person only when the latest thread state actually assigns or asks them. Never infer owner from To/Cc alone.",
            "Follow ups: include threads where the configured person has sent something and appears to be waiting on another person.",
            "Project signals: include important project status, blocker, risk, deadline, approval, or decision updates that are personally relevant but may not require direct reply.",
            "Meeting prep: include only meetings that need preparation or decisions and connect to configured identity/project terms.",
            "Email summaries: use only for project signals; summarize the whole thread in your own words. Do not copy raw previews.",
            "For every item, summarize the current state after reading messages chronologically. Use latest unresolved messages over older requests.",
            "For every item, fill sourceRole, directAskEvidence when present, latestAt, and a 2-3 entry threadTimeline with chronological current-state milestones.",
            "Need Reply: include only threads with directAskToIdentity=true and directAskEvidence showing an unresolved ask to the configured person. Exclude CC-only threads, team-wide discussion, FYI, product/data updates, and unrelated people.",
            "For Need Reply, reason must cite the actual ask evidence. Do not write 'Direct ask to Dror' unless the message text actually asks Dror/configured identity to do something.",
            "If latestMessageFromIdentity=true or the newest chronological message is Sent, the configured person already answered. Do not classify that thread as a Task or Need Reply unless a newer inbound direct ask exists. Use Follow ups only when waiting on someone else; otherwise use Project signals.",
            "Brief: write 1-2 practical sentences about the most important project actions/decisions/replies. Do not say 'agenda brief' or describe analysis counts.",
            "Focus: 2-3 bullets with concrete next actions, project names, owners, blockers, or decisions. No generic prioritization advice.",
            "Use userTuning. Treat importantTerms as stronger relevance hints. Hidden senders and hidden threads were removed before this prompt because the user marked them not relevant.",
                "Do not write generic output. Mention the concrete subject, owner, project, blocker, decision, or requested action.",
                "For every item, include English fields title, summary, suggestedAction, reason and Hebrew equivalents titleHe, summaryHe, suggestedActionHe, reasonHe. Hebrew must be natural business Hebrew, not transliteration.",
                "Deduplicate inside this batch by threadKey. Prefer specific meaningful items over literal email listings.",
            "Do not include mail just because it exists in the inbox, To, or Cc.",
        ],
        "counts": {"unansweredCandidateEmails": total_threads, "meetingsThisWeek": meeting_count},
        "threads": threads,
    }


def split_ai_thread_batches(
    threads: list[dict],
    names: list[str],
    tags: list[str],
    tuning: dict,
    meeting_count: int,
    me_profile: dict | None,
) -> list[list[dict]]:
    batches: list[list[dict]] = []
    current: list[dict] = []
    for thread in threads:
        projected_prompt = build_ai_prompt(
            [*current, thread],
            names,
            tags,
            tuning,
            meeting_count,
            me_profile,
            len(batches) + 1,
            1,
            len(threads),
        )
        projected_size = len(json.dumps(projected_prompt, ensure_ascii=False))
        if current and (
            projected_size > MAX_AI_PAYLOAD_CHARS
            or len(current) >= MAX_AI_THREADS_PER_BATCH
        ):
            batches.append(current)
            current = [thread]
            continue
        current.append(thread)
    if current:
        batches.append(current)
    log(f"Prepared {len(batches)} Agenda AI batch requests.")
    return batches


def parse_ai_focus(value: object) -> list[str]:
    if isinstance(value, list):
        values = value
    elif isinstance(value, str):
        values = re.split(r"[\n\r]+", value)
    else:
        values = []
    focus = []
    for item in values:
        clean = clean_text(str(item).lstrip("-•0123456789. )"), 180)
        lowered = clean.lower()
        if "prioritize responses" in lowered or "prioritize tasks" in lowered:
            continue
        if lowered in {"a", "d"}:
            continue
        if clean and clean not in focus:
            focus.append(clean)
    return focus[:5]


def normalize_agenda_brief(value: str | None, sections: dict, meeting_count: int) -> str:
    brief = clean_text(value, 500)
    lowered = brief.lower()
    if not brief or "agenda brief" in lowered or lowered.startswith("analyzed "):
        parts = []
        tasks = sections.get("tasks", [])
        replies = sections.get("needReply", [])
        followups = sections.get("followUps", [])
        meeting_prep = sections.get("meetingPrep", [])
        signals = sections.get("projectSignals", []) or sections.get("emailSummaries", [])
        if tasks:
            parts.append(f"{len(tasks)} concrete project/task follow-ups")
        if replies:
            parts.append(f"{len(replies)} replies likely need your answer")
        if followups:
            parts.append(f"{len(followups)} follow-ups where you may be waiting")
        if meeting_prep:
            parts.append(f"{len(meeting_prep)} meetings to prepare for")
        if signals:
            parts.append(f"{len(signals)} project status/risk signals")
        if parts:
            return "Focus on " + ", ".join(parts[:4]) + "."
        return "No personally relevant project actions, owned threads, or reply obligations were found in the selected mail window."
    return brief


def priority_rank(value: str | None) -> int:
    return {"high": 0, "medium": 1, "low": 2}.get(str(value or "").lower(), 3)


def merge_ai_items(items: list[dict], limit: int) -> list[dict]:
    merged: dict[str, dict] = {}
    for item in items:
        key = clean_text(item.get("threadKey") or item.get("id") or item.get("title"), 180).lower()
        if not key:
            continue
        existing = merged.get(key)
        if existing is None:
            merged[key] = item
            continue
        if priority_rank(item.get("priority")) < priority_rank(existing.get("priority")):
            merged[key] = item
        elif len(str(item.get("summary") or "")) > len(str(existing.get("summary") or "")):
            merged[key] = {**existing, **item}
    return sorted(
        merged.values(),
        key=lambda item: (
            priority_rank(item.get("priority")),
            str(item.get("whenLabel") or ""),
            str(item.get("title") or ""),
        ),
    )[:limit]


def filter_need_reply_items(items: list[dict], thread_context: dict[str, dict]) -> list[dict]:
    filtered = []
    for item in items:
        key = clean_text(item.get("threadKey"), 120)
        context = thread_context.get(key)
        if not context:
            continue
        if context.get("latestMessageFromIdentity"):
            continue
        if not context.get("directAskToIdentity"):
            continue
        if context.get("ccOnly") and not context.get("directAskEvidence"):
            continue
        if context.get("directAskEvidence") and not item.get("reason"):
            item = {
                **item,
                "reason": clean_text(f"Direct ask evidence: {context.get('directAskEvidence')}", 220),
            }
        filtered.append(item)
    return filtered


def enrich_ai_item_with_thread_context(item: dict, thread_context: dict[str, dict]) -> dict:
    key = clean_text(item.get("threadKey"), 120)
    context = thread_context.get(key)
    if not context:
        return item
    timeline_messages = context.get("threadMessages") if isinstance(context.get("threadMessages"), list) else []
    timeline = [
        {
            "time": clean_text(message.get("time"), 40),
            "from": clean_text(message.get("from"), 100),
            "direction": clean_text(message.get("folder"), 20),
            "preview": clean_text(message.get("preview"), 220),
        }
        for message in (timeline_messages if len(timeline_messages) <= 3 else [timeline_messages[0], *timeline_messages[-2:]])
        if isinstance(message, dict)
    ]
    return {
        **item,
        "sourceRole": item.get("sourceRole") or context.get("recipientRole") or "",
        "sourceType": item.get("sourceType") or "Outlook",
        "directAskEvidence": item.get("directAskEvidence") or context.get("directAskEvidence") or "",
        "latestMessageFromIdentity": bool(context.get("latestMessageFromIdentity")),
        "ccOnly": bool(context.get("ccOnly")),
        "latestAt": item.get("latestAt") or context.get("received") or item.get("whenLabel") or "",
        "threadTimeline": item.get("threadTimeline") or timeline,
    }


def enrich_ai_sections_with_thread_context(sections: dict, thread_context: dict[str, dict]) -> dict:
    return {
        key: [enrich_ai_item_with_thread_context(item, thread_context) for item in items]
        for key, items in sections.items()
    }


def call_openai_agenda_batch(api_key: str, prompt: dict, batch_index: int, total_batches: int) -> dict:
    payload_chars = len(json.dumps(prompt, ensure_ascii=False))
    log(
        "Analyzing agenda with OpenAI "
        f"batch {batch_index}/{total_batches} ({len(prompt.get('threads', []))} threads)."
    )
    request_body = {
        "model": AI_MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an agenda triage agent for work email. Return strict JSON with keys: "
                    "brief, focus, sections. sections has arrays tasks, emailSummaries, needReply, "
                        "followUps, projectSignals, meetingPrep. "
                        "Each item: id, threadKey, title, priority, owner, ownerEmail, summary, suggestedAction, reason, "
                        "titleHe, summaryHe, suggestedActionHe, reasonHe, "
                        "whenLabel, link, sourceIds, project, customer, sourceSender, sourceSenderEmail, relevanceScore, "
                    "sourceRole, sourceType, directAskEvidence, latestAt, threadTimeline. "
                    "Be selective, concrete, person-aware, and avoid generic filler."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
    }
    last_error: Exception | None = None
    for attempt in range(1, OPENAI_BATCH_RETRIES + 2):
        try:
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=request_body,
                timeout=(OPENAI_CONNECT_TIMEOUT, OPENAI_READ_TIMEOUT),
            )
            if response.status_code != 200:
                raise RuntimeError(f"OpenAI request failed {response.status_code}: {response.text[:500]}")
            return json.loads(response.json()["choices"][0]["message"]["content"])
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_error = exc
            log(
                "Agenda AI batch request timed out or lost connection "
                f"on attempt {attempt}/{OPENAI_BATCH_RETRIES + 1}: {exc}"
            )
            if attempt <= OPENAI_BATCH_RETRIES:
                time.sleep(min(2 ** attempt, 8))
                continue
            break
    raise RuntimeError(f"OpenAI batch failed after retries: {last_error}")


def absorb_ai_payload(
    payload: dict,
    all_tasks: list[dict],
    all_summaries: list[dict],
    all_replies: list[dict],
    all_followups: list[dict],
    all_project_signals: list[dict],
    all_meeting_prep: list[dict],
    all_focus: list[str],
    chunk_briefs: list[str],
) -> None:
    payload_sections = payload.get("sections", {})
    all_tasks.extend(
        item
        for item in (
            normalize_ai_insight("task", value)
            for value in payload_sections.get("tasks", [])
        )
        if item
    )
    all_summaries.extend(
        item
        for item in (
            normalize_ai_insight("summary", value)
            for value in payload_sections.get("emailSummaries", [])
        )
        if item
    )
    all_replies.extend(
        item
        for item in (
            normalize_ai_insight("reply", value)
            for value in payload_sections.get("needReply", [])
        )
        if item
    )
    all_followups.extend(
        item
        for item in (
            normalize_ai_insight("followup", value)
            for value in payload_sections.get("followUps", [])
        )
        if item
    )
    all_project_signals.extend(
        item
        for item in (
            normalize_ai_insight("projectSignal", value)
            for value in payload_sections.get("projectSignals", [])
        )
        if item
    )
    all_meeting_prep.extend(
        item
        for item in (
            normalize_ai_insight("meetingPrep", value)
            for value in payload_sections.get("meetingPrep", [])
        )
        if item
    )
    chunk_brief = clean_text(payload.get("brief"), 260)
    if chunk_brief:
        chunk_briefs.append(chunk_brief)
    for focus_item in parse_ai_focus(payload.get("focus")):
        if focus_item not in all_focus:
            all_focus.append(focus_item)


def try_ai_build_sections(
    email_rows: list[dict],
    meeting_rows: list[dict],
    meeting_count: int,
    me_profile: dict | None,
    tuning: dict | None = None,
) -> tuple[dict, str, list[str], str]:
    names, tags = identity_terms(me_profile)
    tuning = tuning or {"hiddenThreads": set(), "hiddenSenders": set(), "importantTerms": []}
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        log("OPENAI_API_KEY not set. Agenda AI pipeline is disabled.")
        sections, brief, focus = build_local_sections(email_rows, meeting_rows, meeting_count, names, tags)
        return sections, brief, focus, "local"

    compact_threads = build_ai_threads(email_rows, names, tags)
    if not compact_threads:
        return (
            {"tasks": [], "emailSummaries": [], "needReply": [], "followUps": [], "projectSignals": [], "meetingPrep": []},
            "No personally relevant project actions, owned threads, or reply obligations were found in the selected mail window.",
            [
                "No thread matched your configured identity as owner/sender or explicit assignee.",
                "Adjust Agenda identity names/tags if relevant work was missed.",
            ],
            "openai",
        )

    try:
        batches = split_ai_thread_batches(compact_threads, names, tags, tuning, meeting_count, me_profile)
        thread_context = {
            clean_text(thread.get("threadKey"), 120): thread
            for thread in compact_threads
            if thread.get("threadKey")
        }
        all_tasks: list[dict] = []
        all_summaries: list[dict] = []
        all_replies: list[dict] = []
        all_followups: list[dict] = []
        all_project_signals: list[dict] = []
        all_meeting_prep: list[dict] = []
        all_focus: list[str] = []
        chunk_briefs: list[str] = []
        failed_threads: list[str] = []

        queue: list[tuple[list[dict], int]] = [(batch, 0) for batch in batches]
        processed_batches = 0
        while queue:
            batch, split_depth = queue.pop(0)
            processed_batches += 1
            prompt = build_ai_prompt(
                batch,
                names,
                tags,
                tuning,
                meeting_count,
                me_profile,
                processed_batches,
                len(batches),
                len(compact_threads),
            )
            try:
                payload = call_openai_agenda_batch(api_key, prompt, processed_batches, len(batches))
                absorb_ai_payload(
                    payload,
                    all_tasks,
                    all_summaries,
                    all_replies,
                    all_followups,
                    all_project_signals,
                    all_meeting_prep,
                    all_focus,
                    chunk_briefs,
                )
            except Exception as exc:
                if len(batch) > 1 and split_depth < MAX_AI_BATCH_SPLIT_DEPTH:
                    midpoint = max(1, len(batch) // 2)
                    log(
                        "Agenda AI batch failed; splitting into smaller batches "
                        f"depth={split_depth + 1} size={len(batch)} error={exc}"
                    )
                    queue.insert(0, (batch[midpoint:], split_depth + 1))
                    queue.insert(0, (batch[:midpoint], split_depth + 1))
                    continue
                failed_threads.extend(
                    clean_text(thread.get("threadKey"), 120)
                    for thread in batch
                    if thread.get("threadKey")
                )
                log(
                    "Agenda AI batch failed after retries and cannot split further; "
                    f"threads skipped={len(batch)} error={exc}"
                )

        sections = {
            "tasks": merge_ai_items(all_tasks, MAX_AI_OUTPUT_TASKS),
            "emailSummaries": merge_ai_items(all_summaries, MAX_AI_OUTPUT_SUMMARIES),
            "needReply": filter_need_reply_items(
                merge_ai_items(all_replies, MAX_AI_OUTPUT_REPLIES),
                thread_context,
            ),
            "followUps": merge_ai_items(all_followups, MAX_AI_OUTPUT_FOLLOWUPS),
            "projectSignals": merge_ai_items(all_project_signals, MAX_AI_OUTPUT_PROJECT_SIGNALS),
            "meetingPrep": merge_ai_items(all_meeting_prep, MAX_AI_OUTPUT_MEETING_PREP),
        }
        if meeting_rows:
            local_sections, _local_brief, local_focus = build_local_sections(
                email_rows,
                meeting_rows,
                meeting_count,
                names,
                tags,
            )
            sections["meetingPrep"] = merge_ai_items(
                [*sections.get("meetingPrep", []), *local_sections.get("meetingPrep", [])],
                MAX_AI_OUTPUT_MEETING_PREP,
            )
            if not all_focus:
                all_focus.extend(local_focus[:2])
        sections = enrich_ai_sections_with_thread_context(sections, thread_context)
        if not any(sections.values()):
            raise RuntimeError("AI agenda pipeline returned no usable sections.")
        brief = normalize_agenda_brief(
            chunk_briefs[0] if chunk_briefs else None,
            sections,
            meeting_count,
        )
        focus = all_focus[:5] or [
            "Every collected thread was included through the batch pipeline.",
            "Results were merged and deduplicated by thread.",
        ]
        if failed_threads:
            focus = [
                f"{len(failed_threads)} threads could not be analyzed after retries.",
                *focus,
            ][:5]
        log(
            "AI agenda pipeline completed "
            f"with model {AI_MODEL}, {processed_batches} batch requests, "
            f"{len(compact_threads) - len(failed_threads)}/{len(compact_threads)} threads analyzed."
        )
        return sections, brief, focus, "openai"
    except Exception as exc:
        log(f"AI agenda pipeline failed; using local relevance agenda. {exc}")
        sections, brief, focus = build_local_sections(email_rows, meeting_rows, meeting_count, names, tags)
        return sections, brief, [f"OpenAI analysis failed: {exc}", *focus][:5], "local"


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
        driver.switch_to.window(handle)
        if "Graph Explorer" in driver.title:
            return True
    return False


def find_login_window(driver) -> bool:
    for handle in driver.window_handles:
        driver.switch_to.window(handle)
        title = driver.title or ""
        current_url = driver.current_url or ""
        if "Sign in" in title or "login.microsoftonline.com" in current_url:
            return True
    return False


def wait_for_graph_explorer_after_duo(driver, timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    last_log = 0.0
    while time.time() < deadline:
        try:
            if find_graph_explorer_window(driver):
                current_url = driver.current_url or ""
                if "developer.microsoft.com" in current_url:
                    return True
            current_url = driver.current_url or ""
            title = driver.title or ""
            if "developer.microsoft.com" in current_url or "Graph Explorer" in title:
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


def click_token_controls_like_meetings_script(driver) -> str | None:
    if sys.platform != "darwin":
        return None
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
        time.sleep(1)
        import subprocess

        token = normalize_token_value(subprocess.check_output("pbpaste", shell=True).decode())
        if token and looks_like_graph_access_token(token):
            return token
        if token:
            log(f"Graph Explorer token-copy controls returned an unusable token. reason={token_rejection_reason(token)}")
    except Exception as exc:
        log(f"Graph Explorer token-copy controls unavailable. {exc}")
    return None


def is_browser_transport_error(exc: Exception) -> bool:
    message = repr(exc).lower()
    return any(
        term in message
        for term in [
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
    log(f"Restarting browser automation for token recovery. reason={clean_text(reason, 180)}")
    try:
        driver.quit()
    except Exception:
        pass
    new_driver = build_driver(browser, headless)
    new_driver.get(GRAPH_EXPLORER_URL)
    WebDriverWait(new_driver, 30).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    log("Graph Explorer reloaded after browser automation restart.")
    return new_driver


def obtain_graph_token_via_browser() -> str:
    default_browser = "safari" if sys.platform == "darwin" else "chrome"
    browser = os.getenv("AGENDA_BROWSER", default_browser).strip().lower() or default_browser
    if browser not in {"safari", "chrome"}:
        browser = default_browser
    if browser == "safari" and sys.platform != "darwin":
        browser = "chrome"
    headless = os.getenv("AGENDA_HEADLESS", "").strip().lower() in {"1", "true", "yes"}
    username = os.getenv("MS_USERNAME", "").strip()
    password = os.getenv("MS_PASSWORD", "").strip()
    duo_clicked = False

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
            login_window_found = find_login_window(driver)

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
                    password_field = None
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
                    log(f"Microsoft continue step unavailable. Continuing. reason={exc.__class__.__name__}")

                try:
                    send_me_push_button = WebDriverWait(driver, 10).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, "button.auth-button.positive"))
                    )
                    send_me_push_button.click()
                    duo_clicked = True
                    log("Clicked DUO push button.")
                    driver.switch_to.default_content()
                    time.sleep(10)
                except TimeoutException:
                    log("DUO push button not found. Continuing.")
                except NoSuchWindowException as exc:
                    log(f"DUO step unavailable because auth window closed. Continuing token recovery. reason={exc.__class__.__name__}")
                except (WebDriverException, ProtocolError, OSError) as exc:
                    if is_browser_transport_error(exc):
                        log(f"Browser automation reset while checking DUO. Continuing token recovery. error={exc}")
                    else:
                        raise

                try:
                    stay_signed_in_button = WebDriverWait(driver, 10).until(
                        EC.element_to_be_clickable((By.ID, "idBtn_Back"))
                    )
                    stay_signed_in_button.click()
                except TimeoutException:
                    pass
                except NoSuchWindowException as exc:
                    log(f"Stay-signed-in prompt unavailable because auth window closed. Continuing. reason={exc.__class__.__name__}")
                except (WebDriverException, ProtocolError, OSError) as exc:
                    if is_browser_transport_error(exc):
                        log(f"Browser automation reset while checking stay-signed-in prompt. Continuing. error={exc}")
                    else:
                        raise

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
            access_token = wait_for_access_token(driver, 30, include_indexeddb=duo_clicked)
            if not access_token:
                log("Triggering token request from Graph Explorer UI.")
                trigger_token_request(driver)
                access_token = wait_for_access_token(driver, 30, include_indexeddb=duo_clicked)
            if not access_token and browser == "safari":
                log("Trying Graph Explorer token-copy controls.")
                access_token = click_token_controls_like_meetings_script(driver)
            if not access_token:
                access_token = extract_token_from_dom(driver)
        except (WebDriverException, ProtocolError, OSError) as exc:
            if not is_browser_transport_error(exc):
                raise
            driver = restart_graph_driver(driver, browser, headless, str(exc))
            if duo_clicked:
                wait_for_graph_explorer_after_duo(driver, 60)
            access_token = wait_for_access_token(driver, 30, include_indexeddb=duo_clicked)
            if not access_token:
                trigger_token_request(driver)
                access_token = wait_for_access_token(driver, 30, include_indexeddb=duo_clicked)
            if not access_token and browser == "safari":
                access_token = click_token_controls_like_meetings_script(driver)
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


def main() -> None:
    token = normalize_token_value(os.getenv("GRAPH_ACCESS_TOKEN", "").strip())
    if token and not looks_like_graph_access_token(token):
        log("GRAPH_ACCESS_TOKEN is set but is not a valid Microsoft Graph access token. Ignoring it and using browser automation.")
        token = ""
    if not token:
        token = obtain_graph_token_via_browser()

    ensure_output_dir()
    (
        mail_start,
        mail_end,
        week_start,
        week_end,
        mail_start_local,
        mail_end_local,
        week_start_local,
        week_end_local,
    ) = now_windows()

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": 'outlook.timezone="Asia/Jerusalem"',
    }
    log(
        "Agenda mail window configured for the last 7 days: "
        f"{mail_start_local.strftime('%Y-%m-%d %H:%M:%S')} -> "
        f"{mail_end_local.strftime('%Y-%m-%d %H:%M:%S')}."
    )

    inbox_url = (
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages"
        f"?$filter=receivedDateTime ge {mail_start} and receivedDateTime le {mail_end}"
        "&$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,importance,isRead,bodyPreview,body,webLink"
        "&$orderby=receivedDateTime desc"
        f"&$top={MAX_EMAILS}"
    )
    sent_url = (
        "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages"
        f"?$filter=sentDateTime ge {mail_start} and sentDateTime le {mail_end}"
        "&$select=id,conversationId,subject,toRecipients,ccRecipients,sentDateTime,bodyPreview,body,webLink"
        "&$orderby=sentDateTime desc"
        f"&$top={MAX_EMAILS}"
    )
    calendar_url = (
        "https://graph.microsoft.com/v1.0/me/calendarView"
        f"?startDateTime={week_start}&endDateTime={week_end}"
        "&$select=subject,start,end,organizer,attendees,location,webLink,importance,showAs"
        "&$orderby=start/dateTime"
    )

    me_profile = None
    try:
        me_response = requests.get(
            "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
            headers=headers,
            timeout=30,
        )
        if me_response.status_code == 200:
            me_profile = me_response.json()
    except Exception as exc:
        log(f"Unable to fetch Microsoft profile. Continuing without /me identity. {exc}")

    names, tags = identity_terms(me_profile)
    log(f"Agenda identity terms configured: names={len(names)} tags={len(tags)}.")

    log("Fetching Outlook mail and calendar data.")
    inbox = fetch_graph_items(inbox_url, headers, MAX_EMAILS)
    sent = fetch_graph_items(sent_url, headers, MAX_EMAILS)
    calendar = fetch_graph_items(calendar_url, headers)

    thread_messages_by_conversation: dict[str, list[dict]] = {}
    for message in inbox:
        cid = message.get("conversationId")
        if cid:
            thread_messages_by_conversation.setdefault(cid, []).append(
                graph_message_to_thread_message(message, "Inbox")
            )
    for message in sent:
        cid = message.get("conversationId")
        if cid:
            thread_messages_by_conversation.setdefault(cid, []).append(
                graph_message_to_thread_message(message, "Sent")
            )
    for messages in thread_messages_by_conversation.values():
        messages.sort(key=lambda value: value.get("time") or "")

    sent_latest_by_conversation: dict[str, datetime] = {}
    for message in sent:
        cid = message.get("conversationId")
        ts = parse_graph_timestamp(message.get("sentDateTime"))
        if cid and ts is not None:
            prev = sent_latest_by_conversation.get(cid)
            if prev is None or ts > prev:
                sent_latest_by_conversation[cid] = ts

    inbox_latest_by_conversation: dict[str, datetime] = {}
    for message in inbox:
        cid = message.get("conversationId")
        ts = parse_graph_timestamp(message.get("receivedDateTime"))
        if cid and ts is not None:
            prev = inbox_latest_by_conversation.get(cid)
            if prev is None or ts > prev:
                inbox_latest_by_conversation[cid] = ts

    email_rows = []
    for message in inbox:
        received_raw = message.get("receivedDateTime")
        received = parse_graph_timestamp(received_raw)
        cid = message.get("conversationId")
        last_reply = sent_latest_by_conversation.get(cid)
        sender = message.get("from", {}).get("emailAddress", {})
        to_names = recipient_names(message.get("toRecipients"))
        to_emails = recipient_emails(message.get("toRecipients"))
        cc_names = recipient_names(message.get("ccRecipients"))
        cc_emails = recipient_emails(message.get("ccRecipients"))
        recipient_role = "Other"
        if any(term and "@" in term and term in to_emails.lower() for term in tags):
            recipient_role = "To"
        elif any(term and "@" in term and term in cc_emails.lower() for term in tags):
            recipient_role = "Cc"
        has_later_sent_reply = last_reply is not None and received is not None and last_reply > received
        email_rows.append({
            "Type": "Email Mission",
            "Direction": "Inbox",
            "Message Id": message.get("id"),
            "Conversation Id": message.get("conversationId"),
            "Title": message.get("subject"),
            "Owner": sender.get("name"),
            "Owner Email": sender.get("address"),
            "To": to_names,
            "To Emails": to_emails,
            "Cc": cc_names,
            "Cc Emails": cc_emails,
            "Recipient Role": recipient_role,
            "Start Date": convert_graph_datetime_to_israel(received_raw),
            "Priority": message.get("importance"),
            "Status": "Unread" if message.get("isRead") is False else "Read",
            "Preview": message_body_text(message, 1600),
            "Thread Messages": thread_messages_by_conversation.get(cid, []),
            "Link": message.get("webLink"),
            "Customer": infer_project_label({"Title": message.get("subject"), "Owner Email": sender.get("address")}),
            "Project": infer_project_label({"Title": message.get("subject"), "Owner Email": sender.get("address")}),
            "Identity Sent In Thread": thread_has_identity_sent_message(
                {"Thread Messages": thread_messages_by_conversation.get(cid, [])},
                names,
                tags,
            ),
            "Has Later Sent Reply": has_later_sent_reply,
            "Mission Reason": (
                "Configured identity already sent a later reply"
                if has_later_sent_reply
                else "No sent reply found after received time"
            ),
        })

    for message in sent:
        sent_raw = message.get("sentDateTime")
        sent_time = parse_graph_timestamp(sent_raw)
        cid = message.get("conversationId")
        latest_inbox = inbox_latest_by_conversation.get(cid)
        if sent_time is None or (latest_inbox is not None and latest_inbox > sent_time):
            continue
        to_names = recipient_names(message.get("toRecipients"))
        to_emails = recipient_emails(message.get("toRecipients"))
        cc_names = recipient_names(message.get("ccRecipients"))
        cc_emails = recipient_emails(message.get("ccRecipients"))
        subject = message.get("subject")
        preview = message_body_text(message, 1600)
        email_rows.append({
            "Type": "Email Follow Up",
            "Direction": "Sent",
            "Message Id": message.get("id"),
            "Conversation Id": cid,
            "Title": subject,
            "Owner": me_profile.get("displayName") if isinstance(me_profile, dict) else "",
            "Owner Email": me_profile.get("mail") or me_profile.get("userPrincipalName") if isinstance(me_profile, dict) else "",
            "To": to_names,
            "To Emails": to_emails,
            "Cc": cc_names,
            "Cc Emails": cc_emails,
            "Recipient Role": "Sent",
            "Start Date": convert_graph_datetime_to_israel(sent_raw),
            "Priority": message.get("importance"),
            "Status": "Sent",
            "Preview": preview,
            "Thread Messages": thread_messages_by_conversation.get(cid, []),
            "Link": message.get("webLink"),
            "Customer": infer_project_label({"Title": subject, "Owner Email": ""}),
            "Project": infer_project_label({"Title": subject, "Owner Email": ""}),
            "Identity Sent In Thread": True,
            "Mission Reason": "You sent the latest message and may be waiting on a response",
        })

    meeting_rows = []
    for event in calendar:
        organizer = event.get("organizer", {}).get("emailAddress", {})
        attendee_names = [
            attendee.get("emailAddress", {}).get("name", "")
            for attendee in event.get("attendees", [])
            if attendee.get("emailAddress")
        ]
        attendee_emails = [
            attendee.get("emailAddress", {}).get("address", "")
            for attendee in event.get("attendees", [])
            if attendee.get("emailAddress")
        ]
        attendees = ", ".join(name for name in attendee_names if name)
        meeting_rows.append({
            "Type": "Meeting",
            "Title": event.get("subject"),
            "Owner": organizer.get("name"),
            "Owner Email": organizer.get("address"),
            "To": attendees,
            "To Emails": ", ".join(email for email in attendee_emails if email),
            "Cc": "",
            "Cc Emails": "",
            "Recipient Role": "Meeting",
            "Start Date": convert_graph_datetime_to_israel(event.get("start", {}).get("dateTime")),
            "End Date": convert_graph_datetime_to_israel(event.get("end", {}).get("dateTime")),
            "Priority": event.get("importance"),
            "Status": event.get("showAs"),
            "Preview": attendees,
            "Link": event.get("webLink"),
            "Customer": infer_project_label({"Title": event.get("subject"), "Owner Email": organizer.get("address")}),
            "Project": infer_project_label({"Title": event.get("subject"), "Owner Email": organizer.get("address")}),
            "Mission Reason": "Current week meeting",
        })

    tuning = load_agenda_tuning()
    if tuning.get("hiddenThreads") or tuning.get("hiddenSenders"):
        before_email_count = len(email_rows)
        before_meeting_count = len(meeting_rows)
        email_rows = [row for row in email_rows if not row_is_tuned_out(row, tuning)]
        meeting_rows = [row for row in meeting_rows if not row_is_tuned_out(row, tuning)]
        log(
            "Applied agenda tuning filters: "
            f"mail {before_email_count}->{len(email_rows)} "
            f"meetings {before_meeting_count}->{len(meeting_rows)}."
        )
    if tuning.get("importantTerms"):
        log(f"Agenda tuning important hints loaded: {len(tuning.get('importantTerms') or [])}.")

    log("Building agenda sections.")
    agenda_sections, brief, focus, ai_provider = try_ai_build_sections(
        email_rows,
        meeting_rows,
        int(len(meeting_rows)),
        me_profile,
        tuning,
    )
    log(f"Finalizing agenda output with provider={ai_provider}.")
    missions = [
        *agenda_sections.get("tasks", []),
        *agenda_sections.get("needReply", []),
        *agenda_sections.get("followUps", []),
        *agenda_sections.get("meetingPrep", []),
        *agenda_sections.get("projectSignals", []),
        *agenda_sections.get("emailSummaries", []),
    ]

    save_rows(email_rows, "email_missions_unanswered.csv")
    save_rows(meeting_rows, "outlook_calendar_current_week_agenda.csv")
    save_rows(missions, "missions_combined.csv")

    summary = {
        "mailWindow": f"{mail_start_local.strftime('%Y-%m-%d %H:%M:%S')} -> {mail_end_local.strftime('%Y-%m-%d %H:%M:%S')}",
        "meetingWindow": f"{week_start_local.strftime('%Y-%m-%d')} -> {week_end_local.strftime('%Y-%m-%d')}",
        "unansweredEmails": int(len(email_rows)),
        "meetingsThisWeek": int(len(meeting_rows)),
        "outputDir": OUTPUT_DIR,
        "brief": brief,
        "focus": focus,
        "aiProvider": ai_provider,
        "sections": agenda_sections,
        "missions": missions[:500],
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()

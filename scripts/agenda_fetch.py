import json
import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytz
import requests

ISRAEL_TZ = pytz.timezone("Asia/Jerusalem")
OUTPUT_DIR = os.path.expanduser("~/Desktop/graph_outlook_export")
MAX_EMAILS = int(os.getenv("AGENDA_MAX_EMAILS", "500"))


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


def save_df(df: pd.DataFrame, filename: str) -> None:
    df.to_csv(os.path.join(OUTPUT_DIR, filename), index=False, encoding="utf-8-sig")


def main() -> None:
    token = os.getenv("GRAPH_ACCESS_TOKEN", "").strip()
    if not token:
        raise RuntimeError("GRAPH_ACCESS_TOKEN is required.")

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

    inbox_url = (
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages"
        f"?$filter=receivedDateTime ge {mail_start} and receivedDateTime le {mail_end}"
        "&$select=id,conversationId,subject,from,receivedDateTime,importance,isRead,bodyPreview,webLink"
        "&$orderby=receivedDateTime desc"
        f"&$top={MAX_EMAILS}"
    )
    sent_url = (
        "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages"
        f"?$filter=sentDateTime ge {mail_start} and sentDateTime le {mail_end}"
        "&$select=conversationId,sentDateTime"
        "&$orderby=sentDateTime desc"
        f"&$top={MAX_EMAILS}"
    )
    calendar_url = (
        "https://graph.microsoft.com/v1.0/me/calendarView"
        f"?startDateTime={week_start}&endDateTime={week_end}"
        "&$select=subject,start,end,organizer,attendees,location,webLink,importance,showAs"
        "&$orderby=start/dateTime"
    )

    inbox = fetch_graph_items(inbox_url, headers, MAX_EMAILS)
    sent = fetch_graph_items(sent_url, headers, MAX_EMAILS)
    calendar = fetch_graph_items(calendar_url, headers)

    sent_latest_by_conversation: dict[str, pd.Timestamp] = {}
    for message in sent:
        cid = message.get("conversationId")
        ts = pd.to_datetime((message.get("sentDateTime") or "").replace("Z", "+00:00"), utc=True, errors="coerce")
        if cid and pd.notna(ts):
            prev = sent_latest_by_conversation.get(cid)
            if prev is None or ts > prev:
                sent_latest_by_conversation[cid] = ts

    email_rows = []
    for message in inbox:
        received_raw = message.get("receivedDateTime")
        received = pd.to_datetime((received_raw or "").replace("Z", "+00:00"), utc=True, errors="coerce")
        cid = message.get("conversationId")
        last_reply = sent_latest_by_conversation.get(cid)
        if last_reply is None or pd.isna(received) or last_reply <= received:
            sender = message.get("from", {}).get("emailAddress", {})
            email_rows.append({
                "Type": "Email Mission",
                "Title": message.get("subject"),
                "Owner": sender.get("name"),
                "Owner Email": sender.get("address"),
                "Start Date": convert_graph_datetime_to_israel(received_raw),
                "Priority": message.get("importance"),
                "Status": "Unread" if message.get("isRead") is False else "Read",
                "Preview": message.get("bodyPreview"),
                "Link": message.get("webLink"),
                "Mission Reason": "No sent reply found after received time",
            })

    meeting_rows = []
    for event in calendar:
        organizer = event.get("organizer", {}).get("emailAddress", {})
        attendees = ", ".join(
            [
                attendee.get("emailAddress", {}).get("name", "")
                for attendee in event.get("attendees", [])
                if attendee.get("emailAddress")
            ]
        )
        meeting_rows.append({
            "Type": "Meeting",
            "Title": event.get("subject"),
            "Owner": organizer.get("name"),
            "Owner Email": organizer.get("address"),
            "Start Date": convert_graph_datetime_to_israel(event.get("start", {}).get("dateTime")),
            "End Date": convert_graph_datetime_to_israel(event.get("end", {}).get("dateTime")),
            "Priority": event.get("importance"),
            "Status": event.get("showAs"),
            "Preview": attendees,
            "Link": event.get("webLink"),
            "Mission Reason": "Current week meeting",
        })

    email_df = pd.DataFrame(email_rows)
    meeting_df = pd.DataFrame(meeting_rows)
    missions_df = pd.concat([email_df, meeting_df], ignore_index=True) if (not email_df.empty or not meeting_df.empty) else pd.DataFrame()

    save_df(email_df, "email_missions_unanswered.csv")
    save_df(meeting_df, "outlook_calendar_current_week_agenda.csv")
    save_df(missions_df, "missions_combined.csv")

    summary = {
        "mailWindow": f"{mail_start_local.strftime('%Y-%m-%d %H:%M:%S')} -> {mail_end_local.strftime('%Y-%m-%d %H:%M:%S')}",
        "meetingWindow": f"{week_start_local.strftime('%Y-%m-%d')} -> {week_end_local.strftime('%Y-%m-%d')}",
        "unansweredEmails": int(len(email_df)),
        "meetingsThisWeek": int(len(meeting_df)),
        "outputDir": OUTPUT_DIR,
        "missions": missions_df.fillna("").head(500).to_dict(orient="records"),
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()

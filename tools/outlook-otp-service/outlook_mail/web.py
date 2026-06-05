from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .accounts import parse_account_line
from .client import SearchOptions, fetch_message_cached, fetch_recent_messages_cached


LIST_PREVIEW_BYTES = 16384
HYDRATE_LIMIT = 1
DEFAULT_MAILBOXES = ("INBOX", "Junk")


def _mailbox_names(value: str) -> list[str]:
    raw = str(value or "").strip()
    if not raw or raw.lower() in {"default", "all", "inbox+junk", "inbox,junk"}:
        return list(DEFAULT_MAILBOXES)
    names = [item.strip() for item in raw.split(",") if item.strip()]
    return names or list(DEFAULT_MAILBOXES)


def fetch_messages(
    account_line: str,
    *,
    limit: int = 3,
    mailbox: str = "INBOX",
    query: str = "",
    unseen_only: bool = False,
    mark_seen: bool = False,
    tenant: str = "consumers",
    use_password: bool = False,
    since: float | int | str | None = None,
) -> dict[str, Any]:
    account = parse_account_line(account_line, tenant=tenant)
    mailbox_names = _mailbox_names(mailbox)
    base_limit = max(1, min(int(limit or 3), 30))
    messages = []
    folder_errors: dict[str, str] = {}
    fetched_mailboxes: list[str] = []
    since_seconds = _timestamp_seconds(since)
    since_datetime = datetime.fromtimestamp(since_seconds, timezone.utc) if since_seconds else None
    query_text = _imap_search_query(query)
    for mailbox_index, mailbox_name in enumerate(mailbox_names):
        options = SearchOptions(
            mailbox=mailbox_name,
            limit=base_limit,
            unseen_only=bool(unseen_only),
            query=query_text,
            since=since_datetime,
            mark_seen=bool(mark_seen),
        )
        try:
            records = fetch_recent_messages_cached(
                account,
                options=options,
                use_password=use_password,
                preview_bytes=LIST_PREVIEW_BYTES,
            )
        except Exception as exc:
            folder_errors[mailbox_name] = str(exc)
            continue
        fetched_mailboxes.append(mailbox_name)
        for record_index, record in enumerate(records, start=1):
            uid = str(record.uid or record_index)
            item = record.to_dict()
            item["uid"] = uid
            item["mailbox"] = mailbox_name
            item["id"] = f"{mailbox_name}:{uid}"
            item["partial"] = True
            item["preview_text"] = (record.text_body or record.body_excerpt or "").strip()[:500]
            item["text_body"] = ""
            item["html_body"] = ""
            item["raw_headers"] = ""
            item["raw_excerpt"] = ""
            item["body_excerpt"] = ""
            messages.append(item)
        if mailbox_index == 0 and _has_fresh_otp(messages, since_seconds):
            break
    messages.sort(key=lambda item: float(item.get("received_at") or 0), reverse=True)
    messages = messages[:base_limit]
    _hydrate_missing_otps(
        account,
        messages,
        use_password=use_password,
        max_messages=HYDRATE_LIMIT,
    )
    if not messages and folder_errors:
        details = "; ".join(f"{name}: {error}" for name, error in folder_errors.items())
        raise RuntimeError(f"mailbox fetch failed: {details}")
    return {
        "account": {
            "email": account.email,
            "has_oauth": account.has_oauth,
            "tenant": account.tenant,
            "auth_mode": "oauth" if account.has_oauth and not use_password else "password",
            "masked": account.masked,
        },
        "messages": messages,
        "count": len(messages),
        "mailbox": ",".join(mailbox_names),
        "mailboxes": mailbox_names,
        "fetched_mailboxes": fetched_mailboxes,
        "folder_errors": folder_errors,
        "limit": base_limit,
        "query": query_text,
        "since": since_seconds,
    }


def fetch_message(
    account_line: str,
    *,
    uid: str,
    mailbox: str = "INBOX",
    tenant: str = "consumers",
    use_password: bool = False,
) -> dict[str, Any]:
    account = parse_account_line(account_line, tenant=tenant)
    record = fetch_message_cached(
        account,
        str(uid),
        mailbox=str(mailbox or "INBOX").strip() or "INBOX",
        use_password=use_password,
    )
    item = record.to_dict()
    item["uid"] = str(record.uid or uid)
    item["mailbox"] = str(mailbox or "INBOX").strip() or "INBOX"
    item["id"] = f"{item['mailbox']}:{item['uid']}"
    item["partial"] = False
    return {"message": item}


def _hydrate_missing_otps(
    account,
    messages: list[dict[str, Any]],
    *,
    use_password: bool = False,
    max_messages: int = 5,
) -> None:
    if _has_otp(messages):
        return
    for item in messages[: max(1, int(max_messages or 1))]:
        uid = str(item.get("uid") or "").strip()
        mailbox = str(item.get("mailbox") or "INBOX").strip() or "INBOX"
        if not uid:
            continue
        try:
            record = fetch_message_cached(account, uid, mailbox=mailbox, use_password=use_password)
        except Exception:
            continue
        detail = record.to_dict()
        otp = str(detail.get("otp") or "").strip()
        if not otp:
            continue
        item["otp"] = otp
        item["subject"] = detail.get("subject") or item.get("subject") or ""
        item["from_addr"] = detail.get("from_addr") or item.get("from_addr") or ""
        item["received_at"] = detail.get("received_at") or item.get("received_at") or 0
        item["partial"] = False
        item["preview_text"] = (detail.get("text_body") or detail.get("body_excerpt") or item.get("preview_text") or "").strip()[:500]
        return


def _has_otp(messages: list[dict[str, Any]]) -> bool:
    return any(str(item.get("otp") or "").strip() for item in messages)


def _has_fresh_otp(messages: list[dict[str, Any]], since_seconds: float | None) -> bool:
    if not since_seconds:
        return _has_otp(messages)
    threshold = since_seconds - 15
    for item in messages:
        if not str(item.get("otp") or "").strip():
            continue
        try:
            received_at = float(item.get("received_at") or 0)
        except Exception:
            received_at = 0
        if not received_at or received_at >= threshold:
            return True
    return False


def _timestamp_seconds(value: float | int | str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        raw = float(value)
    except Exception:
        return None
    if raw <= 0:
        return None
    return raw / 1000 if raw > 10_000_000_000 else raw


def _imap_search_query(value: str) -> str:
    query = str(value or "").strip()
    if not query:
        return ""
    try:
        query.encode("ascii")
    except UnicodeEncodeError:
        return ""
    return query

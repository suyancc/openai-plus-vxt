from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header
from email.message import Message
from email.policy import default
from email.utils import getaddresses, parsedate_to_datetime
from html import unescape
import re
from typing import Iterable


OTP_CONTEXT_RE = re.compile(
    r"(verification|verify|security\s+code|one[-\s]?time(?:\s+password|\s+code)?|"
    r"otp|passcode|login\s+code|authentication\s+code|"
    r"验证码|校验码|确认码|动态码)",
    re.IGNORECASE,
)
HTML_TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class MessageRecord:
    uid: str
    message_id: str
    from_addr: str
    to_addr: str
    subject: str
    date: str
    received_at: float
    text_body: str
    html_body: str
    raw_headers: str
    raw_excerpt: str
    body_excerpt: str = ""
    otp: str = ""

    def to_dict(self) -> dict[str, str | float]:
        return asdict(self)


def decode_mime_header(value: str) -> str:
    chunks: list[str] = []
    for raw, charset in decode_header(str(value or "")):
        if isinstance(raw, bytes):
            for encoding in [charset, "utf-8", "gb18030", "latin1"]:
                if not encoding:
                    continue
                try:
                    chunks.append(raw.decode(encoding, errors="replace"))
                    break
                except LookupError:
                    continue
        else:
            chunks.append(str(raw))
    return "".join(chunks).strip()


def addresses_to_text(value: str) -> str:
    parsed = getaddresses([str(value or "")])
    items = []
    for name, addr in parsed:
        if name and addr:
            items.append(f"{decode_mime_header(name)} <{addr}>")
        elif addr:
            items.append(addr)
        elif name:
            items.append(decode_mime_header(name))
    return ", ".join(items)


def message_datetime(msg: Message) -> tuple[str, float]:
    raw = str(msg.get("Date") or "")
    if not raw:
        now = datetime.now(timezone.utc)
        return "", now.timestamp()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat(), dt.timestamp()
    except Exception:
        return raw, datetime.now(timezone.utc).timestamp()


def payload_to_text(part: Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        raw = part.get_payload()
        return raw if isinstance(raw, str) else ""
    charset = part.get_content_charset() or "utf-8"
    for encoding in [charset, "utf-8", "gb18030", "latin1"]:
        try:
            return payload.decode(encoding, errors="replace")
        except LookupError:
            continue
    return payload.decode("utf-8", errors="replace")


def html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", str(html or ""))
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = unescape(text)
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()


def split_bodies(msg: Message) -> tuple[str, str]:
    text_parts: list[str] = []
    html_parts: list[str] = []

    if msg.is_multipart():
        for part in msg.walk():
            if part.is_multipart():
                continue
            disposition = str(part.get("Content-Disposition") or "").lower()
            if "attachment" in disposition:
                continue
            content_type = part.get_content_type()
            body = payload_to_text(part)
            if content_type == "text/plain":
                text_parts.append(body)
            elif content_type == "text/html":
                html_parts.append(body)
            elif part.get_content_maintype() == "text":
                text_parts.append(body)
    else:
        body = payload_to_text(msg)
        if msg.get_content_type() == "text/html":
            html_parts.append(body)
        elif msg.get_content_maintype() == "text":
            text_parts.append(body)
        else:
            text_parts.append("")

    text_body = "\n\n".join(item.strip() for item in text_parts if item.strip())
    html_body = "\n\n".join(item.strip() for item in html_parts if item.strip())
    if not text_body and html_body:
        text_body = html_to_text(html_body)
    return text_body, html_body


def raw_body_excerpt(data: bytes, *, limit: int = 4000) -> str:
    text = data.decode("utf-8", errors="replace")
    if "\r\n\r\n" in text:
        body = text.split("\r\n\r\n", 1)[1]
    elif "\n\n" in text:
        body = text.split("\n\n", 1)[1]
    else:
        return ""

    cleaned_lines: list[str] = []
    in_part_headers = False
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            in_part_headers = True
            continue
        if in_part_headers:
            if not stripped:
                in_part_headers = False
            continue
        if re.match(r"(?i)^(Content-Type|Content-Transfer-Encoding|Content-Disposition|Content-ID|MIME-Version):", stripped):
            continue
        cleaned_lines.append(line)

    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned_lines)).strip()
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    if any(tag in lowered for tag in ["<html", "<body", "<div", "<p", "<table", "<br"]):
        cleaned = html_to_text(cleaned)
    return cleaned.strip()[:limit]


def _digit_candidates(text: str, lengths: Iterable[int]) -> list[str]:
    lengths_set = {int(length) for length in lengths if int(length) > 0}
    if not lengths_set:
        lengths_set = {6}
    min_len = min(lengths_set)
    max_len = max(lengths_set)
    pattern = re.compile(rf"(?<!\d)(\d{{{min_len},{max_len}}})(?!\d)")
    return [match.group(1) for match in pattern.finditer(text) if len(match.group(1)) in lengths_set]


def extract_otp(text: str, *, lengths: Iterable[int] = (6,)) -> str:
    source = str(text or "")
    if not source:
        return ""

    normalized = re.sub(r"[\u200b\u200c\u200d\xa0]", " ", source)
    for context in OTP_CONTEXT_RE.finditer(normalized):
        start = max(0, context.start() - 120)
        end = min(len(normalized), context.end() + 160)
        candidates = _digit_candidates(normalized[start:end], lengths)
        if candidates:
            return candidates[0]

    return ""


def header_lines(msg: Message) -> str:
    lines: list[str] = []
    for key, value in msg.items():
        lines.append(f"{key}: {decode_mime_header(str(value))}")
    return "\n".join(lines)


def parse_message(raw: bytes | str, *, uid: str = "") -> MessageRecord:
    data = raw.encode("utf-8", errors="replace") if isinstance(raw, str) else bytes(raw or b"")
    msg = message_from_bytes(data, policy=default)
    text_body, html_body = split_bodies(msg)
    body_excerpt = raw_body_excerpt(data)
    if not text_body and body_excerpt:
        text_body = body_excerpt
    subject = decode_mime_header(str(msg.get("Subject") or ""))
    from_addr = addresses_to_text(str(msg.get("From") or ""))
    to_addr = addresses_to_text(str(msg.get("To") or ""))
    date_text, received_at = message_datetime(msg)
    raw_headers = header_lines(msg)
    combined = "\n".join([subject, text_body, html_to_text(html_body)])
    otp = extract_otp(combined)

    return MessageRecord(
        uid=str(uid or ""),
        message_id=decode_mime_header(str(msg.get("Message-ID") or msg.get("Message-Id") or "")),
        from_addr=from_addr,
        to_addr=to_addr,
        subject=subject,
        date=date_text,
        received_at=received_at,
        text_body=text_body,
        html_body=html_body,
        raw_headers=raw_headers,
        raw_excerpt=data[:4000].decode("utf-8", errors="replace"),
        body_excerpt=body_excerpt,
        otp=otp,
    )

from __future__ import annotations

import argparse
import os
import re
import signal
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from outlook_mail.accounts import parse_account_line
from outlook_mail.parser import extract_otp, parse_message
from outlook_mail.web import fetch_message as fetch_outlook_message
from outlook_mail.web import fetch_messages as fetch_outlook_messages


APP_NAME = "OpenAI Plus VXT Outlook OTP Service"
APP_VERSION = "0.2.2"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
DEFAULT_FETCH_LIMIT = 3
_WINDOWS_CONSOLE_HANDLER: Any = None


class OutlookFetchRequest(BaseModel):
    account_line: str = Field(..., min_length=1)
    limit: int = DEFAULT_FETCH_LIMIT
    mailbox: str = "default"
    query: str = ""
    unseen_only: bool = False
    mark_seen: bool = False
    tenant: str = "consumers"
    use_password: bool = False
    since: float | None = None


class OutlookMessageRequest(BaseModel):
    account_line: str = Field(..., min_length=1)
    uid: str = Field(..., min_length=1)
    mailbox: str = "INBOX"
    tenant: str = "consumers"
    use_password: bool = False


class OutlookExtractRequest(BaseModel):
    content: str = Field(..., min_length=1)
    limit: int = 10
    mailbox: str = "default"
    query: str = ""
    unseen_only: bool = False
    mark_seen: bool = False
    tenant: str = "consumers"
    use_password: bool = False
    since: float | None = None


app = FastAPI(title=APP_NAME, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def index() -> dict[str, str]:
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "status": "ok",
        "docs": "/docs",
        "extract": "/extract",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "ok": "true",
        "version": APP_VERSION,
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/extract", response_class=HTMLResponse)
def extract_page() -> HTMLResponse:
    html_path = resource_path("static", "extract.html")
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="extract page not found")
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.post("/api/outlook/fetch")
def outlook_fetch(req: OutlookFetchRequest) -> dict[str, Any]:
    email = account_email(req.account_line)
    fetch_limit = normalize_fetch_limit(req.limit)
    query = str(req.query or "").strip()
    log(f"开始检查邮箱：{email}，邮箱目录：{req.mailbox}，关键词：{query or '无'}，数量：{fetch_limit}")
    try:
        result = fetch_outlook_messages(
            req.account_line,
            limit=fetch_limit,
            mailbox=req.mailbox,
            query=query,
            unseen_only=req.unseen_only,
            mark_seen=req.mark_seen,
            tenant=req.tenant,
            use_password=req.use_password,
            since=req.since,
        )
        messages = list(result.get("messages") or [])
        otp_items = [item for item in messages if str(item.get("otp") or "").strip()]
        if otp_items:
            latest = otp_items[0]
            log(
                f"收到验证码：邮箱={email}，验证码={latest.get('otp')}，"
                f"邮件数量={len(messages)}，主题={short_text(latest.get('subject'))}"
            )
        else:
            log(f"没有收到验证码：邮箱={email}，邮件数量={len(messages)}")
        return result
    except Exception as exc:
        log(f"检查邮箱失败：邮箱={email}，错误={short_text(exc)}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/outlook/message")
def outlook_message(req: OutlookMessageRequest) -> dict[str, Any]:
    email = account_email(req.account_line)
    log(f"开始读取完整邮件：邮箱={email}，邮箱目录={req.mailbox}，uid={req.uid}")
    try:
        result = fetch_outlook_message(
            req.account_line,
            uid=req.uid,
            mailbox=req.mailbox,
            tenant=req.tenant,
            use_password=req.use_password,
        )
        message = result.get("message") or {}
        if message.get("otp"):
            log(f"完整邮件收到验证码：邮箱={email}，验证码={message.get('otp')}，主题={short_text(message.get('subject'))}")
        else:
            log(f"完整邮件没有收到验证码：邮箱={email}，主题={short_text(message.get('subject'))}")
        return result
    except Exception as exc:
        log(f"读取完整邮件失败：邮箱={email}，错误={short_text(exc)}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/outlook/extract")
def outlook_extract(req: OutlookExtractRequest) -> dict[str, Any]:
    content = str(req.content or "")
    log(f"开始解析粘贴邮件内容：字符数={len(content)}")
    try:
        account_line = content.strip()
        if looks_like_account_line(account_line):
            return extract_from_account_line(
                account_line,
                limit=req.limit,
                mailbox=req.mailbox,
                query=req.query,
                unseen_only=req.unseen_only,
                mark_seen=req.mark_seen,
                tenant=req.tenant,
                use_password=req.use_password,
                since=req.since,
            )

        record = parse_message(content)
        item = record.to_dict()
        direct_otp = extract_otp(content)
        digit_candidates = extract_digit_candidates(content)
        if direct_otp and not item.get("otp"):
            item["otp"] = direct_otp
        if digit_candidates and not item.get("otp") and len(content) <= 5000:
            item["otp"] = digit_candidates[0]
        item["partial"] = False
        item["input_length"] = len(content)
        item["digit_candidates"] = digit_candidates
        if item.get("otp"):
            log(f"粘贴内容提取到验证码：验证码={item.get('otp')}，主题={short_text(item.get('subject'))}")
        else:
            log(f"粘贴内容未提取到验证码：主题={short_text(item.get('subject'))}")
        return {"message": item}
    except Exception as exc:
        log(f"解析粘贴邮件内容失败：错误={short_text(exc)}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def extract_from_account_line(
    account_line: str,
    *,
    limit: int = 10,
    mailbox: str = "default",
    query: str = "",
    unseen_only: bool = False,
    mark_seen: bool = False,
    tenant: str = "consumers",
    use_password: bool = False,
    since: float | None = None,
) -> dict[str, Any]:
    email = account_email(account_line)
    fetch_limit = normalize_extract_limit(limit)
    log(f"检测到账号行，开始拉取最近邮件：邮箱={email}，邮箱目录={mailbox}，数量={fetch_limit}")
    result = fetch_outlook_messages(
        account_line,
        limit=fetch_limit,
        mailbox=mailbox,
        query=str(query or "").strip(),
        unseen_only=unseen_only,
        mark_seen=mark_seen,
        tenant=tenant,
        use_password=use_password,
        since=since,
    )
    messages = list(result.get("messages") or [])
    selected = next((item for item in messages if str(item.get("otp") or "").strip()), messages[0] if messages else None)
    if selected:
        selected = hydrate_extract_message(account_line, selected, tenant=tenant, use_password=use_password)
        otp = str(selected.get("otp") or "").strip()
        if otp:
            log(f"账号行提取到验证码：邮箱={email}，验证码={otp}，主题={short_text(selected.get('subject'))}")
        else:
            log(f"账号行未提取到验证码：邮箱={email}，邮件数量={len(messages)}")
    else:
        selected = empty_extract_message(account_line, result)
        log(f"账号行没有拉取到邮件：邮箱={email}")

    selected["input_type"] = "account_line"
    selected["input_length"] = len(account_line)
    selected["digit_candidates"] = []
    return {
        "message": selected,
        "messages": messages,
        "count": len(messages),
        "source": "account_line",
        "account": result.get("account"),
        "mailboxes": result.get("mailboxes"),
        "fetched_mailboxes": result.get("fetched_mailboxes"),
        "folder_errors": result.get("folder_errors"),
    }


def looks_like_account_line(value: str) -> bool:
    text = str(value or "").strip()
    if "\n" in text or "\r" in text or "----" not in text:
        return False
    try:
        parse_account_line(text)
        return True
    except Exception:
        return False


def hydrate_extract_message(
    account_line: str,
    selected: dict[str, Any],
    *,
    tenant: str = "consumers",
    use_password: bool = False,
) -> dict[str, Any]:
    item = dict(selected)
    uid = str(item.get("uid") or "").strip()
    mailbox = str(item.get("mailbox") or "INBOX").strip() or "INBOX"
    if uid:
        try:
            full = fetch_outlook_message(account_line, uid=uid, mailbox=mailbox, tenant=tenant, use_password=use_password)
            detail = dict(full.get("message") or {})
            if detail:
                item.update(detail)
        except Exception:
            pass
    item["text_body"] = str(item.get("text_body") or item.get("body_excerpt") or item.get("preview_text") or "")
    item["html_body"] = str(item.get("html_body") or "")
    item["raw_headers"] = str(item.get("raw_headers") or "")
    item["raw_excerpt"] = str(item.get("raw_excerpt") or "")
    item["body_excerpt"] = str(item.get("body_excerpt") or "")
    item["partial"] = bool(item.get("partial")) if "partial" in item else not bool(item.get("text_body"))
    return item


def empty_extract_message(account_line: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "uid": "",
        "message_id": "",
        "from_addr": "",
        "to_addr": "",
        "subject": "",
        "date": "",
        "received_at": 0,
        "text_body": "",
        "html_body": "",
        "raw_headers": "",
        "raw_excerpt": "",
        "body_excerpt": "",
        "otp": "",
        "partial": False,
        "account": result.get("account"),
        "account_email": account_email(account_line),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind to")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind to")
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    install_exit_handlers()
    args = build_parser().parse_args(argv)
    base_url = f"http://{args.host}:{args.port}"
    print(f"{APP_NAME} v{APP_VERSION}", flush=True)
    print("服务已启动，可以开始取 Outlook 邮件。", flush=True)
    print(f"网页取件地址：{base_url}/extract", flush=True)
    print(f"健康检查地址：{base_url}/health", flush=True)
    print("接口地址：POST /api/outlook/fetch、POST /api/outlook/message", flush=True)
    print("关闭方式：按 Ctrl+C 退出服务。", flush=True)
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",
        access_log=False,
    )
    return 0


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def install_exit_handlers() -> None:
    for name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, _signal_exit)
        except Exception:
            pass

    if not sys.platform.startswith("win"):
        return

    try:
        import ctypes
    except Exception:
        return

    ctrl_close_event = 2
    ctrl_logoff_event = 5
    ctrl_shutdown_event = 6
    handler_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)

    def console_handler(event: int) -> bool:
        if event in {ctrl_close_event, ctrl_logoff_event, ctrl_shutdown_event}:
            try:
                log("收到窗口关闭事件，正在退出服务")
            finally:
                os._exit(0)
        return False

    global _WINDOWS_CONSOLE_HANDLER
    _WINDOWS_CONSOLE_HANDLER = handler_type(console_handler)
    try:
        ctypes.windll.kernel32.SetConsoleCtrlHandler(_WINDOWS_CONSOLE_HANDLER, True)
    except Exception:
        pass


def _signal_exit(signum: int, _frame: Any) -> None:
    log(f"收到退出信号 {signum}，正在退出服务")
    raise SystemExit(0)


def account_email(account_line: str) -> str:
    email = str(account_line or "").split("----", 1)[0].strip().lower()
    return email or "-"


def short_text(value: Any, limit: int = 120) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text or "-"
    return f"{text[:limit - 3]}..."


def normalize_fetch_limit(value: Any) -> int:
    try:
        raw = int(value or DEFAULT_FETCH_LIMIT)
    except Exception:
        raw = DEFAULT_FETCH_LIMIT
    return max(1, min(raw, DEFAULT_FETCH_LIMIT))


def normalize_extract_limit(value: Any) -> int:
    try:
        raw = int(value or 10)
    except Exception:
        raw = 10
    return max(1, min(raw, 30))


def extract_digit_candidates(value: str, *, limit: int = 8) -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []
    for match in re.finditer(r"(?<!\d)(\d{6})(?!\d)", str(value or "")):
        candidate = match.group(1)
        if candidate in seen:
            continue
        seen.add(candidate)
        candidates.append(candidate)
        if len(candidates) >= limit:
            break
    return candidates


def resource_path(*parts: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base.joinpath(*parts)


def log(message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())

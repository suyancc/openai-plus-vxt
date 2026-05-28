from __future__ import annotations

import argparse
import os
import signal
import sys
from datetime import datetime
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "ok": "true",
        "version": APP_VERSION,
    }


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind to")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind to")
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    install_exit_handlers()
    args = build_parser().parse_args(argv)
    print(f"{APP_NAME} v{APP_VERSION}")
    print(f"Listening on http://{args.host}:{args.port}")
    print("Compatible endpoint: POST /api/outlook/fetch")
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
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


def log(message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


CHECKOUT_URL = "https://chatgpt.com/backend-api/payments/checkout"
TOKEN_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8788
DEFAULT_TOKEN_FILE = "uploaded_tokens.txt"
DEFAULT_TIMEOUT = 75

app = FastAPI(title="ChatGPT Checkout Raw API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_TOKEN_FILE = Path(DEFAULT_TOKEN_FILE)
_TIMEOUT = DEFAULT_TIMEOUT
_TOKEN_LOCK = threading.Lock()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "checkout-raw-api"}


@app.post("/checkout")
async def checkout(request: Request) -> JSONResponse:
    return await checkout_raw(request)


@app.post("/checkout/raw")
async def checkout_raw(request: Request) -> JSONResponse:
    payload = await read_request_payload(request)
    token = extract_token_from_payload(payload)
    if not token:
        raise HTTPException(status_code=400, detail="Missing token/accessToken.")

    save_token_once(token, _TOKEN_FILE)
    upstream = await asyncio.to_thread(call_checkout_api, token, _TIMEOUT)
    return JSONResponse(content=upstream["body"], status_code=upstream["status"])


async def read_request_payload(request: Request) -> Any:
    content_type = request.headers.get("content-type", "")
    raw = await request.body()
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return {}
    if "application/json" in content_type.lower():
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc
    return text


def extract_token_from_payload(payload: Any) -> str:
    if isinstance(payload, str):
        return extract_access_token(payload)
    if isinstance(payload, dict):
        for key in ("token", "accessToken", "access_token"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return extract_access_token(value)
        for value in payload.values():
            token = extract_token_from_payload(value)
            if token:
                return token
    if isinstance(payload, list):
        for value in payload:
            token = extract_token_from_payload(value)
            if token:
                return token
    return ""


def extract_access_token(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if text.lower().startswith("bearer "):
        text = text[7:].strip()
    match = TOKEN_RE.search(text)
    return match.group(0) if match else text


def save_token_once(token: str, token_file: Path) -> None:
    token_file.parent.mkdir(parents=True, exist_ok=True)
    with _TOKEN_LOCK:
        existing: list[str] = []
        if token_file.exists():
            existing = [line.strip() for line in token_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        if token not in set(existing):
            existing.append(token)
            token_file.write_text("\n".join(existing) + "\n", encoding="utf-8")


def call_checkout_api(token: str, timeout: int) -> dict[str, Any]:
    body = json.dumps(build_checkout_payload(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        CHECKOUT_URL,
        data=body,
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
            "origin": "https://chatgpt.com",
            "referer": "https://chatgpt.com/",
            "user-agent": chrome_user_agent(),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return {"status": resp.status, "body": parse_json_body(text, resp.status)}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        return {"status": exc.code, "body": parse_json_body(text, exc.code)}
    except Exception as exc:
        return {
            "status": 502,
            "body": {
                "error": "checkout_request_failed",
                "detail": str(exc),
            },
        }


def parse_json_body(text: str, status: int) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "upstream_status": status,
            "raw_text": text,
        }


def build_checkout_payload() -> dict[str, Any]:
    return {
        "entry_point": "all_plans_pricing_modal",
        "plan_name": "chatgptplusplan",
        "billing_details": {"country": "US", "currency": "USD"},
        "cancel_url": "https://chatgpt.com/#pricing",
        "checkout_ui_mode": "hosted",
        "promo_campaign": {
            "promo_campaign_id": "plus-1-month-free",
            "is_coupon_from_query_param": False,
        },
    }


def chrome_user_agent() -> str:
    return (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a no-proxy FastAPI checkout raw JSON service.")
    parser.add_argument("--host", default=os.environ.get("CHECKOUT_API_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("CHECKOUT_API_PORT", DEFAULT_PORT)))
    parser.add_argument("--token-file", default=os.environ.get("CHECKOUT_TOKEN_FILE", DEFAULT_TOKEN_FILE))
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("CHECKOUT_TIMEOUT", DEFAULT_TIMEOUT)))
    args = parser.parse_args()

    global _TOKEN_FILE, _TIMEOUT
    _TOKEN_FILE = Path(args.token_file)
    _TIMEOUT = args.timeout

    try:
        import uvicorn
    except ImportError:
        print("Missing dependency. Install with: python -m pip install fastapi 'uvicorn[standard]'", file=sys.stderr)
        return 1

    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

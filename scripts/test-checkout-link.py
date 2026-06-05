import argparse
import asyncio
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


CHECKOUT_URL = "https://chatgpt.com/backend-api/payments/checkout"
TOKEN_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
CHECKOUT_SESSION_RE = re.compile(r"(cs_(?:live|test)_[A-Za-z0-9]+)")
PROCESSOR_ENTITY_RE = re.compile(r"(?:/checkout/|processor_entity=)([A-Za-z0-9_]+)")

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8788
DEFAULT_TOKEN_FILE = "uploaded_tokens.txt"
DEFAULT_TIMEOUT = 75
DEFAULT_BILLING_DETAILS = {"country": "US", "currency": "USD"}
REGION_BILLING = {
    "US": {"country": "US", "currency": "USD"},
    "ID": {"country": "ID", "currency": "IDR"},
    "DE": {"country": "DE", "currency": "EUR"},
    "JP": {"country": "JP", "currency": "JPY"},
}


class CheckoutRegion(str, Enum):
    US = "US"
    ID = "ID"
    DE = "DE"
    JP = "JP"


class BillingDetails(BaseModel):
    country: str = Field("US", description="Two-letter billing country code, for example US.")
    currency: str = Field("USD", description="Three-letter billing currency code, for example USD.")


class CheckoutRequest(BaseModel):
    token: Optional[str] = Field(
        None,
        description="ChatGPT access token. You can paste a raw JWT or a Bearer token.",
        examples=["eyJ..."],
    )
    accessToken: Optional[str] = Field(None, description="Alternative token field name used by ChatGPT session JSON.")
    access_token: Optional[str] = Field(None, description="Alternative snake_case token field name.")
    country: Optional[str] = Field(None, description="Optional override. Prefer the region query dropdown in /docs.")
    currency: Optional[str] = Field(None, description="Optional override. Prefer the region query dropdown in /docs.")
    billing_details: Optional[BillingDetails] = Field(None, description="Optional nested billing details.")
    billingDetails: Optional[BillingDetails] = Field(None, description="Optional camelCase nested billing details.")

    model_config = {
        "extra": "allow",
        "json_schema_extra": {
            "examples": [
                {
                    "token": "eyJ...",
                },
                {
                    "token": "eyJ...",
                    "country": "JP",
                    "currency": "JPY",
                },
            ],
        },
    }

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
async def checkout(
    body: CheckoutRequest = Body(
        default_factory=CheckoutRequest,
        description="Token payload. Use token/accessToken/access_token, or paste compatible JSON.",
    ),
    region: CheckoutRegion = Query(CheckoutRegion.US, description="Billing region dropdown for Swagger testing."),
) -> JSONResponse:
    return await handle_checkout_payload(model_to_payload(body), region)


@app.post("/checkout/raw")
async def checkout_raw(
    body: CheckoutRequest = Body(
        default_factory=CheckoutRequest,
        description="Token payload. Use token/accessToken/access_token, or paste compatible JSON.",
    ),
    region: CheckoutRegion = Query(CheckoutRegion.US, description="Billing region dropdown for Swagger testing."),
) -> JSONResponse:
    return await handle_checkout_payload(model_to_payload(body), region)


@app.post("/checkout/legacy", include_in_schema=False)
async def checkout_legacy(request: Request) -> JSONResponse:
    payload = await read_request_payload(request)
    return await handle_checkout_payload(payload, CheckoutRegion.US)


async def handle_checkout_payload(payload: Any, region: CheckoutRegion) -> JSONResponse:
    token = extract_token_from_payload(payload)
    if not token:
        raise HTTPException(status_code=400, detail="Missing token/accessToken.")

    billing_details = extract_billing_details_from_payload(payload, region)
    save_token_once(token, _TOKEN_FILE)
    upstream = await asyncio.to_thread(call_checkout_api, token, _TIMEOUT, billing_details)
    body = upstream["body"]
    if upstream["status"] < 400:
        body = build_checkout_response(body, billing_details)
    return JSONResponse(content=body, status_code=upstream["status"])


def model_to_payload(value: Any) -> Any:
    if isinstance(value, BaseModel):
        if hasattr(value, "model_dump"):
            return value.model_dump(exclude_none=True)
        return value.dict(exclude_none=True)
    return value


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


def extract_billing_details_from_payload(payload: Any, region: CheckoutRegion = CheckoutRegion.US) -> dict[str, str]:
    region_billing = billing_details_for_region(region)
    if not isinstance(payload, dict):
        return region_billing

    nested: dict[str, Any] = {}
    for key in ("billing_details", "billingDetails"):
        value = payload.get(key)
        if isinstance(value, dict):
            nested.update(value)

    country = normalize_country(payload.get("country") or nested.get("country") or region_billing["country"])
    currency = normalize_currency(payload.get("currency") or nested.get("currency") or region_billing["currency"])
    return {"country": country, "currency": currency}


def billing_details_for_region(region: CheckoutRegion | str) -> dict[str, str]:
    key = str(region.value if isinstance(region, CheckoutRegion) else region).strip().upper()
    return dict(REGION_BILLING.get(key, DEFAULT_BILLING_DETAILS))


def normalize_country(value: Any) -> str:
    country = str(value or "").strip().upper()
    if not COUNTRY_RE.fullmatch(country):
        raise HTTPException(status_code=400, detail="country must be a 2-letter ISO code, for example US.")
    return country


def normalize_currency(value: Any) -> str:
    currency = str(value or "").strip().upper()
    if not CURRENCY_RE.fullmatch(currency):
        raise HTTPException(status_code=400, detail="currency must be a 3-letter ISO code, for example USD.")
    return currency


def save_token_once(token: str, token_file: Path) -> None:
    token_file.parent.mkdir(parents=True, exist_ok=True)
    with _TOKEN_LOCK:
        existing: list[str] = []
        if token_file.exists():
            existing = [line.strip() for line in token_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        if token not in set(existing):
            existing.append(token)
            token_file.write_text("\n".join(existing) + "\n", encoding="utf-8")


def call_checkout_api(token: str, timeout: int, billing_details: dict[str, str] | None = None) -> dict[str, Any]:
    body = json.dumps(build_checkout_payload(billing_details), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
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


def build_checkout_response(data: Any, billing_details: dict[str, str]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"raw": data}

    provider_url = find_provider_url(data)
    session_id = find_checkout_session(data, provider_url)
    processor_entity = find_processor_entity(data, provider_url, billing_details.get("country", "US"))
    canonical_url = (
        f"https://chatgpt.com/checkout/{processor_entity}/{session_id}"
        if session_id and processor_entity
        else ""
    )
    link = provider_url or canonical_url
    return {
        **data,
        "ok": bool(link),
        "message": "checkout link generated" if link else "checkout response did not include a checkout link",
        "link": link,
        "url": link,
        "longUrl": provider_url,
        "long_url": provider_url,
        "providerUrl": provider_url,
        "provider_url": provider_url,
        "shortUrl": canonical_url,
        "short_url": canonical_url,
        "canonicalUrl": canonical_url,
        "canonical_url": canonical_url,
        "billingDetails": {
            "country": billing_details.get("country", ""),
            "currency": billing_details.get("currency", ""),
        },
        "responseKeys": list(data.keys())[:20],
        "raw": data,
    }


def find_provider_url(data: dict[str, Any]) -> str:
    for key in ("url", "stripe_hosted_url", "checkout_url", "providerUrl", "provider_url"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def find_checkout_session(data: dict[str, Any], provider_url: str) -> str:
    direct = str(data.get("checkout_session_id") or data.get("session_id") or "").strip()
    if direct:
        return direct
    return extract_checkout_session(
        " ".join(
            str(data.get(key) or "")
            for key in ("success_url", "cancel_url", "return_url", "client_secret")
        )
        + " "
        + provider_url
    )


def find_processor_entity(data: dict[str, Any], provider_url: str, billing_country: str) -> str:
    direct = str(data.get("processor_entity") or "").strip()
    if direct:
        return direct
    text = " ".join(
        str(data.get(key) or "")
        for key in ("success_url", "cancel_url", "return_url")
    ) + " " + provider_url
    match = PROCESSOR_ENTITY_RE.search(text)
    if match:
        return match.group(1)
    return "openai_llc" if str(billing_country).upper() == "US" else "openai_ie"


def extract_checkout_session(value: str) -> str:
    match = CHECKOUT_SESSION_RE.search(value or "")
    return match.group(1) if match else ""


def build_checkout_payload(billing_details: dict[str, str] | None = None) -> dict[str, Any]:
    billing = billing_details or DEFAULT_BILLING_DETAILS
    return {
        "entry_point": "all_plans_pricing_modal",
        "plan_name": "chatgptplusplan",
        "billing_details": {
            "country": normalize_country(billing.get("country")),
            "currency": normalize_currency(billing.get("currency")),
        },
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

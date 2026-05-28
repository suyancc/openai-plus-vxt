from __future__ import annotations

from dataclasses import dataclass
import time
from threading import RLock
from typing import Any

import requests

from .accounts import OutlookAccount


DEFAULT_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
TOKEN_CACHE_SKEW_SECONDS = 120


@dataclass(frozen=True)
class OAuthToken:
    access_token: str
    expires_in: int = 0
    scope: str = ""
    token_type: str = "Bearer"


class OAuthError(RuntimeError):
    pass


_TOKEN_CACHE: dict[tuple[str, str, str, str], tuple[OAuthToken, float]] = {}
_TOKEN_CACHE_LOCK = RLock()


def refresh_access_token(
    account: OutlookAccount,
    *,
    scope: str = DEFAULT_SCOPE,
    timeout_s: float = 30.0,
) -> OAuthToken:
    if not account.client_id or not account.refresh_token:
        raise OAuthError("client_id and refresh_token are required")

    cache_key = (account.tenant or "consumers", account.client_id, account.refresh_token, scope)
    now = time.time()
    with _TOKEN_CACHE_LOCK:
        cached = _TOKEN_CACHE.get(cache_key)
        if cached:
            token, expires_at = cached
            if expires_at - TOKEN_CACHE_SKEW_SECONDS > now:
                remaining = max(0, int(expires_at - now))
                return OAuthToken(
                    access_token=token.access_token,
                    expires_in=remaining,
                    scope=token.scope,
                    token_type=token.token_type,
                )

    url = TOKEN_URL_TEMPLATE.format(tenant=account.tenant or "consumers")
    data = {
        "client_id": account.client_id,
        "grant_type": "refresh_token",
        "refresh_token": account.refresh_token,
        "scope": scope,
    }
    try:
        resp = requests.post(url, data=data, timeout=timeout_s)
    except requests.RequestException as exc:
        raise OAuthError(f"token refresh request failed: {exc}") from exc

    payload: dict[str, Any]
    try:
        payload = resp.json()
    except ValueError:
        payload = {"error": "non_json_response", "error_description": resp.text[:500]}

    if resp.status_code >= 400 or not payload.get("access_token"):
        code = payload.get("error") or resp.status_code
        description = payload.get("error_description") or payload.get("error_uri") or "token refresh failed"
        raise OAuthError(f"{code}: {description}")

    token = OAuthToken(
        access_token=str(payload.get("access_token") or ""),
        expires_in=int(payload.get("expires_in") or 0),
        scope=str(payload.get("scope") or ""),
        token_type=str(payload.get("token_type") or "Bearer"),
    )
    expires_at = now + max(0, token.expires_in)
    with _TOKEN_CACHE_LOCK:
        _TOKEN_CACHE[cache_key] = (token, expires_at)
    return token

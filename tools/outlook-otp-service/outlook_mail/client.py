from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import imaplib
import time
from threading import RLock
from typing import Callable

from .accounts import OutlookAccount
from .oauth import refresh_access_token
from .parser import MessageRecord, parse_message


DEFAULT_IMAP_HOST = "outlook.office365.com"
DEFAULT_IMAP_PORT = 993
DEFAULT_CONNECTION_TTL_S = 90.0


@dataclass(frozen=True)
class SearchOptions:
    mailbox: str = "INBOX"
    limit: int = 10
    unseen_only: bool = False
    query: str = ""
    since: datetime | None = None
    mark_seen: bool = False


class OutlookIMAPError(RuntimeError):
    pass


_CLIENT_CACHE: dict[tuple[str, ...], tuple["OutlookIMAPClient", float]] = {}
_CLIENT_CACHE_LOCK = RLock()


class OutlookIMAPClient:
    def __init__(
        self,
        account: OutlookAccount,
        *,
        host: str = DEFAULT_IMAP_HOST,
        port: int = DEFAULT_IMAP_PORT,
        token_provider: Callable[[OutlookAccount], str] | None = None,
        use_password: bool = False,
        timeout_s: float = 30.0,
    ) -> None:
        self.account = account
        self.host = str(host or DEFAULT_IMAP_HOST)
        self.port = int(port or DEFAULT_IMAP_PORT)
        self.token_provider = token_provider
        self.use_password = bool(use_password)
        self.timeout_s = float(timeout_s)
        self._imap: imaplib.IMAP4_SSL | None = None
        self._lock = RLock()

    def __enter__(self) -> "OutlookIMAPClient":
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def connect(self) -> None:
        with self._lock:
            if self._imap is not None:
                return
            imap = imaplib.IMAP4_SSL(self.host, self.port, timeout=self.timeout_s)
            try:
                if self.use_password or not self.account.has_oauth:
                    if not self.account.password:
                        raise OutlookIMAPError("password login requested but password is empty")
                    imap.login(self.account.email, self.account.password)
                else:
                    token = self.token_provider(self.account) if self.token_provider else refresh_access_token(self.account).access_token
                    self._authenticate_xoauth2(imap, token)
            except Exception:
                try:
                    imap.logout()
                except Exception:
                    pass
                raise
            self._imap = imap

    def close(self) -> None:
        with self._lock:
            imap = self._imap
            self._imap = None
            if not imap:
                return
            try:
                imap.close()
            except Exception:
                pass
            try:
                imap.logout()
            except Exception:
                pass

    def noop(self) -> bool:
        with self._lock:
            imap = self._imap
            if imap is None:
                return False
            try:
                status, _data = imap.noop()
                return status == "OK"
            except Exception:
                return False

    def fetch_recent(
        self,
        options: SearchOptions | None = None,
        *,
        preview_bytes: int | None = None,
    ) -> list[MessageRecord]:
        options = options or SearchOptions()
        with self._lock:
            imap = self._require_imap()
            status, data = imap.select(options.mailbox, readonly=not options.mark_seen)
            if status != "OK":
                raise OutlookIMAPError(f"cannot select mailbox {options.mailbox!r}: {data}")

            charset, criteria = self._build_search_args(options)
            status, data = imap.uid("SEARCH", charset, *criteria)
            if status != "OK":
                raise OutlookIMAPError(f"search failed: {data}")

            uids = data[0].split() if data and data[0] else []
            selected = list(reversed(uids))[: max(1, int(options.limit or 10))]
            records: list[MessageRecord] = []
            fetch_item = self._build_fetch_item(mark_seen=options.mark_seen, preview_bytes=preview_bytes)
            for raw_uid in selected:
                uid = raw_uid.decode("ascii", errors="ignore")
                raw_message = self._fetch_message_bytes(imap, raw_uid, fetch_item=fetch_item)
                if raw_message:
                    records.append(parse_message(raw_message, uid=uid))
            return records

    def fetch_message(
        self,
        uid: str,
        *,
        mailbox: str = "INBOX",
        mark_seen: bool = False,
    ) -> MessageRecord:
        with self._lock:
            imap = self._require_imap()
            status, data = imap.select(mailbox, readonly=not mark_seen)
            if status != "OK":
                raise OutlookIMAPError(f"cannot select mailbox {mailbox!r}: {data}")
            raw_message = self._fetch_message_bytes(
                imap,
                str(uid).encode("ascii", errors="ignore") or str(uid).encode("utf-8", errors="ignore"),
                fetch_item=self._build_fetch_item(mark_seen=mark_seen, preview_bytes=None),
            )
            if not raw_message:
                raise OutlookIMAPError(f"message not found: {uid}")
            return parse_message(raw_message, uid=str(uid))

    def _require_imap(self) -> imaplib.IMAP4_SSL:
        if self._imap is None:
            self.connect()
        if self._imap is None:
            raise OutlookIMAPError("IMAP connection is not available")
        return self._imap

    def _authenticate_xoauth2(self, imap: imaplib.IMAP4_SSL, access_token: str) -> None:
        xoauth2 = f"user={self.account.email}\x01auth=Bearer {access_token}\x01\x01".encode("utf-8")

        def auth(_challenge: bytes) -> bytes:
            return xoauth2

        status, data = imap.authenticate("XOAUTH2", auth)
        if status != "OK":
            raise OutlookIMAPError(f"XOAUTH2 authentication failed: {data}")

    def _build_search_args(self, options: SearchOptions) -> tuple[str | None, list[str | bytes]]:
        criteria: list[str | bytes] = ["UNSEEN" if options.unseen_only else "ALL"]
        if options.since:
            criteria.extend(["SINCE", options.since.strftime("%d-%b-%Y")])
        query = str(options.query or "").strip()
        if query:
            try:
                query.encode("ascii")
                criteria.extend(["TEXT", query])
            except UnicodeEncodeError:
                criteria.extend(["TEXT", query.encode("utf-8")])
                return "UTF-8", criteria
        return None, criteria

    def _extract_fetch_bytes(self, fetched: list[bytes | tuple]) -> bytes:
        for item in fetched:
            if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], bytes):
                return item[1]
        return b""

    def _build_fetch_item(self, *, mark_seen: bool, preview_bytes: int | None) -> str:
        if preview_bytes is not None:
            size = max(1, int(preview_bytes or 0))
            body = "BODY[]" if mark_seen else "BODY.PEEK[]"
            return f"({body}<0.{size}>)"
        return "(RFC822)" if mark_seen else "(BODY.PEEK[])"

    def _fetch_message_bytes(
        self,
        imap: imaplib.IMAP4_SSL,
        raw_uid: bytes,
        *,
        fetch_item: str,
    ) -> bytes:
        status, fetched = imap.uid("FETCH", raw_uid, fetch_item)
        if status != "OK":
            return b""
        return self._extract_fetch_bytes(fetched)


def fetch_recent_messages(
    account: OutlookAccount,
    *,
    options: SearchOptions | None = None,
    host: str = DEFAULT_IMAP_HOST,
    port: int = DEFAULT_IMAP_PORT,
    use_password: bool = False,
    preview_bytes: int | None = None,
) -> list[MessageRecord]:
    with OutlookIMAPClient(account, host=host, port=port, use_password=use_password) as client:
        return client.fetch_recent(options, preview_bytes=preview_bytes)


def fetch_recent_messages_cached(
    account: OutlookAccount,
    *,
    options: SearchOptions | None = None,
    host: str = DEFAULT_IMAP_HOST,
    port: int = DEFAULT_IMAP_PORT,
    use_password: bool = False,
    preview_bytes: int | None = None,
    ttl_s: float = DEFAULT_CONNECTION_TTL_S,
) -> list[MessageRecord]:
    client = _cached_client(account, host=host, port=port, use_password=use_password, ttl_s=ttl_s)
    return client.fetch_recent(options, preview_bytes=preview_bytes)


def fetch_message(
    account: OutlookAccount,
    uid: str,
    *,
    mailbox: str = "INBOX",
    host: str = DEFAULT_IMAP_HOST,
    port: int = DEFAULT_IMAP_PORT,
    use_password: bool = False,
) -> MessageRecord:
    with OutlookIMAPClient(account, host=host, port=port, use_password=use_password) as client:
        return client.fetch_message(uid, mailbox=mailbox)


def fetch_message_cached(
    account: OutlookAccount,
    uid: str,
    *,
    mailbox: str = "INBOX",
    host: str = DEFAULT_IMAP_HOST,
    port: int = DEFAULT_IMAP_PORT,
    use_password: bool = False,
    ttl_s: float = DEFAULT_CONNECTION_TTL_S,
) -> MessageRecord:
    client = _cached_client(account, host=host, port=port, use_password=use_password, ttl_s=ttl_s)
    return client.fetch_message(uid, mailbox=mailbox)


def close_cached_connections() -> None:
    with _CLIENT_CACHE_LOCK:
        cached = list(_CLIENT_CACHE.values())
        _CLIENT_CACHE.clear()
    for client, _expires_at in cached:
        client.close()


def _cached_client(
    account: OutlookAccount,
    *,
    host: str,
    port: int,
    use_password: bool,
    ttl_s: float,
) -> OutlookIMAPClient:
    key = (
        account.email,
        account.tenant,
        account.client_id,
        account.refresh_token,
        account.password if use_password else "",
        str(host or DEFAULT_IMAP_HOST),
        int(port or DEFAULT_IMAP_PORT),
        bool(use_password),
    )
    now = time.time()
    ttl = max(1.0, float(ttl_s or DEFAULT_CONNECTION_TTL_S))
    with _CLIENT_CACHE_LOCK:
        cached = _CLIENT_CACHE.get(key)
        if cached:
            client, expires_at = cached
            if expires_at > now and client.noop():
                _CLIENT_CACHE[key] = (client, now + ttl)
                return client
            client.close()
            _CLIENT_CACHE.pop(key, None)

        client = OutlookIMAPClient(account, host=host, port=port, use_password=use_password)
        try:
            client.connect()
        except Exception:
            client.close()
            raise
        _CLIENT_CACHE[key] = (client, now + ttl)
        return client


def wait_for_otp(
    account: OutlookAccount,
    *,
    timeout_s: int = 180,
    interval_s: float = 5.0,
    options: SearchOptions | None = None,
    host: str = DEFAULT_IMAP_HOST,
    port: int = DEFAULT_IMAP_PORT,
    use_password: bool = False,
) -> MessageRecord:
    started = time.time()
    deadline = started + max(1, int(timeout_s))
    interval = max(0.5, float(interval_s))
    search_options = options or SearchOptions(limit=10)
    while time.time() < deadline:
        records = fetch_recent_messages(
            account,
            options=search_options,
            host=host,
            port=port,
            use_password=use_password,
        )
        for record in records:
            if record.otp and record.received_at >= started - 5:
                return record
        time.sleep(interval)
    raise TimeoutError(f"waiting for Outlook OTP timed out: {account.email}")

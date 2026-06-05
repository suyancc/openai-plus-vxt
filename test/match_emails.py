from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
JSON_PATH = BASE_DIR / "sub2api_automation.json"
EMAIL_PATH = BASE_DIR / "email.txt"
OUTPUT_PATH = BASE_DIR / "matched_emails.txt"


def load_json_emails(path: Path) -> set[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    accounts = data.get("accounts", [])
    emails: set[str] = set()
    for account in accounts:
        name = account.get("name")
        if isinstance(name, str) and name.strip():
            emails.add(name.strip().casefold())
    return emails


def load_matched_emails(json_emails: set[str], path: Path) -> list[str]:
    matched: list[str] = []
    seen: set[str] = set()

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue

        email = line.split("----", 1)[0].strip()
        key = email.casefold()
        if key in json_emails and key not in seen:
            matched.append(raw_line)
            seen.add(key)

    return matched


def main() -> None:
    json_emails = load_json_emails(JSON_PATH)
    matched_emails = load_matched_emails(json_emails, EMAIL_PATH)
    OUTPUT_PATH.write_text("\n".join(matched_emails) + ("\n" if matched_emails else ""), encoding="utf-8")
    print(f"matched {len(matched_emails)} emails -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

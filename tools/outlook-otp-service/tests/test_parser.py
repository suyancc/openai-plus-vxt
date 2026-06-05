from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import server
from outlook_mail.accounts import OutlookAccount
from outlook_mail.client import OutlookIMAPClient, SearchOptions
from outlook_mail.parser import extract_otp, parse_message


class OutlookParserTest(unittest.TestCase):
    def test_extracts_chinese_verification_code(self) -> None:
        self.assertEqual(extract_otp("你的 ChatGPT 验证码是 405233，10 分钟内有效。"), "405233")

    def test_extracts_english_login_code(self) -> None:
        self.assertEqual(extract_otp("Your OpenAI login code is 405233."), "405233")

    def test_ignores_plan_email_numbers_without_otp_context(self) -> None:
        self.assertEqual(
            extract_otp("ChatGPT - 你的新套餐\n订单编号 405233 已处理，感谢订阅 Plus。"),
            "",
        )

    def test_parse_message_ignores_plan_email_numbers_without_otp_context(self) -> None:
        raw = (
            "From: OpenAI <noreply@tm.openai.com>\n"
            "To: user@example.com\n"
            "Subject: ChatGPT - 你的新套餐\n"
            "Date: Wed, 27 May 2026 08:50:00 +0000\n"
            "Content-Type: text/plain; charset=utf-8\n"
            "\n"
            "订单编号 405233 已处理，感谢订阅 Plus。"
        )
        self.assertEqual(parse_message(raw).otp, "")


class OutlookClientSearchTest(unittest.TestCase):
    def test_uses_utf8_charset_for_chinese_query(self) -> None:
        client = OutlookIMAPClient(OutlookAccount("user@example.com", password="secret"))

        charset, criteria = client._build_search_args(SearchOptions(query="验证码"))

        self.assertEqual(charset, "UTF-8")
        self.assertEqual(criteria, ["ALL", "TEXT", "验证码".encode("utf-8")])

    def test_keeps_ascii_query_without_charset(self) -> None:
        client = OutlookIMAPClient(OutlookAccount("user@example.com", password="secret"))

        charset, criteria = client._build_search_args(SearchOptions(query="OpenAI"))

        self.assertIsNone(charset)
        self.assertEqual(criteria, ["ALL", "TEXT", "OpenAI"])


class OutlookExtractApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(server.app)

    def test_extract_endpoint_accepts_plain_text(self) -> None:
        response = self.client.post(
            "/api/outlook/extract",
            json={"content": "Your OpenAI login code is 405233."},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"]["otp"], "405233")

    def test_extract_endpoint_falls_back_to_digit_candidate_for_pasted_text(self) -> None:
        response = self.client.post(
            "/api/outlook/extract",
            json={"content": "临时登录数字：405233"},
        )

        self.assertEqual(response.status_code, 200)
        message = response.json()["message"]
        self.assertEqual(message["otp"], "405233")
        self.assertEqual(message["digit_candidates"], ["405233"])

    def test_extract_endpoint_accepts_mime_message(self) -> None:
        raw = (
            "From: OpenAI <noreply@tm.openai.com>\n"
            "To: user@example.com\n"
            "Subject: Your temporary ChatGPT code\n"
            "Date: Thu, 04 Jun 2026 03:39:18 +0000\n"
            "Content-Type: text/plain; charset=utf-8\n"
            "\n"
            "Your OpenAI login code is 474566."
        )

        response = self.client.post("/api/outlook/extract", json={"content": raw})

        self.assertEqual(response.status_code, 200)
        message = response.json()["message"]
        self.assertEqual(message["otp"], "474566")
        self.assertEqual(message["subject"], "Your temporary ChatGPT code")
        self.assertEqual(message["from_addr"], "OpenAI <noreply@tm.openai.com>")

    def test_extract_endpoint_fetches_mail_for_account_line(self) -> None:
        account_line = "user@example.com----secret----client-id----refresh-token"
        listing = {
            "account": {"email": "user@example.com", "has_oauth": True},
            "messages": [
                {
                    "uid": "10",
                    "mailbox": "INBOX",
                    "subject": "Welcome",
                    "from_addr": "Outlook <no-reply@microsoft.com>",
                    "to_addr": "user@example.com",
                    "date": "2026-06-04T03:40:18+00:00",
                    "received_at": 1780550052.0,
                    "preview_text": "Welcome to Outlook",
                    "otp": "",
                    "partial": True,
                },
                {
                    "uid": "9",
                    "mailbox": "INBOX",
                    "subject": "Your temporary ChatGPT code",
                    "from_addr": "ChatGPT <noreply@tm.openai.com>",
                    "to_addr": "user@example.com",
                    "date": "2026-06-04T03:39:18+00:00",
                    "received_at": 1780549992.0,
                    "preview_text": "输入此临时验证码以继续：474566",
                    "otp": "474566",
                    "partial": True,
                }
            ],
            "mailboxes": ["INBOX", "Junk"],
            "fetched_mailboxes": ["INBOX"],
            "folder_errors": {},
        }
        full = {
            "message": {
                "uid": "9",
                "mailbox": "INBOX",
                "subject": "Your temporary ChatGPT code",
                "from_addr": "ChatGPT <noreply@tm.openai.com>",
                "to_addr": "user@example.com",
                "date": "2026-06-04T03:39:18+00:00",
                "received_at": 1780549992.0,
                "text_body": "输入此临时验证码以继续：474566",
                "html_body": "",
                "raw_headers": "",
                "raw_excerpt": "",
                "body_excerpt": "",
                "otp": "474566",
                "partial": False,
            }
        }

        with patch.object(server, "fetch_outlook_messages", return_value=listing) as fetch_messages:
            with patch.object(server, "fetch_outlook_message", return_value=full) as fetch_message:
                response = self.client.post("/api/outlook/extract", json={"content": account_line})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        message = payload["message"]
        self.assertEqual(payload["source"], "account_line")
        self.assertEqual(payload["count"], 2)
        self.assertEqual(len(payload["messages"]), 2)
        self.assertEqual(message["otp"], "474566")
        self.assertEqual(message["uid"], "9")
        self.assertEqual(message["text_body"], "输入此临时验证码以继续：474566")
        self.assertNotIn("refresh-token", message["text_body"])
        fetch_messages.assert_called_once()
        fetch_message.assert_called_once()
        self.assertEqual(fetch_messages.call_args.kwargs["limit"], 10)

    def test_extract_endpoint_passes_multi_message_options(self) -> None:
        account_line = "user@example.com----secret----client-id----refresh-token"
        listing = {
            "account": {"email": "user@example.com", "has_oauth": True},
            "messages": [],
            "mailboxes": ["INBOX"],
            "fetched_mailboxes": ["INBOX"],
            "folder_errors": {},
        }

        with patch.object(server, "fetch_outlook_messages", return_value=listing) as fetch_messages:
            response = self.client.post(
                "/api/outlook/extract",
                json={
                    "content": account_line,
                    "limit": 20,
                    "mailbox": "INBOX",
                    "query": "OpenAI",
                    "unseen_only": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        kwargs = fetch_messages.call_args.kwargs
        self.assertEqual(kwargs["limit"], 20)
        self.assertEqual(kwargs["mailbox"], "INBOX")
        self.assertEqual(kwargs["query"], "OpenAI")
        self.assertTrue(kwargs["unseen_only"])

    def test_favicon_does_not_log_404(self) -> None:
        response = self.client.get("/favicon.ico")

        self.assertEqual(response.status_code, 204)


if __name__ == "__main__":
    unittest.main()

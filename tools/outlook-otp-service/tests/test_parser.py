from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()

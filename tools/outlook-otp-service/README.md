# Outlook OTP Service

独立的本地服务，用于配合 OpenAI Plus VXT 注册 tab 自动接收 Outlook 验证码和读取邮件内容。

## 运行

直接双击：

```text
outlook-otp-service.exe
```

默认监听：

```text
http://127.0.0.1:8787
```

插件注册 tab 默认会请求这个地址。

也可以在命令行指定端口：

```powershell
outlook-otp-service.exe --host 127.0.0.1 --port 8787
```

## 账号格式

在插件注册 tab 输入：

```text
email----password----client_id----refresh_token
```

服务不会保存账号，也不会内置账号文件。插件每次请求验证码时会把当前输入的账号行发给本地服务。

建议使用带 `client_id` 和 `refresh_token` 的 OAuth 账号行。Outlook 密码直连 IMAP 在很多账号上会返回 `LOGIN failed`。

## API

健康检查：

```http
GET /health
```

拉取最近邮件：

```http
POST /api/outlook/fetch
Content-Type: application/json

{
  "account_line": "email----password----client_id----refresh_token",
  "limit": 3,
  "mailbox": "default",
  "query": "验证码",
  "unseen_only": false,
  "mark_seen": false
}
```

返回数据兼容插件现有逻辑，验证码字段为：

```text
messages[].otp
```

读取完整邮件：

```http
POST /api/outlook/message
Content-Type: application/json

{
  "account_line": "email----password----client_id----refresh_token",
  "uid": "123",
  "mailbox": "INBOX"
}
```

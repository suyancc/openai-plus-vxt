# OpenAI Plus VXT

一个基于 [WXT](https://wxt.dev/) 的浏览器插件，用于辅助 ChatGPT 注册、Checkout 链接提取、随机地址资料生成，以及 OpenAI/PayPal 支付页资料自动填写。

TG 群组：[https://t.me/fuck_open](https://t.me/fuck_open)

## 下载接码软件

### [点击下载 Outlook 接码软件](https://github.com/suyancc/openai-plus-vxt/releases/download/outlook-otp-service/outlook-otp-service.zip)

注册 tab 使用 Outlook 自动收码前，需要先在本机运行接码软件。下载 zip 后解压，运行 `outlook-otp-service.exe`，默认监听 `http://127.0.0.1:8787`。

## 功能

- 注册辅助
  - 支持单邮箱输入。
  - 支持 `email----password----client_id----refresh_token` 格式的 Outlook 账号行。
  - 在 OpenAI 邮箱验证码页可手动填验证码，也可通过本地 Outlook API 自动收码并提交。
  - 在资料页自动填写英文姓名和年龄。

- 提链接
  - 切换到“提链接”tab 时读取 `https://chatgpt.com/api/auth/session`。
  - 从 session 中读取 `accessToken`、`user.email`、`account.planType`。
  - 支持生成 ChatGPT checkout 长链接和短链接。
  - Checkout 参数可在插件内调整并持久化。
  - 支持本地模式或服务器 API 模式生成链接。

- 地址资料
  - 支持从 `https://www.meiguodizhi.com/` 获取随机地址资料。
  - 支持指定国家、指定城市，或随机国家/随机城市。
  - 地址、身份、就业、信用卡等资料可在插件面板中查看和复制。
  - 当前地址资料会保存到本地，页面刷新后仍可使用。

- 支付页自动填写
  - `pay.openai.com/c/pay`：自动选择 PayPal、填写姓名、国家、地址、邮编、电话，并勾选条款。
  - `paypal.com/checkoutweb/signup`：自动填写国家、邮箱、卡资料、姓名、地址、密码，并显示“当前密码和邮箱一致”的提示。
  - 两个页面的自动填写开关在设置里独立控制，默认开启。

- 插件面板
  - 右侧浮动面板，支持收起/展开。
  - 收起状态、当前 tab、输入内容和设置会保存在本地。
  - 设置页显示当前插件版本号，支持手动检测 GitHub Release 更新。
  - 设置页提供 TG 群组入口：[https://t.me/fuck_open](https://t.me/fuck_open)。 

## 截图

### 注册辅助

![注册辅助](image/reg.png)

### 提链接

![提链接](image/link.png)

### 地址资料

![地址资料](image/address.png)

### 接码

![接码](image/sms.png)

### 设置

![设置](image/settings.png)

## 开发环境

需要安装：

- Node.js
- pnpm
- Chrome 或 Chromium

安装依赖：

```bash
pnpm install
```

启动开发模式：

```bash
pnpm dev
```

WXT 会启动浏览器并加载插件。也可以使用手动调试模式：

```bash
pnpm dev:manual
```

类型检查：

```bash
pnpm compile
```

构建：

```bash
pnpm build
```

打包：

```bash
pnpm zip
```

Firefox：

```bash
pnpm dev:firefox
pnpm build:firefox
pnpm zip:firefox
```

## Outlook 自动收码 API

注册模块支持通过本地服务读取 Outlook 验证码。默认 API 地址：

```text
http://127.0.0.1:8787
```

账号行格式：

```text
email----password----client_id----refresh_token
```

插件会每 5 秒调用本地服务的 Outlook 邮件接口等待验证码，优先按 `验证码` 关键词查询，每次最多读取最新 3 封邮件。没有本地服务时，可以使用单邮箱模式，验证码手动输入。

### Checkout 提取模式

提链接 tab 支持两种提取模式：

- `本地`：扩展 background 直接请求 ChatGPT checkout 接口。
- `服务器 API`：扩展把 accessToken 提交到服务器接口生成原始 checkout 链接。

服务器接口：

```http
POST http://64.176.60.3:8788/checkout/raw
Content-Type: application/json

{"token":"PASTE_TOKEN_HERE"}
```

本仓库提供独立的 Outlook 验证码服务打包脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-outlook-otp-service.ps1
```

打包后文件：

```text
.output/outlook-otp-service/dist/outlook-otp-service.exe
.output/outlook-otp-service/outlook-otp-service.exe
.output/outlook-otp-service/outlook-otp-service.zip
```

把 zip 解压到其他 Windows 电脑后，运行 `outlook-otp-service.exe` 即可。服务默认监听 `127.0.0.1:8787`，接口兼容插件注册 tab。

## 权限和匹配页面

## 普通窗口和无痕模式

插件已配置 `incognito: "split"`，普通窗口和无痕窗口会使用各自的扩展上下文，读取 ChatGPT session 时会匹配当前窗口的登录态。

无痕模式使用前需要手动开启权限：

1. 打开 `chrome://extensions`。
2. 找到 OpenAI Plus VXT。
3. 打开“详情”。
4. 开启“允许在无痕模式下运行”。

普通窗口和无痕窗口的插件输入、当前 tab、接码历史、地址设置会分开保存，避免互相覆盖。

插件会注入以下页面：

- `https://chatgpt.com/*`
- `https://auth.openai.com/*`
- `https://pay.openai.com/*`
- `https://www.paypal.com/*`
- `https://paypal.com/*`

插件请求的 host permissions 包含：

- 本地 Outlook API：`127.0.0.1:8787`、`localhost:8787`
- Checkout 服务器 API：`64.176.60.3:8788`
- ChatGPT / OpenAI Auth / OpenAI Pay
- PayPal
- meiguodizhi 地址资料站点
- GitHub Releases API：用于版本更新检查

## 发布版本

后续如果上传到 GitHub，建议使用 GitHub Releases 发布版本：

1. 修改 `package.json` 中的 `version`。
2. 执行：

```bash
pnpm compile
pnpm build
pnpm zip
```

3. 在 GitHub Releases 中创建 `vX.Y.Z` 版本。
4. 上传 `.output` 中生成的 zip 文件。
5. 在 Release notes 写更新说明。

插件会通过 GitHub Releases API 检测最新正式版。如果最新版本高于当前插件版本，会在插件顶部显示更新提示、下载地址和更新说明。设置页也提供“检测更新”按钮，可手动强制刷新版本检查。

## 项目结构

```text
entrypoints/
  background.ts          后台消息处理、Outlook 收码、checkout 创建
  content.ts             内容脚本入口，挂载右侧插件面板和自动填写模块
src/
  app/                   面板主框架、状态、样式
  features/
    register/            注册辅助
    link-extractor/      Checkout 链接提取
    address-autofill/    地址资料和支付页自动填写
    version-check/       GitHub Release 版本检查和更新提示
    sms/                 接码链接轮询和验证码历史
    settings/            设置页和持久化设置
scripts/                 本地调试脚本
wxt.config.ts            WXT 和扩展 manifest 配置
```

## 注意

本项目用于浏览器插件开发和流程辅助。支付页、第三方站点和 API 结构可能随时变化，自动填写选择器需要根据实际页面保持维护。

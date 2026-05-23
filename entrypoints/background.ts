import { fetchRandomAddress } from '../src/features/address-autofill/address-source';
import type { RandomAddressMessage } from '../src/features/address-autofill/types';
import { createCheckoutLink } from '../src/features/link-extractor/checkout';
import { fetchChatGptSession } from '../src/features/link-extractor/session';
import type { ChatGptSessionMessage, ChatGptSessionResponse, CheckoutLinkMessage } from '../src/features/link-extractor/types';
import type { OutlookOtpMessage, OutlookOtpResponse } from '../src/features/register/types';
import type { SmsRelayFetchMessage, SmsRelayFetchResponse } from '../src/features/sms/types';

type MessageSenderLike = {
  tab?: {
    id?: number;
  };
};

const DEFAULT_OUTLOOK_API_BASE = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 5_000;
const ASSISTANT_SCRIPT_FILE = '/content-scripts/content.js';
const ASSISTANT_URL_PREFIXES = [
  'https://chatgpt.com/',
  'https://auth.openai.com/',
  'https://pay.openai.com/',
  'https://www.paypal.com/',
  'https://paypal.com/',
];

export default defineBackground(() => {
  installAssistantInjector();

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isOutlookOtpMessage(message)) {
      if (isCheckoutLinkMessage(message)) {
        createCheckoutLink(message.raw, message.options).then(sendResponse).catch((e) => {
          sendResponse({ ok: false, message: String(e) });
        });
        return true; // keep message channel open for async response
      }
      if (isChatGptSessionMessage(message)) {
        fetchChatGptSessionForSender(sender).then(sendResponse).catch((e) => {
          sendResponse({ ok: false, message: String(e) });
        });
        return true;
      }
      if (isRandomAddressMessage(message)) {
        fetchRandomAddress(message.countryCode, message.city).then(sendResponse).catch((e) => {
          sendResponse({ ok: false, message: String(e) });
        });
        return true;
      }
      if (isSmsRelayFetchMessage(message)) {
        fetchSmsRelay(message.url).then(sendResponse).catch((e) => {
          sendResponse({ ok: false, message: String(e) });
        });
        return true;
      }
      return undefined;
    }

    waitForOutlookOtp(message).then(sendResponse).catch((e) => {
      sendResponse({ ok: false, message: String(e) });
    });
    return true; // keep message channel open for async response
  });
});

async function fetchChatGptSessionForSender(sender: MessageSenderLike): Promise<ChatGptSessionResponse> {
  // Always use background fetch directly — more reliable than scripting.executeScript
  // which has serialization issues with async results in MV3
  const tabId = sender.tab?.id;

  // First try background fetch (works when chatgpt.com cookies are accessible)
  const bgResult = await fetchChatGptSession();
  if (bgResult.ok && bgResult.session?.accessToken) {
    return bgResult;
  }

  // If background fetch didn't get a token, try injecting into the tab
  if (typeof tabId === 'number') {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: fetchChatGptSessionInTab,
      });
      const response = results[0]?.result;
      if (isChatGptSessionResponse(response)) {
        return response;
      }
    } catch (error) {
      console.debug('[OPX] tab injection for session failed', error);
    }
  }

  // Return the background result (may contain partial info or error message)
  return bgResult;
}

async function fetchChatGptSessionInTab(): Promise<ChatGptSessionResponse> {
  const sessionUrl = 'https://chatgpt.com/api/auth/session';
  try {
    const response = await fetch(sessionUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
    });

    const text = await response.text();

    if (!response.ok) {
      const msg = text ? text.replace(/\s+/g, ' ').slice(0, 200) : response.statusText;
      return { ok: false, message: `ChatGPT session HTTP ${response.status}：${msg}` };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, message: 'ChatGPT session 响应不是有效 JSON' };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, message: 'ChatGPT session 响应不是 JSON 对象' };
    }

    const record = data as Record<string, unknown>;
    const user = (record.user && typeof record.user === 'object') ? record.user as Record<string, unknown> : {};
    const account = (record.account && typeof record.account === 'object') ? record.account as Record<string, unknown> : {};

    const email = typeof user.email === 'string' ? user.email.trim() : '';
    const planType = typeof account.planType === 'string' ? account.planType.trim()
      : typeof account.plan_type === 'string' ? (account.plan_type as string).trim() : '';
    const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : '';

    const session = { email, planType, accessToken, fetchedAt: Date.now(), raw: record };

    if (!accessToken) {
      return {
        ok: false,
        message: email ? '已读取账号信息，但 session 内没有 accessToken' : '未读取到登录 session',
        session,
      };
    }

    return {
      ok: true,
      message: '已从当前标签页读取 ChatGPT session',
      session,
    };
  } catch (error) {
    return { ok: false, message: `无法请求 ChatGPT session：${String(error)}` };
  }
}

function installAssistantInjector(): void {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !isAssistantUrl(tab.url)) {
      return;
    }
    setTimeout(() => void injectAssistant(tabId), 300);
  });

  void browser.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (typeof tab.id === 'number' && isAssistantUrl(tab.url)) {
        void injectAssistant(tab.id);
      }
    }
  }).catch((error) => {
    console.debug('[OPX] initial assistant injection skipped', error);
  });
}

async function injectAssistant(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [ASSISTANT_SCRIPT_FILE],
    });
  } catch (error) {
    console.debug('[OPX] assistant injection skipped', { tabId, error });
  }
}

function isAssistantUrl(url: string | undefined): boolean {
  return ASSISTANT_URL_PREFIXES.some((prefix) => url?.startsWith(prefix));
}

async function waitForOutlookOtp(message: OutlookOtpMessage): Promise<OutlookOtpResponse> {
  const startedAt = message.since ?? Date.now();
  const deadline = Date.now() + (message.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const intervalMs = message.intervalMs ?? DEFAULT_INTERVAL_MS;
  const apiBase = normalizeApiBase(message.apiBase || DEFAULT_OUTLOOK_API_BASE);

  while (Date.now() <= deadline) {
    const result = await fetchLatestOtp(apiBase, message.accountLine, startedAt);
    if (result.ok && result.code) {
      return result;
    }
    if (!result.ok && result.fatal) {
      return result;
    }
    await delay(intervalMs);
  }

  return {
    ok: false,
    message: '等待 Outlook 验证码超时',
  };
}

async function fetchLatestOtp(
  apiBase: string,
  accountLine: string,
  startedAt: number,
): Promise<OutlookOtpResponse & { fatal?: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/outlook/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_line: accountLine,
        limit: 10,
        mailbox: 'default',
        query: 'OpenAI',
        unseen_only: false,
        mark_seen: false,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      fatal: true,
      message: `无法连接 Outlook 本地 API：${String(error)}`,
    };
  }

  if (!response.ok) {
    const detail = await readResponseDetail(response);
    return {
      ok: false,
      fatal: true,
      message: `Outlook API 返回 ${response.status}：${detail}`,
    };
  }

  const payload = await response.json() as OutlookFetchPayload;
  const startedAtSeconds = startedAt / 1000;
  const messages = [...(payload.messages || [])].sort(
    (a, b) => Number(b.received_at || 0) - Number(a.received_at || 0),
  );

  const fresh = messages.find((item) => {
    if (!item.otp) {
      return false;
    }
    const receivedAt = Number(item.received_at || 0);
    return !receivedAt || receivedAt >= startedAtSeconds - 15;
  });

  if (!fresh?.otp) {
    return {
      ok: false,
      message: '暂未收到新的 Outlook 验证码',
    };
  }

  return {
    ok: true,
    code: fresh.otp,
    message: `收到验证码：${fresh.otp}`,
  };
}

function isOutlookOtpMessage(message: unknown): message is OutlookOtpMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as OutlookOtpMessage).type === 'opx:wait-outlook-otp' &&
      typeof (message as OutlookOtpMessage).accountLine === 'string',
  );
}

function isCheckoutLinkMessage(message: unknown): message is CheckoutLinkMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as CheckoutLinkMessage).type === 'opx:create-checkout-link' &&
      typeof (message as CheckoutLinkMessage).raw === 'string' &&
      typeof (message as CheckoutLinkMessage).options === 'object',
  );
}

function isChatGptSessionMessage(message: unknown): message is ChatGptSessionMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as ChatGptSessionMessage).type === 'opx:fetch-chatgpt-session',
  );
}

function isChatGptSessionResponse(value: unknown): value is ChatGptSessionResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ChatGptSessionResponse).ok === 'boolean' &&
      typeof (value as ChatGptSessionResponse).message === 'string',
  );
}

function isRandomAddressMessage(message: unknown): message is RandomAddressMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (
        (message as RandomAddressMessage).type === 'opx:fetch-random-address' ||
        (message as RandomAddressMessage).type === 'opx:fetch-random-us-address'
      ),
  );
}

function isSmsRelayFetchMessage(message: unknown): message is SmsRelayFetchMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as SmsRelayFetchMessage).type === 'opx:fetch-sms-relay' &&
      typeof (message as SmsRelayFetchMessage).url === 'string',
  );
}

async function fetchSmsRelay(url: string): Promise<SmsRelayFetchResponse> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        ok: false,
        message: '接码 API 只支持 http/https 链接',
      };
    }
  } catch {
    return {
      ok: false,
      message: '接码 API 链接格式无效',
    };
  }

  let response: Response;
  try {
    response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
    });
  } catch (error) {
    return {
      ok: false,
      message: `接码 API 请求失败：${String(error)}`,
    };
  }

  const status = response.status;
  const { parsed: detail, text } = await readSmsRelayResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      status,
      message: `接码 API 返回 ${status}：${text || response.statusText}`,
      text,
      raw: detail,
    };
  }

  if (isRecord(detail)) {
    const data = String(detail.data || '').trim();
    const message = String(detail.msg || detail.message || 'OK');
    return {
      ok: isSmsRelaySuccessPayload(detail),
      status,
      message,
      data,
      text,
      raw: detail,
    };
  }

  return {
    ok: true,
    status,
    message: 'OK',
    data: String(detail || '').trim(),
    text,
    raw: detail,
  };
}

async function readSmsRelayResponse(response: Response): Promise<{ parsed: unknown; text: string }> {
  const text = await response.text();
  if (!text) {
    return { parsed: '', text: '' };
  }
  try {
    return { parsed: JSON.parse(text), text };
  } catch {
    return { parsed: text, text };
  }
}

function normalizeApiBase(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readResponseDetail(response: Response): Promise<string> {
  try {
    const data = await response.json() as { detail?: string };
    return data.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isSmsRelaySuccessPayload(value: Record<string, unknown>): boolean {
  if (typeof value.success === 'boolean') {
    return value.success;
  }
  if (typeof value.ok === 'boolean') {
    return value.ok;
  }

  const codeValue = value.code ?? value.status ?? value.statusCode;
  if (codeValue === undefined || codeValue === null || codeValue === '') {
    return true;
  }

  const code = Number(codeValue);
  if (Number.isNaN(code)) {
    return true;
  }
  return code === 0 || code === 1 || code === 200;
}

interface OutlookFetchPayload {
  messages?: Array<{
    otp?: string;
    received_at?: number;
  }>;
}

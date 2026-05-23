/**
 * Direct session fetch — runs in the content script context (page origin).
 * This bypasses background service worker entirely, avoiding cookie isolation
 * issues in fingerprint browsers where the extension's background cannot
 * access chatgpt.com cookies.
 */
import type { ChatGptSessionInfo, ChatGptSessionResponse } from './types';

const SESSION_URL = 'https://chatgpt.com/api/auth/session';

export async function fetchChatGptSessionDirect(): Promise<ChatGptSessionResponse> {
  let response: Response;
  try {
    response = await fetch(SESSION_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (error) {
    return { ok: false, message: `无法请求 ChatGPT session：${String(error)}` };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { ok: false, message: `读取响应失败：${String(error)}` };
  }

  if (!response.ok) {
    const msg = (text || response.statusText).replace(/\s+/g, ' ').slice(0, 200);
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
  const user = isRecord(record.user) ? record.user : {};
  const account = isRecord(record.account) ? record.account : {};

  const email = stringValue(user.email);
  const planType = stringValue(account.planType) || stringValue(account.plan_type);
  const accessToken = stringValue(record.accessToken);

  const session: ChatGptSessionInfo = {
    email,
    planType,
    accessToken,
    fetchedAt: Date.now(),
    raw: record,
  };

  if (!accessToken) {
    return {
      ok: false,
      message: email ? '已读取账号信息，但 session 内没有 accessToken' : '未读取到登录 session',
      session,
    };
  }

  return {
    ok: true,
    message: '已从当前页面直接读取 ChatGPT session',
    session,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

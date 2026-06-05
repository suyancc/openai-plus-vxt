import { extractSmsPayload } from '../sms/parser';
import { loadOAuthPhoneSettings } from '../oauth-phone/state';
import type { AutomationSmsTarget } from './types';

const FOX_SMS_API_BASE_URL = 'https://foxsms.cc/api/v1';
const FOX_SMS_COUNTRY_CODE_JAPAN = 'jpn';
const FOX_SMS_PAYPAL_PROJECT_ID = '35';

export interface FoxSmsSpecifiedNumber {
  activationId: string;
  phone: string;
  countryCode: string;
  projectId: string;
  message: string;
  raw: unknown;
}

export type FoxSmsCodeResult =
  | {
      kind: 'code';
      code: string;
      message: string;
      raw: unknown;
    }
  | {
      kind: 'empty';
      message: string;
      raw: unknown;
    }
  | {
      kind: 'error';
      message: string;
      raw?: unknown;
    };

export async function requestFoxSmsSpecifiedNumber(target: AutomationSmsTarget): Promise<FoxSmsSpecifiedNumber> {
  const token = await loadFoxSmsApiToken();
  const phone = normalizePhone(target.phone);
  if (!phone) {
    throw new Error('Fox SMS 指定号码为空');
  }
  const countryCode = target.countryCode || FOX_SMS_COUNTRY_CODE_JAPAN;
  const projectId = target.projectId || FOX_SMS_PAYPAL_PROJECT_ID;
  const data = await requestFoxSmsApi('getPhoneByPhone', {
    token,
    countryCode,
    projectId,
    phone,
  });
  if (!isSuccessfulFoxSmsResponse(data)) {
    throw new Error(normalizeFoxSmsError(data));
  }
  const activationId = String(readFirstFoxSms(data, ['logId', 'id', 'activationId']) || '').trim();
  const responsePhone = normalizePhone(String(readFirstFoxSms(data, ['phoneNumber', 'phone', 'number']) || phone));
  if (!activationId) {
    throw new Error(`Fox SMS 指定号码返回缺少 logId：${stringifyResponse(data)}`);
  }
  return {
    activationId,
    phone: responsePhone || phone,
    countryCode: String(readFirstFoxSms(data, ['countryCode']) || countryCode),
    projectId: String(readFirstFoxSms(data, ['projectId']) || projectId),
    message: foxSmsOrderMessage(data, activationId),
    raw: data,
  };
}

export async function fetchFoxSmsCode(target: AutomationSmsTarget): Promise<FoxSmsCodeResult> {
  const activationId = String(target.activationId || '').trim();
  if (!activationId) {
    return {
      kind: 'error',
      message: 'Fox SMS 尚未申请号码，缺少 logId',
    };
  }

  try {
    const token = await loadFoxSmsApiToken();
    const data = await requestFoxSmsApi('getSms', {
      token,
      logId: activationId,
    });
    if (!isSuccessfulFoxSmsResponse(data) && !isWaitingFoxSmsResponse(data)) {
      return {
        kind: 'error',
        message: normalizeFoxSmsError(data),
        raw: data,
      };
    }
    const extracted = extractFoxSmsPayload(data);
    if (extracted.code) {
      return {
        kind: 'code',
        code: extracted.code,
        message: extracted.message || extracted.code,
        raw: data,
      };
    }
    if (isWaitingFoxSmsResponse(data) || isSuccessfulFoxSmsResponse(data)) {
      return {
        kind: 'empty',
        message: normalizeFoxSmsError(data) || '等待 Fox SMS 短信',
        raw: data,
      };
    }
    return {
      kind: 'error',
      message: normalizeFoxSmsError(data),
      raw: data,
    };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isFoxSmsTarget(target: AutomationSmsTarget): boolean {
  return target.source === 'foxsms';
}

async function loadFoxSmsApiToken(): Promise<string> {
  const settings = await loadOAuthPhoneSettings();
  const provider = settings.providers.find((item) => item.id === 'foxsms');
  if (!provider?.apiKey.trim()) {
    throw new Error('请先在 OAuth 手机接码的 Fox SMS 平台配置中填写 token 或 username----password');
  }
  const credentials = parseFoxSmsCredentials(provider.apiKey);
  if (credentials.token) {
    return credentials.token;
  }
  if (!credentials.username || !credentials.password) {
    throw new Error('Fox SMS API key 请填写 jmapi token 或 username----password');
  }
  const data = await requestFoxSmsApi('login', {
    username: credentials.username,
    password: credentials.password,
  });
  if (!isSuccessfulFoxSmsResponse(data)) {
    throw new Error(normalizeFoxSmsError(data));
  }
  const token = String(readFirstFoxSms(data, ['token', 'apiToken']) || '').trim();
  if (!token) {
    throw new Error('Fox SMS 登录成功但没有返回 API token');
  }
  return token;
}

async function requestFoxSmsApi(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(`${FOX_SMS_API_BASE_URL}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
  });
  const text = (await response.text()).trim();
  const data = parseJson(text);
  if (response.ok) {
    return data ?? text;
  }
  throw new Error(normalizeFoxSmsError((data ?? text) || response.statusText));
}

function parseFoxSmsCredentials(value: string): { token: string; username: string; password: string } {
  const raw = String(value || '').trim();
  if (!raw) {
    return { token: '', username: '', password: '' };
  }
  if (/^token\s*:/i.test(raw)) {
    return { token: raw.replace(/^token\s*:/i, '').trim(), username: '', password: '' };
  }
  if (/^jmapi_/i.test(raw)) {
    return { token: raw, username: '', password: '' };
  }
  const dashParts = raw.split('----').map((item) => item.trim());
  if (dashParts.length >= 2 && dashParts[0] && dashParts[1]) {
    return { token: '', username: dashParts[0], password: dashParts.slice(1).join('----') };
  }
  const colonIndex = raw.indexOf(':');
  if (colonIndex > 0) {
    return {
      token: '',
      username: raw.slice(0, colonIndex).trim(),
      password: raw.slice(colonIndex + 1).trim(),
    };
  }
  return { token: raw, username: '', password: '' };
}

function isSuccessfulFoxSmsResponse(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const success = value.success;
  if (success === true || success === 1 || success === '1' || success === 'true') {
    return true;
  }
  const code = Number(readFirst(value, ['code']) ?? NaN);
  if (Number.isFinite(code) && (code === 0 || code === 200)) {
    return true;
  }
  return Boolean(readFirstFoxSms(value, ['token', 'balance', 'phoneNumber', 'smsCode', 'logId']));
}

function isWaitingFoxSmsResponse(value: unknown): boolean {
  const message = normalizeFoxSmsError(value).toLowerCase();
  return message.includes('wait') ||
    message.includes('waiting') ||
    message.includes('pending') ||
    message.includes('not received') ||
    message.includes('no sms') ||
    message.includes('retry') ||
    message.includes('未收到') ||
    message.includes('等待') ||
    message.includes('暂无');
}

function normalizeFoxSmsError(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim() || 'Fox SMS 返回空响应';
  }
  if (!isRecord(value)) {
    return 'Fox SMS 返回未知响应';
  }
  const direct = String(readFirstFoxSms(value, [
    'message',
    'msg',
    'error',
    'errorMessage',
    'status',
    'statusText',
    'detail',
  ]) || '').trim();
  const retryAfterMs = Number(readFirstFoxSms(value, ['retryAfterMs']) || 0);
  if (retryAfterMs > 0 && !direct) {
    return `等待短信，${retryAfterMs}ms 后重试`;
  }
  return direct || 'Fox SMS 请求失败';
}

function extractFoxSmsPayload(value: unknown): { code: string; message: string } {
  const extracted = extractSmsPayload(value);
  if (extracted.code) {
    return extracted;
  }
  if (isRecord(value)) {
    const code = String(readFirstFoxSms(value, ['smsCode', 'code', 'otp', 'pin']) || '').trim();
    const message = String(readFirstFoxSms(value, ['fullSms', 'message', 'smsText', 'text', 'body']) || '').trim();
    const codeFromMessage = extractDigitsCode(message);
    if (code || codeFromMessage) {
      return {
        code: code || codeFromMessage,
        message: message || code || codeFromMessage,
      };
    }
    return {
      code: '',
      message: message || normalizeFoxSmsError(value),
    };
  }
  const text = typeof value === 'string' ? value : stringifyResponse(value);
  return {
    code: extractDigitsCode(text),
    message: text,
  };
}

function foxSmsOrderMessage(data: unknown, activationId: string): string {
  const billingAmount = String(readFirstFoxSms(data, ['billingAmount', 'amount', 'price', 'cost']) || '').trim();
  const billingText = billingAmount ? `，费用 ${billingAmount}` : '';
  return `Fox SMS 已申请指定号码，logId=${activationId}${billingText}`;
}

function foxSmsPayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const data = value.data;
  if (data !== undefined && data !== null && data !== '') {
    return data;
  }
  const result = value.result;
  if (result !== undefined && result !== null && result !== '') {
    return result;
  }
  return value;
}

function readFirstFoxSms(value: unknown, keys: string[]): unknown {
  const payload = foxSmsPayload(value);
  const direct = readFirst(payload, keys);
  if (direct !== undefined) {
    return direct;
  }
  return readFirst(value, keys);
}

function readFirst(value: unknown, keys: string[]): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const normalized = new Map(Object.entries(value).map(([key, child]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), child]));
  for (const key of keys) {
    const found = normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (found !== undefined && found !== null && found !== '') {
      return found;
    }
  }
  return undefined;
}

function extractDigitsCode(value: string): string {
  const match = String(value || '').match(/\b\d{4,8}\b/);
  return match?.[0] || '';
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function parseJson(value: string): unknown | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringifyResponse(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

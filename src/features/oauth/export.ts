import type { ChatGptSessionInfo } from '../link-extractor/types';
import { expiresInSeconds, extractAccountId, extractEmail, extractExpiryIso, extractJwtPayload, extractUserId } from './oauth';
import type { OAuthCredentials } from './types';

export function createCpaJson(credentials: OAuthCredentials, _password = ''): string {
  const email = credentials.email || extractEmail(credentials.access_token);
  const accountId = credentials.account_id || extractAccountId(credentials.access_token);
  const chatgptUserId = credentials.chatgpt_user_id || extractUserId(credentials.access_token);
  const planType = normalizePlanType(credentials.plan_type);
  return stringifyJson({
    type: 'codex',
    account_id: accountId,
    chatgpt_account_id: accountId,
    email,
    name: email,
    plan_type: planType,
    chatgpt_plan_type: planType,
    id_token: credentials.id_token,
    ...(credentials.id_token_synthetic ? { id_token_synthetic: true } : {}),
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token || '',
    session_token: credentials.session_token || '',
    last_refresh: credentials.last_refresh || new Date().toISOString(),
    expired: credentials.expired || extractExpiryIso(credentials.access_token),
    ...(chatgptUserId ? { chatgpt_user_id: chatgptUserId } : {}),
  });
}

export function createSub2ApiJson(credentials: OAuthCredentials): string {
  const expiresAt = extractExpiryIso(credentials.access_token);
  const email = credentials.email || extractEmail(credentials.access_token);
  const accountId = credentials.account_id || extractAccountId(credentials.access_token);
  const chatgptUserId = credentials.chatgpt_user_id || extractUserId(credentials.access_token);
  const planType = normalizePlanType(credentials.plan_type);
  const exportedAt = new Date().toISOString();
  const accountCredentials = {
    ...stripEmpty({
      access_token: credentials.access_token,
      chatgpt_account_id: accountId,
      chatgpt_user_id: chatgptUserId,
      email,
      expires_at: expiresAt,
      expires_in: expiresInSeconds(expiresAt),
      plan_type: planType,
    }),
    refresh_token: credentials.refresh_token || '',
    id_token: credentials.id_token || '',
  };
  const account = {
    name: email || 'ChatGPT Account',
    platform: 'openai',
    type: 'oauth',
    concurrency: 10,
    priority: 1,
    credentials: accountCredentials,
    extra: stripEmpty({
      email,
      email_key: emailKey(email),
      name: email || 'ChatGPT Account',
      auth_provider: 'oauth',
      source: credentials.source || 'openai-plus-vxt-oauth',
      last_refresh: credentials.last_refresh || exportedAt,
    }),
  };

  return stringifyJson({
    exported_at: exportedAt,
    proxies: [],
    accounts: [account],
  });
}

export function createCredentialsFromChatGptSession(
  session: ChatGptSessionInfo,
  fallbackEmail: string,
): OAuthCredentials {
  const accessToken = session.accessToken.trim();
  const payload = extractJwtPayload(accessToken);
  const exp = Number(payload.exp || 0);
  const expiresAt = session.expiresAt || extractExpiryIso(accessToken);
  const accountId = session.accountId || extractAccountId(accessToken);
  const chatgptUserId = session.userId || extractUserId(accessToken);
  const email = session.email || fallbackEmail || extractEmail(accessToken);
  const planType = normalizePlanType(session.planType || authPayloadValue(accessToken, 'chatgpt_plan_type'));

  return {
    access_token: accessToken,
    account_id: accountId,
    chatgpt_user_id: chatgptUserId,
    disabled: false,
    email,
    expired: expiresAt,
    id_token: createSyntheticIdToken({
      accountId,
      chatgptUserId,
      email,
      exp: exp || secondsFromIso(expiresAt) || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      planType,
    }),
    id_token_synthetic: true,
    last_refresh: new Date(session.fetchedAt || Date.now()).toISOString(),
    plan_type: planType,
    refresh_token: '',
    session_token: session.sessionToken || '',
    source: 'chatgpt_web_session',
    type: 'codex',
  };
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stripEmpty<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  ) as Partial<T>;
}

function emailKey(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizePlanType(value: string | undefined): string {
  const planType = String(value || '').trim().toLowerCase();
  return !planType || planType === 'free' ? 'plus' : planType;
}

function authPayloadValue(accessToken: string, key: string): string {
  const payload = extractJwtPayload(accessToken);
  const auth = payload['https://api.openai.com/auth'];
  if (!auth || typeof auth !== 'object') {
    return '';
  }
  return String((auth as Record<string, unknown>)[key] || '');
}

function createSyntheticIdToken(input: {
  accountId: string;
  chatgptUserId: string;
  email: string;
  exp: number;
  planType: string;
}): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'none',
    typ: 'JWT',
    cpa_synthetic: true,
  };
  const payload = {
    iat,
    exp: input.exp,
    'https://api.openai.com/auth': stripEmpty({
      chatgpt_account_id: input.accountId,
      chatgpt_plan_type: input.planType,
      chatgpt_user_id: input.chatgptUserId,
      user_id: input.chatgptUserId,
    }),
    email: input.email,
  };
  return `${base64UrlJson(header)}.${base64UrlJson(payload)}.synthetic`;
}

function base64UrlJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function secondsFromIso(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

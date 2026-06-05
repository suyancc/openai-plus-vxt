import type { OAuthCredentials, OAuthState } from './types';

export const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
export const OPENAI_OAUTH_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
export const OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OPENAI_OAUTH_SCOPE = 'openid email profile offline_access';
const OAUTH_TOKEN_FETCH_ATTEMPTS = 3;
const OAUTH_TOKEN_FETCH_RETRY_DELAY_MS = 1_200;

export interface OAuthSession {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  redirectUri: string;
  authUrl: string;
}

export interface OAuthCallback {
  code: string;
  state: string;
  error: string;
  errorDescription: string;
  rawUrl: string;
  codeParam: string;
}

export interface OAuthTokenExchangeDiagnostics {
  status: number;
  statusText: string;
  tokenUrl: string;
  request: {
    clientId: string;
    redirectUri: string;
    grantType: string;
    hasCode: boolean;
    codeLength: number;
    hasCodeVerifier: boolean;
    codeVerifierLength: number;
  };
  response: {
    contentType: string;
    error: string;
    errorDescription: string;
    keys: string[];
    bodyPreview: string;
  };
}

export class OAuthTokenExchangeError extends Error {
  diagnostics: OAuthTokenExchangeDiagnostics;

  constructor(message: string, diagnostics: OAuthTokenExchangeDiagnostics) {
    super(message);
    this.name = 'OAuthTokenExchangeError';
    this.diagnostics = diagnostics;
  }
}

export async function createOAuthSession(): Promise<OAuthSession> {
  const codeVerifier = randomUrlSafe(32);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = randomUrlSafe(16);
  const authUrl = buildOAuthUrl(codeChallenge, state);
  return {
    codeVerifier,
    codeChallenge,
    state,
    redirectUri: OPENAI_OAUTH_REDIRECT_URI,
    authUrl,
  };
}

export function buildOAuthUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
    prompt: 'login',
    redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OPENAI_OAUTH_SCOPE,
    state,
  });
  return `${OPENAI_OAUTH_AUTH_URL}?${params.toString()}`;
}

export function parseOAuthCallbackUrl(callbackUrl: string): OAuthCallback {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  const errorDescription = url.searchParams.get('error_description') || '';
  return {
    code,
    state,
    error,
    errorDescription,
    rawUrl: callbackUrl,
    codeParam: new URLSearchParams({ code, state }).toString(),
  };
}

export async function exchangeOAuthCode(code: string, session: Pick<OAuthState, 'codeVerifier' | 'redirectUri' | 'email'>): Promise<OAuthCredentials> {
  const normalizedCode = code.trim();
  const codeVerifier = session.codeVerifier.trim();
  if (!normalizedCode) {
    throw new Error('OAuth code 为空');
  }
  if (!codeVerifier) {
    throw new Error('缺少 OAuth code_verifier');
  }
  const redirectUri = session.redirectUri || OPENAI_OAUTH_REDIRECT_URI;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: normalizedCode,
    redirect_uri: redirectUri,
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const bodyText = body.toString();
  let response: Response;
  try {
    response = await fetchOAuthTokenWithRetry(bodyText);
  } catch (error) {
    throw new OAuthTokenExchangeError(`OAuth token 请求失败：${String(error)}`, createTokenExchangeDiagnostics({
      status: 0,
      statusText: 'fetch-error',
      contentType: '',
      text: String(error),
      payload: {},
      code: normalizedCode,
      codeVerifier,
      redirectUri,
    }));
  }
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const parsedPayload = parseJsonObject(text);
  if (!response.ok) {
    const errorMessage = tokenErrorMessage(parsedPayload, text);
    throw new OAuthTokenExchangeError(
      `OAuth token HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}：${errorMessage}`,
      createTokenExchangeDiagnostics({
        status: response.status,
        statusText: response.statusText,
        contentType,
        text,
        payload: parsedPayload,
        code: normalizedCode,
        codeVerifier,
        redirectUri,
      }),
    );
  }

  let payload: Record<string, unknown>;
  if (parsedPayload) {
    payload = parsedPayload;
  } else {
    throw new OAuthTokenExchangeError(`OAuth token 返回不是 JSON：${shorten(text)}`, createTokenExchangeDiagnostics({
      status: response.status,
      statusText: response.statusText,
      contentType,
      text,
      payload: {},
      code: normalizedCode,
      codeVerifier,
      redirectUri,
    }));
  }

  const accessToken = String(payload.access_token || '').trim();
  if (!accessToken) {
    throw new OAuthTokenExchangeError('OAuth token 返回缺少 access_token', createTokenExchangeDiagnostics({
      status: response.status,
      statusText: response.statusText,
      contentType,
      text,
      payload,
      code: normalizedCode,
      codeVerifier,
      redirectUri,
    }));
  }

  const now = Date.now();
  const expiresIn = Number(payload.expires_in || 0);
  return {
    access_token: accessToken,
    account_id: extractAccountId(accessToken),
    disabled: false,
    email: session.email || extractEmail(accessToken),
    expired: formatPlus8(now + Math.max(0, expiresIn) * 1000),
    id_token: String(payload.id_token || ''),
    last_refresh: formatPlus8(now),
    refresh_token: String(payload.refresh_token || ''),
    type: 'codex',
  };
}

async function fetchOAuthTokenWithRetry(bodyText: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= OAUTH_TOKEN_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(OPENAI_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyText,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= OAUTH_TOKEN_FETCH_ATTEMPTS) {
        break;
      }
      await sleep(OAUTH_TOKEN_FETCH_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError || new Error('OAuth token fetch failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] || '';
  if (!part) {
    return {};
  }
  try {
    const raw = base64UrlDecode(part);
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function extractAccountId(accessToken: string): string {
  const payload = extractJwtPayload(accessToken);
  const auth = payload['https://api.openai.com/auth'];
  if (!auth || typeof auth !== 'object') {
    return '';
  }
  return String((auth as Record<string, unknown>).chatgpt_account_id || '');
}

export function extractUserId(accessToken: string): string {
  const payload = extractJwtPayload(accessToken);
  const auth = payload['https://api.openai.com/auth'];
  if (!auth || typeof auth !== 'object') {
    return '';
  }
  const source = auth as Record<string, unknown>;
  return String(source.chatgpt_account_user_id || source.chatgpt_user_id || source.user_id || '');
}

export function extractEmail(accessToken: string): string {
  const payload = extractJwtPayload(accessToken);
  const profile = payload['https://api.openai.com/profile'];
  if (profile && typeof profile === 'object') {
    const email = String((profile as Record<string, unknown>).email || '');
    if (email) {
      return email;
    }
  }
  return String(payload.email || '');
}

export function extractExpiryIso(accessToken: string): string {
  const payload = extractJwtPayload(accessToken);
  const exp = Number(payload.exp || 0);
  return exp ? new Date(exp * 1000).toISOString() : '';
}

export function expiresInSeconds(expiresAt: string): number {
  const target = Date.parse(expiresAt);
  if (!Number.isFinite(target)) {
    return 0;
  }
  return Math.max(0, Math.floor((target - Date.now()) / 1000));
}

function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function formatPlus8(timestampMs: number): string {
  const date = new Date(timestampMs + 8 * 60 * 60 * 1000);
  return `${date.toISOString().replace(/\.\d{3}Z$/, '')}+08:00`;
}

function shorten(text: string, limit = 600): string {
  return redactTokenText(text).replace(/\r?\n/g, ' ').slice(0, limit);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function tokenErrorMessage(payload: Record<string, unknown> | null, text: string): string {
  if (payload) {
    const error = normalizeTokenErrorField(payload.error);
    const description = normalizeTokenErrorField(payload.error_description || payload.message || payload.detail);
    const detail = [error, description].filter(Boolean).join(' - ');
    if (detail) {
      return detail;
    }
  }
  return shorten(text);
}

function normalizeTokenErrorField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return shorten(JSON.stringify(value), 300);
  } catch {
    return String(value);
  }
}

function createTokenExchangeDiagnostics(input: {
  status: number;
  statusText: string;
  contentType: string;
  text: string;
  payload: Record<string, unknown> | null;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): OAuthTokenExchangeDiagnostics {
  const payload = input.payload || {};
  return {
    status: input.status,
    statusText: input.statusText,
    tokenUrl: OPENAI_OAUTH_TOKEN_URL,
    request: {
      clientId: OPENAI_OAUTH_CLIENT_ID,
      redirectUri: input.redirectUri,
      grantType: 'authorization_code',
      hasCode: Boolean(input.code),
      codeLength: input.code.length,
      hasCodeVerifier: Boolean(input.codeVerifier),
      codeVerifierLength: input.codeVerifier.length,
    },
    response: {
      contentType: input.contentType,
      error: normalizeTokenErrorField(payload.error),
      errorDescription: normalizeTokenErrorField(payload.error_description || payload.message || payload.detail),
      keys: Object.keys(payload).slice(0, 20),
      bodyPreview: shorten(input.text, 500),
    },
  };
}

function redactTokenText(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT_REDACTED]')
    .replace(/("?(?:access_token|id_token|refresh_token|code|code_verifier)"?\s*[:=]\s*"?)([^"',&\s}]+)/gi, '$1[REDACTED]');
}

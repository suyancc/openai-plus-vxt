import type { ConvertedAccount, ConvertSkipped, ExportFormat } from './types';

// ─── Utility helpers ──────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBase64UrlJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function parseJwtPayload(token: unknown): Record<string, unknown> | undefined {
  if (typeof token !== 'string' || token.trim() === '') {
    return undefined;
  }
  const segments = token.split('.');
  if (segments.length < 2) {
    return undefined;
  }
  try {
    return JSON.parse(decodeBase64Url(segments[1]));
  } catch {
    return undefined;
  }
}

function getOpenAIAuthSection(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isPlainObject(payload)) return {};
  const auth = payload['https://api.openai.com/auth'];
  return isPlainObject(auth) ? auth : {};
}

function getOpenAIProfileSection(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isPlainObject(payload)) return {};
  const profile = payload['https://api.openai.com/profile'];
  return isPlainObject(profile) ? profile : {};
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromUnixSeconds(value: unknown): string | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function epochSecondsFromValue(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
}

function getExpiresIn(expiresAt: string | undefined, now: Date = new Date()): number | undefined {
  if (!expiresAt) return undefined;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return undefined;
  return Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000));
}

function toEmailKey(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  return email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function stripUnavailable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnavailable).filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, stripUnavailable(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function buildSyntheticCodexIdToken(
  email: string | undefined,
  accountId: string | undefined,
  planType: string | undefined,
  userId: string | undefined,
  expiresAt: string | undefined,
): string | undefined {
  if (!accountId) return undefined;
  const now = Math.trunc(Date.now() / 1000);
  const authInfo: Record<string, unknown> = { chatgpt_account_id: accountId };
  const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;
  if (planType) authInfo.chatgpt_plan_type = planType;
  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }
  const payload: Record<string, unknown> = {
    iat: now,
    exp: expires,
    'https://api.openai.com/auth': authInfo,
  };
  if (email) payload.email = email;
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.`;
}

// ─── Session collection ───────────────────────────────────────────────────────

interface SessionSource {
  value: Record<string, unknown>;
  sourceName: string;
  path: string;
}

function collectSessionLikeObjects(value: unknown, sourceName: string = 'pasted-json'): SessionSource[] {
  const found: SessionSource[] = [];
  const visited = new WeakSet();

  function visit(item: unknown, path: string): void {
    if (!isPlainObject(item) && !Array.isArray(item)) return;

    if (isPlainObject(item)) {
      if (visited.has(item as object)) return;
      visited.add(item as object);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        (item.token as Record<string, unknown>)?.accessToken,
        (item.token as Record<string, unknown>)?.access_token,
        (item.credentials as Record<string, unknown>)?.accessToken,
        (item.credentials as Record<string, unknown>)?.access_token,
      );
      const hasIdentity = isPlainObject(item.user) || firstNonEmpty(
        item.email as string,
        item.name as string,
        (item.providerSpecificData as Record<string, unknown>)?.chatgptAccountId,
        (item.providerSpecificData as Record<string, unknown>)?.chatgpt_account_id,
        item.id as string,
      );
      if (token && hasIdentity) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === 'accessToken' || key === 'access_token' || key === 'sessionToken') continue;
        visit(child, `${path}.${key}`);
      }
      return;
    }

    (item as unknown[]).forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, '$');
  return found;
}

// ─── Core converter ───────────────────────────────────────────────────────────

function convertSession(
  record: Record<string, unknown>,
  options: { now?: Date; sourceName?: string; sourcePath?: string } = {},
): ConvertedAccount {
  if (!isPlainObject(record)) throw new Error('session 不是 JSON 对象');

  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    (record.token as Record<string, unknown>)?.accessToken,
    (record.token as Record<string, unknown>)?.access_token,
    (record.credentials as Record<string, unknown>)?.accessToken,
    (record.credentials as Record<string, unknown>)?.access_token,
  );
  if (!accessToken) throw new Error('缺少 accessToken');

  const sessionToken = firstNonEmpty(
    record.sessionToken,
    record.session_token,
    (record.token as Record<string, unknown>)?.sessionToken,
    (record.token as Record<string, unknown>)?.session_token,
    (record.credentials as Record<string, unknown>)?.session_token,
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    (record.token as Record<string, unknown>)?.refreshToken,
    (record.token as Record<string, unknown>)?.refresh_token,
    (record.credentials as Record<string, unknown>)?.refresh_token,
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    (record.token as Record<string, unknown>)?.idToken,
    (record.token as Record<string, unknown>)?.id_token,
    (record.credentials as Record<string, unknown>)?.id_token,
  );

  const payload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);

  const expiresAt = firstNonEmpty(
    payload ? timestampFromUnixSeconds((payload as Record<string, unknown>).exp) : undefined,
    normalizeTimestamp(record.expires),
    normalizeTimestamp(record.expiresAt),
    normalizeTimestamp(record.expired),
    normalizeTimestamp(record.expires_at),
  );

  const email = firstNonEmpty(
    (record.user as Record<string, unknown>)?.email,
    record.email,
    (record.credentials as Record<string, unknown>)?.email,
    (record.providerSpecificData as Record<string, unknown>)?.email,
    profile.email,
    idPayload?.email,
    payload?.email,
  );

  const accountId = firstNonEmpty(
    (record.account as Record<string, unknown>)?.id,
    record.account_id,
    record.chatgptAccountId,
    (record.providerSpecificData as Record<string, unknown>)?.chatgptAccountId,
    (record.providerSpecificData as Record<string, unknown>)?.chatgpt_account_id,
    (record.credentials as Record<string, unknown>)?.chatgpt_account_id,
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === 'codex' ? record.id : undefined,
  );

  const userId = firstNonEmpty(
    (record.user as Record<string, unknown>)?.id,
    record.user_id,
    record.chatgptUserId,
    (record.providerSpecificData as Record<string, unknown>)?.chatgptUserId,
    (record.providerSpecificData as Record<string, unknown>)?.chatgpt_user_id,
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  );

  const planType = firstNonEmpty(
    (record.account as Record<string, unknown>)?.planType,
    (record.account as Record<string, unknown>)?.plan_type,
    record.planType,
    record.plan_type,
    (record.providerSpecificData as Record<string, unknown>)?.chatgptPlanType,
    (record.providerSpecificData as Record<string, unknown>)?.chatgpt_plan_type,
    (record.credentials as Record<string, unknown>)?.plan_type,
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  );

  const exportedAt = normalizeTimestamp(options.now || new Date())!;
  const expiresIn = getExpiresIn(expiresAt, options.now || new Date());
  const sourceName = firstNonEmpty(options.sourceName, 'pasted-json') || 'pasted-json';
  const name = firstNonEmpty(email, sourceName, 'ChatGPT Account') || 'ChatGPT Account';

  const syntheticIdToken = !inputIdToken
    ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
    : undefined;
  const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);

  const cpa = Object.fromEntries(
    Object.entries({
      type: 'codex',
      account_id: accountId,
      chatgpt_account_id: accountId,
      email,
      name,
      plan_type: planType,
      chatgpt_plan_type: planType,
      id_token: idToken,
      id_token_synthetic: syntheticIdToken ? true : undefined,
      access_token: accessToken,
      refresh_token: refreshToken || '',
      session_token: sessionToken,
      last_refresh: exportedAt,
      expired: expiresAt,
      disabled: record.disabled ? true : undefined,
    }).filter(([, value]) => value !== undefined && value !== null),
  );

  const cockpit: Record<string, unknown> = {
    type: 'codex',
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken || '',
    account_id: accountId,
    last_refresh: exportedAt,
    email,
    expired: expiresAt,
    account_note: firstNonEmpty(
      record.account_note as string,
      record.accountInfo as string,
      record.account_info as string,
      record.note as string,
      record.notes as string,
      record.remark as string,
    ),
  };

  const sub2apiAccount = stripUnavailable({
    name: firstNonEmpty(name, email, sourceName, 'ChatGPT Account'),
    platform: 'openai',
    type: 'oauth',
    concurrency: 10,
    priority: 1,
    credentials: {
      access_token: accessToken,
      chatgpt_account_id: accountId,
      chatgpt_user_id: userId,
      email,
      expires_at: expiresAt,
      expires_in: expiresIn,
      plan_type: planType,
    },
    extra: {
      email,
      email_key: toEmailKey(email),
      name,
      auth_provider: firstNonEmpty(record.authProvider as string, record.auth_provider as string),
      source: record.provider === 'codex' && record.authType === 'oauth' ? '9router' : 'chatgpt_web_session',
      last_refresh: exportedAt,
    },
  }) as Record<string, unknown>;

  const priority = Number.isFinite(Number(record.priority)) ? Number(record.priority) : 9;
  const isActive = typeof record.isActive === 'boolean' ? record.isActive : !record.disabled;
  const createdAt = normalizeTimestamp(record.createdAt) || exportedAt;
  const updatedAt = normalizeTimestamp(record.updatedAt) || exportedAt;

  const nineRouter = stripUnavailable({
    accessToken,
    refreshToken,
    expiresAt,
    testStatus: firstNonEmpty(record.testStatus as string, record.test_status as string, 'active'),
    expiresIn,
    providerSpecificData: {
      chatgptAccountId: accountId,
      chatgptPlanType: planType,
    },
    id: accountId,
    provider: 'codex',
    authType: 'oauth',
    name,
    email,
    priority,
    isActive,
    createdAt,
    updatedAt,
  }) as Record<string, unknown>;

  return {
    sourceName,
    sourcePath: options.sourcePath,
    email,
    name,
    expiresAt,
    cpa,
    cockpit,
    nineRouter,
    sub2apiAccount,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseAndConvert(text: string): { converted: ConvertedAccount[]; skipped: ConvertSkipped[] } {
  if (!text.trim()) {
    return { converted: [], skipped: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const sources = collectSessionLikeObjects(parsed);
  const converted: ConvertedAccount[] = [];
  const skipped: ConvertSkipped[] = [];
  const now = new Date();

  sources.forEach((item, index) => {
    try {
      converted.push(convertSession(item.value, {
        now,
        sourceName: item.sourceName,
        sourcePath: item.path || `$[${index}]`,
      }));
    } catch (error) {
      skipped.push({
        sourceName: item.sourceName,
        path: item.path,
        reason: error instanceof Error ? error.message : '无法转换',
      });
    }
  });

  if (!sources.length) {
    skipped.push({
      sourceName: 'pasted-json',
      path: '$',
      reason: '未找到包含 accessToken 和 user/email 的 session 对象',
    });
  }

  return { converted, skipped };
}

export function buildOutputDocument(converted: ConvertedAccount[], format: ExportFormat): unknown {
  const now = new Date();

  if (format === 'sub2api') {
    return {
      exported_at: normalizeTimestamp(now),
      proxies: [],
      accounts: converted.map((item) => item.sub2apiAccount),
    };
  }

  if (format === 'cpa') {
    return converted.length === 1 ? converted[0].cpa : converted.map((item) => item.cpa);
  }

  if (format === 'cockpit') {
    return converted.length === 1 ? converted[0].cockpit : converted.map((item) => item.cockpit);
  }

  if (format === '9router') {
    return converted.length === 1 ? converted[0].nineRouter : converted.map((item) => item.nineRouter);
  }

  return {
    exported_at: normalizeTimestamp(now),
    proxies: [],
    accounts: converted.map((item) => item.sub2apiAccount),
  };
}

export function buildFileName(converted: ConvertedAccount[], format: ExportFormat): string {
  const first = converted[0];
  const base = sanitizeFileToken(first?.email || first?.name || format);
  const timestamp = getTimestampToken();
  return `${base}.${format}.${timestamp}.json`;
}

function sanitizeFileToken(value: string, fallback = 'chatgpt-session'): string {
  const base = value.trim() || fallback;
  return base
    .replace(/\.[^.]+$/u, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || fallback;
}

function getTimestampToken(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

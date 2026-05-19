import type {
  CheckoutLinkResponse,
  CheckoutOptions,
  CheckoutPlanName,
  CheckoutRegion,
  CheckoutUiMode,
} from './types';

const CHECKOUT_URL = 'https://chatgpt.com/backend-api/payments/checkout';
const ACCESS_TOKEN_RE = /"accessToken"\s*:\s*"([^"]+)"/;
const ACCESS_TOKEN_LOOSE_RE = /"accessToken"\s*:\s*"?([A-Za-z0-9_.-]+)/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const CHECKOUT_SESSION_RE = /(cs_(?:live|test)_[A-Za-z0-9]+)/;
const PROCESSOR_ENTITY_RE = /(?:\/checkout\/|processor_entity=)([A-Za-z0-9_]+)/;
const REGION_BILLING: Record<CheckoutRegion, { country: string; currency: string }> = {
  US: { country: 'US', currency: 'USD' },
  ID: { country: 'ID', currency: 'IDR' },
  DE: { country: 'DE', currency: 'EUR' },
  JP: { country: 'JP', currency: 'JPY' },
};

export const DEFAULT_CHECKOUT_OPTIONS: CheckoutOptions = {
  planName: 'chatgptplusplan',
  uiMode: 'custom',
  region: 'US',
  workspaceName: 'MyTeam',
  seatQuantity: 5,
};

export function extractAccessToken(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('请输入包含 accessToken 的 JSON 或字符串');
  }

  const token = extractFromJson(text) || extractFromAccessTokenField(text) || extractFirstJwt(text);
  if (!token) {
    throw new Error('未找到 accessToken');
  }
  if (token.split('.').length !== 3) {
    throw new Error('accessToken 格式不正确');
  }
  return token;
}

export function tryExtractAccessToken(raw: string): string {
  try {
    return extractAccessToken(raw);
  } catch {
    return '';
  }
}

export function normalizeCheckoutOptions(value: unknown): CheckoutOptions {
  const source = isRecord(value) ? value : {};
  return {
    planName: normalizePlanName(source.planName),
    uiMode: normalizeUiMode(source.uiMode),
    region: normalizeRegion(source.region || source.country),
    workspaceName: String(source.workspaceName || source.workspace_name || DEFAULT_CHECKOUT_OPTIONS.workspaceName).trim() ||
      DEFAULT_CHECKOUT_OPTIONS.workspaceName,
    seatQuantity: normalizeSeatQuantity(source.seatQuantity),
  };
}

export async function createCheckoutLink(raw: string, optionsInput: unknown): Promise<CheckoutLinkResponse> {
  let token: string;
  let checkoutOptions: CheckoutOptions;
  let payload: Record<string, unknown>;
  try {
    token = extractAccessToken(raw);
    checkoutOptions = normalizeCheckoutOptions(optionsInput);
    payload = buildCheckoutPayload(checkoutOptions);
  } catch (error) {
    return fail(errorMessage(error));
  }

  let response: Response;
  try {
    response = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      credentials: 'omit',
    });
  } catch (error) {
    return fail(`ChatGPT checkout 请求失败：${String(error)}`);
  }

  const text = await response.text();
  const data = parseJsonResponse(text);
  if (!response.ok) {
    return fail(`ChatGPT checkout HTTP ${response.status}：${extractResponseError(data, text)}`);
  }

  if (!isRecord(data)) {
    return fail('ChatGPT checkout 响应不是 JSON 对象');
  }

  const result = extractCheckoutResult(data, checkoutOptions);
  const link = selectOutputLink(result, checkoutOptions.uiMode);
  if (!link) {
    return fail(`未找到订阅链接，响应字段：${Object.keys(data).slice(0, 12).join(', ') || '空'}`);
  }

  return {
    ok: true,
    message: checkoutOptions.uiMode === 'hosted' ? '长链接生成成功' : '短链接生成成功',
    url: link,
    link,
    longUrl: result.providerUrl,
    shortUrl: result.canonicalUrl,
    providerUrl: result.providerUrl,
    canonicalUrl: result.canonicalUrl,
    uiMode: checkoutOptions.uiMode,
    raw: data,
    source: 'chatgpt_checkout',
    planName: checkoutOptions.planName,
    billingDetails: {
      country: result.billingDetails.country,
      currency: result.billingDetails.currency,
    },
    responseKeys: Object.keys(data).slice(0, 20),
  };
}

function buildCheckoutPayload(options: CheckoutOptions): Record<string, unknown> {
  const isPlus = options.planName === 'chatgptplusplan';
  const billingDetails = billingDetailsForRegion(options.region);

  const payload: Record<string, unknown> = {
    entry_point: isPlus ? 'all_plans_pricing_modal' : 'team_workspace_purchase_modal',
    plan_name: options.planName,
    billing_details: billingDetails,
    cancel_url: 'https://chatgpt.com/#pricing',
    checkout_ui_mode: options.uiMode,
    promo_campaign: {
      promo_campaign_id: isPlus ? 'plus-1-month-free' : 'team-1-month-free',
      is_coupon_from_query_param: false,
    },
  };
  if (!isPlus) {
    payload.team_plan_data = {
      workspace_name: options.workspaceName,
      price_interval: 'month',
      seat_quantity: options.seatQuantity,
    };
  }
  return payload;
}

function normalizePlanName(value: unknown): CheckoutPlanName {
  return value === 'chatgptplusplan' || value === 'chatgptteamplan'
    ? value
    : DEFAULT_CHECKOUT_OPTIONS.planName;
}

function normalizeUiMode(value: unknown): CheckoutUiMode {
  return value === 'hosted' ? 'hosted' : 'custom';
}

function normalizeRegion(value: unknown): CheckoutRegion {
  const region = String(value || DEFAULT_CHECKOUT_OPTIONS.region).trim().toUpperCase();
  return region === 'ID' || region === 'DE' || region === 'JP' || region === 'US'
    ? region
    : DEFAULT_CHECKOUT_OPTIONS.region;
}

function normalizeSeatQuantity(value: unknown): number {
  const quantity = Number(value || DEFAULT_CHECKOUT_OPTIONS.seatQuantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('team_plan_data.seat_quantity 必须是大于 0 的整数');
  }
  return quantity;
}

function billingDetailsForRegion(region: CheckoutRegion): { country: string; currency: string } {
  return REGION_BILLING[region] || REGION_BILLING.US;
}

function extractFromJson(text: string): string {
  try {
    return findAccessToken(JSON.parse(text));
  } catch {
    return '';
  }
}

function findAccessToken(value: unknown, depth = 0): string {
  if (!isRecord(value) || depth > 4) {
    return '';
  }
  if (typeof value.accessToken === 'string') {
    return value.accessToken.trim();
  }
  for (const item of Object.values(value)) {
    const found = findAccessToken(item, depth + 1);
    if (found) {
      return found;
    }
  }
  return '';
}

function extractFromAccessTokenField(text: string): string {
  const quoted = ACCESS_TOKEN_RE.exec(text);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const loose = ACCESS_TOKEN_LOOSE_RE.exec(text);
  if (!loose?.[1]) {
    return '';
  }
  const value = loose[1].trim().replace(/[",}\]\s]+$/, '');
  const jwt = JWT_RE.exec(value);
  return jwt?.[0]?.trim() || value;
}

function extractFirstJwt(text: string): string {
  return JWT_RE.exec(text)?.[0]?.trim() || '';
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function findProviderUrl(data: Record<string, unknown>): string {
  for (const key of ['url', 'stripe_hosted_url', 'checkout_url']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function extractCheckoutResult(
  data: Record<string, unknown>,
  options: CheckoutOptions,
): {
  providerUrl: string;
  canonicalUrl: string;
  billingDetails: { country: string; currency: string };
} {
  const providerUrl = findProviderUrl(data);
  const billingDetails = billingDetailsForRegion(options.region);
  const sessionId = findCheckoutSession(data, providerUrl);
  const processorEntity = findProcessorEntity(data, providerUrl, billingDetails.country);
  const canonicalUrl = sessionId && processorEntity
    ? `https://chatgpt.com/checkout/${processorEntity}/${sessionId}`
    : '';

  return {
    providerUrl,
    canonicalUrl,
    billingDetails,
  };
}

function selectOutputLink(
  result: { providerUrl: string; canonicalUrl: string },
  uiMode: CheckoutUiMode,
): string {
  if (uiMode === 'hosted') {
    return result.providerUrl || result.canonicalUrl;
  }
  return result.canonicalUrl || result.providerUrl;
}

function findCheckoutSession(data: Record<string, unknown>, providerUrl: string): string {
  const direct = stringValue(data.checkout_session_id) || stringValue(data.session_id);
  if (direct) {
    return direct;
  }
  return extractCheckoutSession([
    providerUrl,
    stringValue(data.success_url),
    stringValue(data.cancel_url),
    stringValue(data.return_url),
    stringValue(data.client_secret),
  ].join(' '));
}

function findProcessorEntity(
  data: Record<string, unknown>,
  providerUrl: string,
  billingCountry: string,
): string {
  const direct = stringValue(data.processor_entity);
  if (direct) {
    return direct;
  }
  const text = [
    providerUrl,
    stringValue(data.success_url),
    stringValue(data.cancel_url),
    stringValue(data.return_url),
  ].join(' ');
  const match = PROCESSOR_ENTITY_RE.exec(text);
  if (match?.[1]) {
    return match[1];
  }
  return billingCountry === 'US' ? 'openai_llc' : 'openai_ie';
}

function extractCheckoutSession(value: string): string {
  const raw = String(value || '');
  const match = CHECKOUT_SESSION_RE.exec(raw);
  if (match?.[1]) {
    return match[1];
  }
  try {
    return CHECKOUT_SESSION_RE.exec(decodeURIComponent(raw))?.[1] || '';
  } catch {
    return '';
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractResponseError(data: unknown, text: string): string {
  if (isRecord(data)) {
    if (typeof data.detail === 'string') {
      return shorten(data.detail);
    }
    if (typeof data.error === 'string') {
      return shorten(data.error);
    }
    if (isRecord(data.error)) {
      if (typeof data.error.detail === 'string') {
        return shorten(data.error.detail);
      }
      if (typeof data.error.message === 'string') {
        return shorten(data.error.message);
      }
    }
  }
  return shorten(text || '请求失败');
}

function fail(message: string): CheckoutLinkResponse {
  return { ok: false, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shorten(text: string, limit = 600): string {
  return String(text || '').replace(/\s+/g, ' ').slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

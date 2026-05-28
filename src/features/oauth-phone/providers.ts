import type {
  OAuthPhoneActivationStatus,
  OAuthPhoneBalance,
  OAuthPhoneCountry,
  OAuthPhoneNumberRequest,
  OAuthPhoneOrder,
  OAuthPhoneOrderStatus,
  OAuthPhonePriceOffer,
  OAuthPhoneProviderClient,
  OAuthPhoneProviderDefinition,
  OAuthPhoneProviderId,
  OAuthPhoneProviderSettings,
  OAuthPhoneSmsStatus,
} from './types';
import { countryIdToIso, countryIsoToChineseName } from './country-map';

const SMS_ACTIVATE_STATUS: Record<OAuthPhoneActivationStatus, number> = {
  ready: 1,
  retry: 3,
  complete: 6,
  cancel: 8,
};

const SMSPOOL_OPENAI_SERVICE_ID = '671';
const SMSPOOL_DEFAULT_POOL = '7';
const DEFAULT_RUB_PER_USD = 75;

const PROVIDER_DEFINITIONS: OAuthPhoneProviderDefinition[] = [
  {
    id: 'smsbower',
    label: 'SMS Bower',
    baseUrl: 'https://smsbower.page/stubs/handler_api.php',
    supportsV2: true,
    defaultServiceCode: 'dr',
    priceCurrency: 'USD',
  },
  {
    id: 'herosms',
    label: 'HeroSMS',
    baseUrl: 'https://hero-sms.com/stubs/handler_api.php',
    supportsV2: true,
    defaultServiceCode: 'dr',
    priceCurrency: 'USD',
  },
  {
    id: 'smspool',
    label: 'SMSPool',
    baseUrl: 'https://api.smspool.net',
    supportsV2: false,
    defaultServiceCode: SMSPOOL_OPENAI_SERVICE_ID,
    priceCurrency: 'USD',
  },
  {
    id: 'tigersms',
    label: 'Tiger SMS',
    baseUrl: 'https://api.tiger-sms.com/stubs/handler_api.php',
    supportsV2: false,
    defaultServiceCode: 'dr',
    priceCurrency: 'RUB',
  },
];

export const OAUTH_PHONE_PROVIDER_DEFINITIONS = PROVIDER_DEFINITIONS;

export function getOAuthPhoneProviderDefinition(id: OAuthPhoneProviderId): OAuthPhoneProviderDefinition {
  return PROVIDER_DEFINITIONS.find((provider) => provider.id === id) || PROVIDER_DEFINITIONS[0];
}

export function createOAuthPhoneProvider(id: OAuthPhoneProviderId): OAuthPhoneProviderClient {
  const definition = getOAuthPhoneProviderDefinition(id);
  if (definition.id === 'smspool') {
    return new SmsPoolProvider(definition);
  }
  return new SmsActivateCompatibleProvider(definition);
}

class SmsPoolProvider implements OAuthPhoneProviderClient {
  constructor(public readonly definition: OAuthPhoneProviderDefinition) {}

  async getBalance(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneBalance> {
    const data = await this.requestJson(settings, 'request/balance', {});
    const amount = Number(readFirst(data, ['balance', 'amount', 'credits', 'credit']) || 0);
    return {
      providerId: this.definition.id,
      amount,
      currency: 'USD',
      raw: JSON.stringify(data),
    };
  }

  async getCountries(_settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneCountry[]> {
    const data = await this.requestPublicJson('country/retrieve_all', {});
    const list = Array.isArray(data) ? data : Object.values(isRecord(data) ? data : {});
    return list.map(normalizeSmsPoolCountry).filter((country): country is OAuthPhoneCountry => Boolean(country));
  }

  async getPrices(
    settings: OAuthPhoneProviderSettings,
    countryId: string,
    serviceCode: string,
  ): Promise<OAuthPhonePriceOffer[]> {
    return this.getDetailedPrices(settings, serviceCode, countryId);
  }

  async getDetailedPrices(
    settings: OAuthPhoneProviderSettings,
    serviceCode: string,
    countryId = '',
  ): Promise<OAuthPhonePriceOffer[]> {
    const service = normalizeSmsPoolServiceCode(serviceCode);
    const data = await this.requestPublicJson('request/pricing', {
      service,
      country: countryId,
    });
    const rows = Array.isArray(data) ? data : Object.values(isRecord(data) ? data : {});
    const deduped = dedupeProviderOffers(rows
      .map((row) => normalizeSmsPoolPriceOffer(this.definition.id, row, service, countryId))
      .filter((offer): offer is OAuthPhonePriceOffer => Boolean(offer)));
    if (deduped.length) {
      return deduped.sort((left, right) => left.cost - right.cost || right.count - left.count);
    }
    throw new Error('SMSPool 没有返回可用报价');
  }

  async getActiveOrders(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneOrder[]> {
    const data = await this.requestJson(settings, 'request/active', {});
    const rows = Array.isArray(data) ? data : Object.values(isRecord(data) ? data : {});
    return rows
      .map((row) => normalizeSmsPoolActiveOrder(this.definition.id, row))
      .filter((order): order is OAuthPhoneOrder => Boolean(order));
  }

  async requestNumber(
    settings: OAuthPhoneProviderSettings,
    request: OAuthPhoneNumberRequest,
  ): Promise<OAuthPhoneOrder> {
    const service = normalizeSmsPoolServiceCode(request.serviceCode);
    const pool = request.operator || SMSPOOL_DEFAULT_POOL;
    const body: Record<string, string | number | undefined> = {
      country: request.countryId,
      service,
      pool,
      max_price: request.maxPrice,
      pricing_option: 0,
    };
    emitOAuthPhoneProviderLog(request, 'number-request', this.definition.id, {
      countryId: request.countryId,
      countryName: request.countryName || '',
      serviceCode: service,
      providerIds: pool,
      expectedCost: request.expectedCost,
      maxPrice: request.maxPrice,
      params: body,
    });
    const data = await this.requestJson(settings, 'purchase/sms', body);
    emitOAuthPhoneProviderLog(request, 'number-response', this.definition.id, {
      countryId: request.countryId,
      countryName: request.countryName || '',
      serviceCode: service,
      providerIds: pool,
      expectedCost: request.expectedCost,
      maxPrice: request.maxPrice,
      raw: data,
    });
    if (!isRecord(data) || !isSuccessfulSmsPoolResponse(data)) {
      throw new Error(normalizeSmsPoolError(data));
    }
    const activationId = String(readFirst(data, ['order_id', 'orderid', 'id', 'ID']) || '');
    const phoneNumber = normalizeSmsPoolOrderPhoneNumber(data);
    if (!activationId || !phoneNumber) {
      throw new Error(`SMSPool 索号返回缺少订单或号码：${JSON.stringify(data)}`);
    }
    return {
      providerId: this.definition.id,
      activationId,
      phoneNumber,
      countryId: request.countryId,
      serviceCode: service,
      cost: Number(readFirst(data, ['cost', 'price', 'amount']) || request.expectedCost || 0),
      operator: pool,
      status: 'requested',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      raw: data,
    };
  }

  async getSms(settings: OAuthPhoneProviderSettings, order: OAuthPhoneOrder): Promise<OAuthPhoneSmsStatus> {
    const data = await this.requestJson(settings, 'sms/check', {
      orderid: order.activationId,
    });
    if (!isRecord(data)) {
      throw new Error(normalizeSmsPoolError(data));
    }
    const code = String(readFirst(data, ['sms', 'sms_code', 'code', 'pin', 'otp']) || '').trim();
    const message = String(readFirst(data, ['sms_text', 'message', 'text', 'full_sms']) || '').trim();
    if (code) {
      return buildSmsStatus(this.definition.id, order.activationId, 'received', code, message || code, data);
    }
    if (isSuccessfulSmsPoolResponse(data) || isWaitingSmsPoolResponse(data)) {
      return buildSmsStatus(this.definition.id, order.activationId, 'waiting', '', message || normalizeSmsPoolError(data) || '等待短信', data);
    }
    throw new Error(normalizeSmsPoolError(data));
  }

  async setStatus(
    settings: OAuthPhoneProviderSettings,
    order: OAuthPhoneOrder,
    status: OAuthPhoneActivationStatus,
  ): Promise<{ ok: boolean; message: string; raw: unknown }> {
    if (status !== 'cancel') {
      return { ok: true, message: 'SMSPool 不需要设置完成状态', raw: null };
    }
    const data = await this.requestJson(settings, 'sms/cancel', {
      orderid: order.activationId,
    });
    const ok = isSuccessfulSmsPoolResponse(data);
    return {
      ok,
      message: ok ? '已取消 SMSPool 订单' : normalizeSmsPoolError(data),
      raw: data,
    };
  }

  private async requestJson(
    settings: OAuthPhoneProviderSettings,
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      throw new Error(`${this.definition.label} API key 为空`);
    }
    return this.requestPublicJson(path, {
      key: apiKey,
      ...params,
    });
  }

  private async requestPublicJson(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const body = buildSmsPoolParams(params);
    const postUrl = `${this.definition.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    const postResponse = await fetch(postUrl, {
      method: 'POST',
      body,
      cache: 'no-store',
    });
    const postText = (await postResponse.text()).trim();
    const postData = parseJson(postText);
    if (postResponse.ok) {
      return postData ?? postText;
    }
    throw new Error(normalizeSmsPoolError(postData ?? postText));
  }
}

class SmsActivateCompatibleProvider implements OAuthPhoneProviderClient {
  constructor(public readonly definition: OAuthPhoneProviderDefinition) {}

  async getBalance(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneBalance> {
    const text = await this.requestText(settings, { action: 'getBalance' });
    if (text.startsWith('ACCESS_BALANCE:')) {
      const providerAmount = Number(text.split(':')[1] || 0);
      return {
        providerId: this.definition.id,
        amount: fromProviderPrice(this.definition, providerAmount),
        currency: 'USD',
        raw: text,
      };
    }
    throw new Error(normalizeProviderError(text));
  }

  async getCountries(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneCountry[]> {
    try {
      const data = await this.requestJson(settings, { action: 'getCountries' });
      const list = Array.isArray(data) ? data : Object.values(isRecord(data) ? data : {});
      const countries = list.map(normalizeCountry).filter((country): country is OAuthPhoneCountry => Boolean(country));
      if (countries.length) {
        return countries;
      }
    } catch (error) {
      if (!shouldUseStaticSmsActivateCountries(error)) {
        throw error;
      }
    }
    return buildStaticSmsActivateCountries();
  }

  async getPrices(
    settings: OAuthPhoneProviderSettings,
    countryId: string,
    serviceCode: string,
  ): Promise<OAuthPhonePriceOffer[]> {
    const data = await this.requestJson(settings, {
      action: 'getPrices',
      country: countryId,
      service: serviceCode,
    });
    return normalizePriceOffers(this.definition.id, data, countryId, serviceCode);
  }

  async getDetailedPrices(
    settings: OAuthPhoneProviderSettings,
    serviceCode: string,
    countryId = '',
  ): Promise<OAuthPhonePriceOffer[]> {
    const actions = this.definition.supportsV2
      ? ['getPricesV3', 'getPricesV2', 'getPrices']
      : ['getPrices'];
    const errors: string[] = [];
    for (const action of actions) {
      try {
        const data = await this.requestJson(settings, {
          action,
          service: serviceCode,
          country: countryId,
        });
        const offers = normalizePriceOffers(this.definition.id, data, countryId, serviceCode);
        if (offers.length) {
          return offers;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(errors[0] || '平台没有返回完整报价表');
  }

  async getActiveOrders(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneOrder[]> {
    const data = await this.requestJson(settings, { action: 'getActiveActivations' });
    const rows = Array.isArray(data)
      ? data
      : Object.values(isRecord(data) ? (isRecord(data.activeActivations) ? data.activeActivations : data) : {});
    return rows
      .map((row) => normalizeSmsActivateActiveOrder(this.definition.id, row))
      .filter((order): order is OAuthPhoneOrder => Boolean(order));
  }

  async requestNumber(
    settings: OAuthPhoneProviderSettings,
    request: OAuthPhoneNumberRequest,
  ): Promise<OAuthPhoneOrder> {
    const params: Record<string, string | number | undefined> = {
      action: this.definition.supportsV2 ? 'getNumberV2' : 'getNumber',
      country: request.countryId,
      service: request.serviceCode,
      maxPrice: toProviderPrice(this.definition, request.maxPrice),
      providerIds: request.operator,
    };
    emitOAuthPhoneProviderLog(request, 'number-request', this.definition.id, buildNumberRequestLog(params, request));
    let response: Response;
    try {
      response = await this.requestRaw(settings, params);
    } catch (error) {
      emitOAuthPhoneProviderLog(request, 'number-request-error', this.definition.id, {
        ...buildNumberRequestLog(params, request),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const text = await response.text();
    const parsed = parseJson(text);
    emitOAuthPhoneProviderLog(request, 'number-response', this.definition.id, {
      ...buildNumberRequestLog(params, request),
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      rawText: text,
      parsed,
    });
    if (response.ok && isRecord(parsed) && parsed.activationId) {
      return {
        providerId: this.definition.id,
        activationId: String(parsed.activationId),
        phoneNumber: String(parsed.phoneNumber || ''),
        countryId: String(parsed.countryCode || request.countryId),
        serviceCode: request.serviceCode,
        cost: fromProviderPrice(this.definition, Number(parsed.activationCost || 0)),
        operator: String(parsed.activationOperator || request.operator || ''),
        status: 'requested',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        raw: parsed,
      };
    }
    if (response.ok && text.startsWith('ACCESS_NUMBER:')) {
      const [, activationId = '', phoneNumber = ''] = text.split(':');
      return {
        providerId: this.definition.id,
        activationId,
        phoneNumber,
        countryId: request.countryId,
        serviceCode: request.serviceCode,
        cost: 0,
        operator: request.operator || '',
        status: 'requested',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        raw: text,
      };
    }

    if (this.definition.supportsV2 && shouldRetryLegacyNumber(text)) {
      emitOAuthPhoneProviderLog(request, 'number-legacy-retry', this.definition.id, {
        ...buildNumberRequestLog(params, request),
        reason: text || response.statusText,
      });
      return this.requestLegacyNumber(settings, request);
    }
    throw new Error(normalizeProviderError(text || response.statusText));
  }

  async getSms(settings: OAuthPhoneProviderSettings, order: OAuthPhoneOrder): Promise<OAuthPhoneSmsStatus> {
    let v2Status: OAuthPhoneSmsStatus | null = null;
    if (this.definition.supportsV2) {
      v2Status = await this.tryGetSmsV2(settings, order);
      if (v2Status?.code) {
        return v2Status;
      }
    }

    const legacyStatus = await this.getSmsLegacy(settings, order).catch((error) => {
      if (v2Status) {
        return v2Status;
      }
      throw error;
    });
    if (legacyStatus.code) {
      return legacyStatus;
    }
    if (v2Status) {
      return buildSmsStatus(
        this.definition.id,
        order.activationId,
        legacyStatus.status !== 'waiting' ? legacyStatus.status : v2Status.status,
        '',
        [v2Status.message, legacyStatus.message].filter(Boolean).join(' | ') || 'waiting',
        { v2: v2Status.raw, legacy: legacyStatus.raw },
      );
    }
    return legacyStatus;
  }

  private async getSmsLegacy(settings: OAuthPhoneProviderSettings, order: OAuthPhoneOrder): Promise<OAuthPhoneSmsStatus> {
    const text = await this.requestText(settings, {
      action: 'getStatus',
      id: order.activationId,
    });
    if (text.startsWith('STATUS_OK:')) {
      const code = text.slice('STATUS_OK:'.length).trim();
      return buildSmsStatus(this.definition.id, order.activationId, 'received', code, code, text);
    }
    if (text.startsWith('STATUS_WAIT_RETRY:')) {
      const code = text.slice('STATUS_WAIT_RETRY:'.length).trim();
      return buildSmsStatus(this.definition.id, order.activationId, 'waiting', code, code, text);
    }
    if (text === 'STATUS_WAIT_CODE') {
      return buildSmsStatus(this.definition.id, order.activationId, 'waiting', '', '', text);
    }
    if (text === 'STATUS_CANCEL') {
      return buildSmsStatus(this.definition.id, order.activationId, 'canceled', '', '', text);
    }
    throw new Error(normalizeProviderError(text));
  }

  async setStatus(
    settings: OAuthPhoneProviderSettings,
    order: OAuthPhoneOrder,
    status: OAuthPhoneActivationStatus,
  ): Promise<{ ok: boolean; message: string; raw: unknown }> {
    const text = await this.requestText(settings, {
      action: 'setStatus',
      id: order.activationId,
      status: SMS_ACTIVATE_STATUS[status],
    });
    const ok = text.startsWith('ACCESS_');
    return {
      ok,
      message: ok ? text : normalizeProviderError(text),
      raw: text,
    };
  }

  private async requestLegacyNumber(
    settings: OAuthPhoneProviderSettings,
    request: OAuthPhoneNumberRequest,
  ): Promise<OAuthPhoneOrder> {
    const params: Record<string, string | number | undefined> = {
      action: 'getNumber',
      country: request.countryId,
      service: request.serviceCode,
      maxPrice: toProviderPrice(this.definition, request.maxPrice),
      providerIds: request.operator,
    };
    emitOAuthPhoneProviderLog(request, 'number-legacy-request', this.definition.id, buildNumberRequestLog(params, request));
    let text = '';
    try {
      text = await this.requestText(settings, params);
      emitOAuthPhoneProviderLog(request, 'number-legacy-response', this.definition.id, {
        ...buildNumberRequestLog(params, request),
        rawText: text,
      });
    } catch (error) {
      emitOAuthPhoneProviderLog(request, 'number-legacy-error', this.definition.id, {
        ...buildNumberRequestLog(params, request),
        rawText: text,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (!text.startsWith('ACCESS_NUMBER:')) {
      throw new Error(normalizeProviderError(text));
    }
    const [, activationId = '', phoneNumber = ''] = text.split(':');
    return {
      providerId: this.definition.id,
      activationId,
      phoneNumber,
      countryId: request.countryId,
      serviceCode: request.serviceCode,
      cost: 0,
      operator: request.operator || '',
      status: 'requested',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      raw: text,
    };
  }

  private async tryGetSmsV2(
    settings: OAuthPhoneProviderSettings,
    order: OAuthPhoneOrder,
  ): Promise<OAuthPhoneSmsStatus | null> {
    const response = await this.requestRaw(settings, {
      action: 'getStatusV2',
      id: order.activationId,
    });
    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok || !isRecord(data)) {
      return null;
    }
    const { code, message } = extractSmsActivatePayload(data);
    if (code) {
      return buildSmsStatus(this.definition.id, order.activationId, 'received', code, message || code, data);
    }
    return buildSmsStatus(this.definition.id, order.activationId, normalizeSmsActivateStatus(data), '', message, data);
  }

  private async requestText(
    settings: OAuthPhoneProviderSettings,
    params: Record<string, string | number | undefined>,
  ): Promise<string> {
    const response = await this.requestRaw(settings, params);
    const text = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(normalizeProviderError(text || response.statusText));
    }
    return text;
  }

  private async requestJson(
    settings: OAuthPhoneProviderSettings,
    params: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const text = await this.requestText(settings, params);
    const data = parseJson(text);
    if (data === null) {
      throw new Error(normalizeProviderError(text));
    }
    return data;
  }

  private async requestRaw(
    settings: OAuthPhoneProviderSettings,
    params: Record<string, string | number | undefined>,
  ): Promise<Response> {
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      throw new Error(`${this.definition.label} API key 为空`);
    }
    const url = new URL(this.definition.baseUrl);
    url.searchParams.set('api_key', apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    });
  }
}

function normalizeCountry(value: unknown): OAuthPhoneCountry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id || '').trim();
  if (!id) {
    return null;
  }
  const englishName = String(value.eng || value.name || '').trim();
  const chineseName = String(value.chn || '').trim();
  return {
    id,
    name: chineseName || englishName || String(value.rus || id),
    englishName,
    chineseName,
    raw: value,
  };
}

function shouldUseStaticSmsActivateCountries(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('BAD_ACTION') ||
    message.includes('平台不支持该接口动作') ||
    message.includes('接码平台返回空响应') ||
    message.includes('返回空响应');
}

function buildStaticSmsActivateCountries(): OAuthPhoneCountry[] {
  const countries: OAuthPhoneCountry[] = [];
  for (let id = 0; id <= 300; id += 1) {
    const countryId = String(id);
    const iso = countryIdToIso(countryId);
    if (!iso) {
      continue;
    }
    countries.push({
      id: countryId,
      name: countryIsoToChineseName(iso) || iso,
      englishName: iso,
      chineseName: countryIsoToChineseName(iso),
      raw: { id: countryId, iso, source: 'static-sms-activate' },
    });
  }
  return countries;
}

function normalizeSmsPoolCountry(value: unknown): OAuthPhoneCountry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.ID || value.id || '').trim();
  if (!id) {
    return null;
  }
  const englishName = String(value.name || '').trim();
  const shortName = String(value.short_name || value.shortName || '').trim();
  const chineseName = countryIsoToChineseName(shortName);
  return {
    id,
    name: chineseName || englishName || shortName || id,
    englishName,
    chineseName,
    raw: value,
  };
}

function normalizeSmsPoolPriceOffer(
  providerId: OAuthPhoneProviderId,
  value: unknown,
  requestedServiceCode: string,
  requestedCountryId: string,
): OAuthPhonePriceOffer | null {
  if (!isRecord(value)) {
    return null;
  }
  const serviceCode = String(value.service || value.service_id || requestedServiceCode || '').trim();
  const countryId = String(value.country || value.country_id || requestedCountryId || '').trim();
  const cost = Number(value.price ?? value.cost ?? 0);
  const pool = String(value.pool || value.pool_id || '').trim();
  const explicitCount = readFirst(value, ['stock', 'count', 'quantity', 'available']);
  const count = explicitCount === undefined ? -1 : Number(explicitCount);
  if (!countryId || !serviceCode || !pool || !Number.isFinite(cost) || cost <= 0) {
    return null;
  }
  return {
    providerId,
    countryId,
    serviceCode,
    cost,
    count: Number.isFinite(count) ? count : -1,
    operator: pool,
    raw: value,
  };
}

function normalizeSmsPoolActiveOrder(providerId: OAuthPhoneProviderId, value: unknown): OAuthPhoneOrder | null {
  if (!isRecord(value)) {
    return null;
  }
  const activationId = String(readFirst(value, ['order_id', 'orderid', 'id', 'ID']) || '').trim();
  if (!activationId) {
    return null;
  }
  const serviceCode = String(readFirst(value, ['service_id', 'service']) || '').trim();
  const countryId = String(readFirst(value, ['country_id', 'country']) || '').trim();
  const createdAt = normalizeTimestamp(readFirst(value, ['created_at', 'created', 'timestamp', 'date']) || 0);
  return {
    providerId,
    activationId,
    phoneNumber: normalizeSmsPoolOrderPhoneNumber(value),
    countryId,
    serviceCode,
    cost: Number(readFirst(value, ['cost', 'price', 'amount']) || 0),
    operator: String(readFirst(value, ['pool', 'pool_id', 'operator']) || '').trim(),
    status: normalizeActiveOrderStatus(readFirst(value, ['status', 'state']) || ''),
    createdAt: createdAt || Date.now(),
    updatedAt: Date.now(),
    raw: value,
  };
}

function normalizeSmsActivateActiveOrder(providerId: OAuthPhoneProviderId, value: unknown): OAuthPhoneOrder | null {
  if (!isRecord(value)) {
    return null;
  }
  const activationId = String(readFirst(value, ['activationId', 'id']) || '').trim();
  if (!activationId) {
    return null;
  }
  const phoneNumber = String(readFirst(value, ['phoneNumber', 'phone']) || '').replace(/[^\d]/g, '');
  const createdAt = normalizeTimestamp(readFirst(value, ['activationTime', 'createdAt', 'date']) || 0);
  return {
    providerId,
    activationId,
    phoneNumber,
    countryId: String(readFirst(value, ['countryCode', 'country']) || '').trim(),
    serviceCode: String(readFirst(value, ['serviceCode', 'service']) || '').trim(),
    cost: Number(readFirst(value, ['activationCost', 'cost', 'price']) || 0),
    operator: String(readFirst(value, ['activationOperator', 'operator']) || '').trim(),
    status: normalizeActiveOrderStatus(readFirst(value, ['status', 'activationStatus']) || ''),
    createdAt: createdAt || Date.now(),
    updatedAt: Date.now(),
    raw: value,
  };
}

function normalizePriceOffers(
  providerId: OAuthPhoneProviderId,
  data: unknown,
  requestedCountryId: string,
  requestedServiceCode: string,
): OAuthPhonePriceOffer[] {
  const offers: OAuthPhonePriceOffer[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      collectPriceMap(providerId, requestedCountryId, requestedServiceCode, item, offers);
    }
    return offers.sort((left, right) => left.cost - right.cost);
  }

  const root = isRecord(data) ? data : {};
  if (isPriceLeaf(root) || root[requestedServiceCode] !== undefined) {
    collectPriceMap(providerId, requestedCountryId, requestedServiceCode, root, offers);
    return offers.sort((left, right) => left.cost - right.cost);
  }

  const countries = requestedCountryId && root[requestedCountryId] !== undefined
    ? { [requestedCountryId]: root[requestedCountryId] }
    : root;

  for (const [countryId, countryValue] of Object.entries(countries)) {
    collectPriceMap(providerId, requestedCountryId || countryId, requestedServiceCode, countryValue, offers);
  }

  return offers.sort((left, right) => left.cost - right.cost);
}

function fromProviderPrice(definition: OAuthPhoneProviderDefinition, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (definition.priceCurrency === 'RUB') {
    return roundProviderUsd(value / DEFAULT_RUB_PER_USD);
  }
  return roundProviderUsd(value);
}

function toProviderPrice(definition: OAuthPhoneProviderDefinition, value: number | undefined): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  if (definition.priceCurrency === 'RUB') {
    return roundProviderRub(value * DEFAULT_RUB_PER_USD);
  }
  return roundProviderUsd(value);
}

function roundProviderUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundProviderRub(value: number): number {
  return Math.round(value * 100) / 100;
}

function dedupeProviderOffers<T extends OAuthPhonePriceOffer>(offers: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const offer of offers) {
    const key = [
      offer.providerId,
      offer.countryId,
      offer.serviceCode,
      offer.operator,
      String(Math.round(offer.cost * 10000) / 10000),
    ].join('|');
    const previous = byKey.get(key);
    if (!previous || offer.count > previous.count) {
      byKey.set(key, offer);
    }
  }
  return [...byKey.values()];
}

function normalizeSmsPoolServiceCode(value: string): string {
  const service = String(value || '').trim();
  if (!service || service === 'dr' || /^(openai|chatgpt|openai\/chatgpt)$/i.test(service)) {
    return SMSPOOL_OPENAI_SERVICE_ID;
  }
  return service;
}

function normalizeSmsPoolOrderPhoneNumber(value: Record<string, unknown>): string {
  const local = String(readFirst(value, ['phonenumber', 'phone_number']) || '').replace(/[^\d]/g, '');
  if (local) {
    return local;
  }

  const full = String(readFirst(value, ['number', 'phone']) || '').replace(/[^\d]/g, '');
  const countryCode = String(readFirst(value, ['cc', 'country_code', 'dial_code']) || '').replace(/[^\d]/g, '');
  if (full && countryCode && full.startsWith(countryCode) && full.length > countryCode.length + 4) {
    return full.slice(countryCode.length);
  }
  return full;
}

function isSuccessfulSmsPoolResponse(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const success = value.success;
  return success === 1 || success === true || success === '1' || success === 'true' || value.order_id !== undefined || value.number !== undefined;
}

function isWaitingSmsPoolResponse(value: unknown): boolean {
  const message = normalizeSmsPoolError(value).toLowerCase();
  return message.includes('pending') ||
    message.includes('processing') ||
    message.includes('activating') ||
    message.includes('wait') ||
    message.includes('not received') ||
    message.includes('no sms') ||
    message.includes('empty') ||
    message.includes('暂无') ||
    message.includes('等待');
}

function normalizeSmsPoolError(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim() || 'SMSPool 返回空响应';
  }
  if (!isRecord(value)) {
    return 'SMSPool 返回未知响应';
  }
  const errors = Array.isArray(value.errors) ? value.errors : [];
  const messages = errors
    .map((item) => {
      if (isRecord(item)) {
        return String(item.message || item.description || '').trim();
      }
      return String(item || '').trim();
    })
    .filter(Boolean);
  const direct = String(value.message || value.error || value.status || '').trim();
  return messages[0] || direct || 'SMSPool 请求失败';
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

function buildSmsPoolParams(params: Record<string, string | number | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      body.set(key, String(value));
    }
  }
  return body;
}

function normalizeActiveOrderStatus(value: unknown): OAuthPhoneOrderStatus {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('ok') || text.includes('received') || text.includes('completed') || text === '6') {
    return 'received';
  }
  if (text.includes('cancel') || text.includes('refund') || text === '8') {
    return 'canceled';
  }
  if (text.includes('error')) {
    return 'error';
  }
  return 'waiting';
}

function normalizeSmsActivateStatus(value: unknown): OAuthPhoneOrderStatus {
  const text = String(
    isRecord(value)
      ? readFirst(value, ['status', 'activationStatus', 'state']) || ''
      : value || '',
  ).trim().toLowerCase();
  if (text.includes('cancel')) {
    return 'canceled';
  }
  if (text.includes('error')) {
    return 'error';
  }
  return 'waiting';
}

function extractSmsActivatePayload(value: unknown): { code: string; message: string } {
  const candidates = collectSmsPayloadCandidates(value);
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    const code = String(readFirst(candidate, [
      'code',
      'smsCode',
      'sms_code',
      'pin',
      'otp',
      'verificationCode',
      'activationCode',
    ]) || '').trim();
    const statusText = String(readFirst(candidate, [
      'status',
      'activationStatus',
      'state',
      'activationState',
    ]) || '').trim();
    const message = String(readFirst(candidate, [
      'text',
      'smsText',
      'sms_text',
      'message',
      'fullSms',
      'full_sms',
      'body',
    ]) || '').trim();
    const extractedCode = code || extractStatusCode(statusText) || extractDigitsCode(message);
    if (extractedCode) {
      return { code: extractedCode, message: message || statusText || extractedCode };
    }
  }
  const text = collectSmsPayloadTexts(value).find((item) => item.trim());
  return {
    code: extractDigitsCode(text || '') || extractCodeFromUnknown(value),
    message: text || '',
  };
}

function collectSmsPayloadCandidates(value: unknown): unknown[] {
  const output: unknown[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 3 || item === undefined || item === null) {
      return;
    }
    output.push(item);
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child, depth + 1);
      }
      return;
    }
    if (!isRecord(item)) {
      return;
    }
    for (const key of ['sms', 'smses', 'messages', 'message', 'data', 'result', 'activation', 'code', 'status', 'activationStatus']) {
      const child = item[key];
      if (child !== undefined) {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return output;
}

function collectSmsPayloadTexts(value: unknown): string[] {
  const output: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 3 || item === undefined || item === null) {
      return;
    }
    if (typeof item === 'string' || typeof item === 'number') {
      output.push(String(item));
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child, depth + 1);
      }
      return;
    }
    if (!isRecord(item)) {
      return;
    }
    for (const key of ['sms', 'smses', 'messages', 'message', 'text', 'body', 'data', 'result', 'activation', 'status', 'activationStatus']) {
      const child = item[key];
      if (child !== undefined) {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return output;
}

function extractDigitsCode(value: string): string {
  const match = value.match(/\b(\d{4,8})\b/);
  return match?.[1] || '';
}

function extractStatusCode(value: string): string {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const statusMatch = text.match(/STATUS_OK\s*:?\s*['"]?(\d{4,8})['"]?/i);
  if (statusMatch?.[1]) {
    return statusMatch[1];
  }
  return '';
}

function extractCodeFromUnknown(value: unknown): string {
  const visit = (item: unknown, depth: number): string => {
    if (depth > 4 || item === undefined || item === null) {
      return '';
    }
    if (typeof item === 'string' || typeof item === 'number') {
      return extractDigitsCode(String(item));
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        const code = visit(child, depth + 1);
        if (code) {
          return code;
        }
      }
      return '';
    }
    if (!isRecord(item)) {
      return '';
    }
    for (const key of ['code', 'smsCode', 'sms_code', 'pin', 'otp', 'text', 'message', 'body', 'sms', 'data', 'result', 'status', 'activationStatus']) {
      const code = visit(item[key], depth + 1);
      if (code) {
        return code;
      }
    }
    return '';
  };
  return visit(value, 0);
}

function normalizeTimestamp(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function collectPriceMap(
  providerId: OAuthPhoneProviderId,
  countryId: string,
  serviceCode: string,
  value: unknown,
  offers: OAuthPhonePriceOffer[],
): void {
  if (!isRecord(value)) {
    return;
  }
  if (isPriceLeaf(value)) {
    collectServiceOffers(providerId, countryId, serviceCode, value, offers);
    return;
  }

  const directServiceValue = serviceCode ? value[serviceCode] : undefined;
  if (directServiceValue !== undefined) {
    collectServiceOffers(providerId, countryId, serviceCode, directServiceValue, offers);
    return;
  }

  for (const [nextServiceCode, serviceValue] of Object.entries(value)) {
    if (serviceCode && nextServiceCode !== serviceCode) {
      continue;
    }
    collectServiceOffers(providerId, countryId, nextServiceCode || serviceCode, serviceValue, offers);
  }
}

function collectServiceOffers(
  providerId: OAuthPhoneProviderId,
  countryId: string,
  serviceCode: string,
  value: unknown,
  offers: OAuthPhonePriceOffer[],
): void {
  if (!isRecord(value)) {
    return;
  }
  if (value.cost !== undefined || value.price !== undefined) {
    offers.push({
      providerId,
      countryId,
      serviceCode,
      cost: normalizeProviderOfferCost(providerId, Number(value.cost ?? value.price ?? 0)),
      count: Number(value.count ?? value.physicalCount ?? 0),
      operator: String(value.operator || value.provider_id || ''),
      raw: value,
    });
    return;
  }

  for (const [operator, child] of Object.entries(value)) {
    if (!isRecord(child)) {
      const cost = Number(operator);
      const count = Number(child ?? 0);
      if (Number.isFinite(cost) && Number.isFinite(count)) {
        offers.push({
          providerId,
          countryId,
          serviceCode,
          cost: normalizeProviderOfferCost(providerId, cost),
          count,
          operator: '',
          raw: { price: cost, count },
        });
      }
      continue;
    }
    offers.push({
      providerId,
      countryId,
      serviceCode,
      cost: normalizeProviderOfferCost(providerId, Number(child.cost ?? child.price ?? child.retail_price ?? operator)),
      count: Number(child.count ?? child.physicalCount ?? child.stock ?? child.quantity ?? child.phones ?? child.numbers_count ?? 0),
      operator: String(child.provider_id || child.providerId || operator),
      raw: child,
    });
  }
}

function isPriceLeaf(value: Record<string, unknown>): boolean {
  return value.cost !== undefined || value.price !== undefined;
}

function normalizeProviderOfferCost(providerId: OAuthPhoneProviderId, cost: number): number {
  return fromProviderPrice(getOAuthPhoneProviderDefinition(providerId), cost);
}

function buildSmsStatus(
  providerId: OAuthPhoneProviderId,
  activationId: string,
  status: OAuthPhoneOrderStatus,
  code: string,
  text: string,
  raw: unknown,
): OAuthPhoneSmsStatus {
  return {
    providerId,
    activationId,
    status,
    code,
    text,
    message: text || status,
    raw,
  };
}

function buildNumberRequestLog(
  params: Record<string, string | number | undefined>,
  request: OAuthPhoneNumberRequest,
): Record<string, unknown> {
  return {
    action: params.action,
    countryId: request.countryId,
    countryName: request.countryName || '',
    serviceCode: request.serviceCode,
    providerIds: request.operator || '',
    expectedCost: request.expectedCost,
    maxPrice: request.maxPrice,
    params: {
      action: params.action,
      country: params.country,
      service: params.service,
      maxPrice: params.maxPrice,
      providerIds: params.providerIds,
    },
  };
}

function emitOAuthPhoneProviderLog(
  request: OAuthPhoneNumberRequest,
  stage: string,
  providerId: OAuthPhoneProviderId,
  data: Record<string, unknown>,
): void {
  logOAuthPhoneProvider(stage, providerId, data);
  request.debug?.(`provider-${stage}`, {
    providerId,
    ...data,
  });
}

function logOAuthPhoneProvider(stage: string, providerId: OAuthPhoneProviderId, data: Record<string, unknown>): void {
  console.info(`[OPX OAuthPhone Provider] ${stage}`, {
    providerId,
    ...data,
  });
}

function shouldRetryLegacyNumber(text: string): boolean {
  return !text.trim() || text.includes('BAD_ACTION') || text.includes('not found') || text.includes('METHOD');
}

function normalizeProviderError(value: string): string {
  const text = String(value || '').trim();
  const known: Record<string, string> = {
    BAD_KEY: 'API key 不正确',
    BAD_ACTION: '平台不支持该接口动作',
    BAD_SERVICE: '服务代码不正确',
    BAD_COUNTRY: '国家 ID 不正确',
    NO_BALANCE: '余额不足',
    NO_NUMBERS: '当前条件没有可用号码',
    NO_ACTIVATION: '激活 ID 不存在',
    BAD_STATUS: '状态码不正确',
    EARLY_CANCEL_DENIED: '号码刚购买，平台暂不允许取消',
  };
  return known[text] || text || '接码平台返回空响应';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

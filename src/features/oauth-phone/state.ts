import { scopedStorageKey } from '../../app/storage-scope';
import { parseSmsRelayTargets } from '../sms/parser';
import { OAUTH_PHONE_PROVIDER_DEFINITIONS } from './providers';
import type {
  OAuthPhoneApiTarget,
  OAuthPhoneOrder,
  OAuthPhoneProviderId,
  OAuthPhoneProviderSelectionMode,
  OAuthPhoneProviderSettings,
  OAuthPhoneSelectedCountry,
  OAuthPhoneSelectedOffer,
  OAuthPhoneSettings,
  OAuthPhoneTrackedOrder,
} from './types';

const STORAGE_KEY = 'opx.oauthPhone.settings';

const DEFAULT_SETTINGS: OAuthPhoneSettings = {
  enabled: false,
  sourceMode: 'provider',
  providerMode: 'priority',
  activeProviderId: 'smsbower',
  serviceCode: OAUTH_PHONE_PROVIDER_DEFINITIONS[0]?.defaultServiceCode || 'dr',
  countryIds: [],
  selectedCountries: [],
  selectedOffers: [],
  minPrice: 0,
  maxPrice: 0,
  smsTimeoutSeconds: 120,
  rawApiTargets: '',
  apiTargets: [],
  orders: [],
  providers: OAUTH_PHONE_PROVIDER_DEFINITIONS.map((provider, index) => ({
    id: provider.id,
    enabled: index === 0,
    apiKey: '',
    priority: index + 1,
    updatedAt: 0,
  })),
  updatedAt: 0,
};

export async function loadOAuthPhoneSettings(): Promise<OAuthPhoneSettings> {
  const storageKey = scopedStorageKey(STORAGE_KEY);
  const data = await browser.storage.local.get(storageKey);
  return normalizeOAuthPhoneSettings(data[storageKey]);
}

export async function saveOAuthPhoneSettings(patch: Partial<OAuthPhoneSettings>): Promise<OAuthPhoneSettings> {
  const current = await loadOAuthPhoneSettings();
  const next = normalizeOAuthPhoneSettings({
    ...current,
    ...patch,
    providers: patch.providers || current.providers,
    updatedAt: Date.now(),
  });
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
  return next;
}

export function normalizeOAuthPhoneSettings(value: unknown): OAuthPhoneSettings {
  const source = isRecord(value) ? value : {};
  const providerIds = new Set(OAUTH_PHONE_PROVIDER_DEFINITIONS.map((provider) => provider.id));
  const activeProviderId = normalizeProviderId(source.activeProviderId);
  const countryIds = normalizeCountryIds(source.countryIds);
  const selectedCountries = normalizeSelectedCountries(source.selectedCountries, countryIds, activeProviderId);
  const selectedOffers = normalizeSelectedOffers(source.selectedOffers, selectedCountries, DEFAULT_SETTINGS.serviceCode);
  return {
    enabled: Boolean(source.enabled),
    sourceMode: normalizeSourceMode(source.sourceMode),
    providerMode: normalizeProviderMode(source.providerMode),
    activeProviderId,
    serviceCode: String(source.serviceCode || DEFAULT_SETTINGS.serviceCode).trim(),
    countryIds: selectedOffers.length
      ? selectedOffers.map((offer) => offer.countryId)
      : selectedCountries.length
        ? selectedCountries.map((country) => country.id)
      : countryIds,
    selectedCountries,
    selectedOffers,
    minPrice: normalizePriceLimit(source.minPrice),
    maxPrice: normalizeMaxPrice(source.maxPrice),
    smsTimeoutSeconds: normalizeSmsTimeoutSeconds(source.smsTimeoutSeconds),
    rawApiTargets: String(source.rawApiTargets || DEFAULT_SETTINGS.rawApiTargets),
    apiTargets: normalizeApiTargets(source.apiTargets, String(source.rawApiTargets || DEFAULT_SETTINGS.rawApiTargets)),
    orders: normalizeTrackedOrders(source.orders),
    providers: normalizeProviderSettings(source.providers, providerIds),
    updatedAt: Number(source.updatedAt || DEFAULT_SETTINGS.updatedAt),
  };
}

export async function upsertOAuthPhoneOrder(
  order: OAuthPhoneOrder,
  patch: Partial<OAuthPhoneTrackedOrder> = {},
): Promise<OAuthPhoneSettings> {
  const settings = await loadOAuthPhoneSettings();
  const now = Date.now();
  const id = trackedOrderId(order.providerId, order.activationId);
  const previous = settings.orders.find((item) => item.id === id);
  const nextOrder = normalizeTrackedOrder({
    ...previous,
    id,
    source: patch.source || previous?.source || 'local',
    providerId: order.providerId,
    activationId: order.activationId,
    phoneNumber: order.phoneNumber || previous?.phoneNumber || '',
    countryId: order.countryId || previous?.countryId || '',
    countryName: patch.countryName ?? previous?.countryName ?? '',
    countryIso: patch.countryIso ?? previous?.countryIso ?? '',
    serviceCode: order.serviceCode || previous?.serviceCode || '',
    cost: Number(order.cost || previous?.cost || 0),
    operator: order.operator || previous?.operator || '',
    status: patch.status || order.status || previous?.status || 'requested',
    timeoutSeconds: normalizeSmsTimeoutSeconds(patch.timeoutSeconds || previous?.timeoutSeconds || settings.smsTimeoutSeconds),
    createdAt: previous?.createdAt || order.createdAt || now,
    updatedAt: now,
    completedAt: patch.completedAt ?? previous?.completedAt ?? 0,
    lastCancelAt: patch.lastCancelAt ?? previous?.lastCancelAt ?? 0,
    cancelAttempts: patch.cancelAttempts ?? previous?.cancelAttempts ?? 0,
    lastCancelMessage: patch.lastCancelMessage ?? previous?.lastCancelMessage ?? '',
  });
  if (!nextOrder) {
    return settings;
  }
  const orders = [nextOrder, ...settings.orders.filter((item) => item.id !== id)];
  return saveOAuthPhoneSettings({ orders });
}

export async function updateOAuthPhoneTrackedOrder(
  providerId: OAuthPhoneProviderId,
  activationId: string,
  patch: Partial<OAuthPhoneTrackedOrder>,
): Promise<OAuthPhoneSettings> {
  const settings = await loadOAuthPhoneSettings();
  const id = trackedOrderId(providerId, activationId);
  const now = Date.now();
  const orders = settings.orders
    .map((order) => {
      if (order.id !== id) {
        return order;
      }
      return normalizeTrackedOrder({
        ...order,
        ...patch,
        updatedAt: now,
      });
    })
    .filter((order): order is OAuthPhoneTrackedOrder => Boolean(order));
  return saveOAuthPhoneSettings({ orders });
}

export function trackedOrderId(providerId: string, activationId: string): string {
  return `${providerId}:${activationId}`;
}

export function parseOAuthPhoneApiTargets(rawInput: string, existing: OAuthPhoneApiTarget[] = []): {
  targets: OAuthPhoneApiTarget[];
  errors: string[];
} {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const parsed = parseSmsRelayTargets(rawInput);
  const targets = parsed.targets.map((target) => {
    const rawInputLine = `${target.phone}----${target.url}`;
    const id = target.id || stableId(rawInputLine);
    const previous = existingById.get(id);
    return {
      id,
      rawInput: rawInputLine,
      phone: target.phone,
      url: target.url,
      disabled: previous?.disabled || false,
      disabledAt: previous?.disabledAt || 0,
      disabledReason: previous?.disabledReason || '',
      useCount: previous?.useCount || 0,
      lastUsedAt: previous?.lastUsedAt || 0,
      lastCodeAt: previous?.lastCodeAt || 0,
      lastMessage: previous?.lastMessage || '',
    };
  });
  return { targets, errors: parsed.errors };
}

function normalizeSelectedOffers(
  value: unknown,
  fallbackCountries: OAuthPhoneSelectedCountry[],
  fallbackServiceCode: string,
): OAuthPhoneSelectedOffer[] {
  const input = Array.isArray(value) ? value : [];
  const offers: OAuthPhoneSelectedOffer[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }
    const providerId = normalizeProviderId(item.providerId);
    const countryId = String(item.countryId || item.id || '').trim();
    const serviceCode = String(item.serviceCode || fallbackServiceCode).trim();
    const operator = String(item.operator || '').trim();
    const key = offerKey(providerId, countryId, serviceCode, operator, item.cost);
    if (!countryId || !serviceCode || seen.has(key)) {
      continue;
    }
    seen.add(key);
    offers.push({
      providerId,
      countryId,
      countryName: String(item.countryName || item.name || countryId).trim(),
      serviceCode,
      cost: normalizePriceLimit(item.cost),
      count: normalizeCount(item.count),
      operator,
      updatedAt: Number(item.updatedAt || 0),
    });
  }

  return offers.slice(0, 50);
}

function offerKey(
  providerId: OAuthPhoneProviderId,
  countryId: string,
  serviceCode: string,
  operator: unknown,
  cost: unknown,
): string {
  return [providerId, countryId, serviceCode, String(operator || ''), String(cost || '')].join('|');
}

export function enabledOAuthPhoneProviders(settings: OAuthPhoneSettings): OAuthPhoneProviderSettings[] {
  return [...settings.providers]
    .filter((provider) => provider.enabled && provider.apiKey.trim())
    .sort((left, right) => left.priority - right.priority);
}

export function maskOAuthPhoneApiKey(value: string): string {
  const key = value.trim();
  if (!key) {
    return '';
  }
  if (key.length <= 8) {
    return `${key.slice(0, 2)}***${key.slice(-2)}`;
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function normalizeProviderSettings(value: unknown, providerIds: Set<string>): OAuthPhoneProviderSettings[] {
  const input = Array.isArray(value) ? value : [];
  const byId = new Map<string, OAuthPhoneProviderSettings>();
  for (const item of input) {
    const provider = normalizeProviderSetting(item);
    if (provider && providerIds.has(provider.id)) {
      byId.set(provider.id, provider);
    }
  }

  return OAUTH_PHONE_PROVIDER_DEFINITIONS.map((definition, index) => {
    const existing = byId.get(definition.id);
    return existing || {
      id: definition.id,
      enabled: index === 0,
      apiKey: '',
      priority: index + 1,
      updatedAt: 0,
    };
  });
}

function normalizeProviderSetting(value: unknown): OAuthPhoneProviderSettings | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeProviderId(value.id);
  return {
    id,
    enabled: Boolean(value.enabled),
    apiKey: String(value.apiKey || '').trim(),
    priority: normalizePriority(value.priority),
    updatedAt: Number(value.updatedAt || 0),
  };
}

function normalizeProviderId(value: unknown): OAuthPhoneProviderId {
  if (value === 'herosms' || value === 'smspool' || value === 'tigersms') {
    return value;
  }
  return 'smsbower';
}

function normalizeSourceMode(value: unknown): OAuthPhoneSettings['sourceMode'] {
  return value === 'api' ? 'api' : 'provider';
}

function normalizeProviderMode(value: unknown): OAuthPhoneProviderSelectionMode {
  if (value === 'lowest-price' || value === 'highest-stock') {
    return value;
  }
  return 'priority';
}

function normalizeCountryIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/);
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 20);
}

function normalizeSelectedCountries(
  value: unknown,
  fallbackCountryIds: string[],
  fallbackProviderId: OAuthPhoneProviderId,
): OAuthPhoneSelectedCountry[] {
  const input = Array.isArray(value) ? value : [];
  const countries: OAuthPhoneSelectedCountry[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const englishName = String(item.englishName || '').trim();
    const chineseName = String(item.chineseName || '').trim();
    const name = String(item.name || chineseName || englishName || id).trim();
    countries.push({
      id,
      name,
      englishName,
      chineseName,
      providerId: normalizeProviderId(item.providerId || fallbackProviderId),
      updatedAt: Number(item.updatedAt || 0),
    });
  }

  if (countries.length || !fallbackCountryIds.length) {
    return countries.slice(0, 20);
  }

  return fallbackCountryIds.slice(0, 20).map((id) => ({
    id,
    name: id,
    englishName: '',
    chineseName: '',
    providerId: fallbackProviderId,
    updatedAt: 0,
  }));
}

function normalizeApiTargets(value: unknown, rawInput: string): OAuthPhoneApiTarget[] {
  const input = Array.isArray(value) ? value : [];
  const targets: OAuthPhoneApiTarget[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }
    const phone = String(item.phone || '').trim();
    const url = String(item.url || '').trim();
    if (!phone || !url) {
      continue;
    }
    const rawInputLine = String(item.rawInput || `${phone}----${url}`).trim();
    const id = String(item.id || stableId(rawInputLine)).trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    targets.push({
      id,
      rawInput: rawInputLine,
      phone,
      url,
      disabled: Boolean(item.disabled),
      disabledAt: Number(item.disabledAt || 0),
      disabledReason: String(item.disabledReason || ''),
      useCount: normalizeCount(item.useCount),
      lastUsedAt: Number(item.lastUsedAt || 0),
      lastCodeAt: Number(item.lastCodeAt || 0),
      lastMessage: String(item.lastMessage || ''),
    });
  }

  if (targets.length || !rawInput.trim()) {
    return targets.slice(0, 200);
  }
  return parseOAuthPhoneApiTargets(rawInput).targets.slice(0, 200);
}

function normalizeTrackedOrders(value: unknown): OAuthPhoneTrackedOrder[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const orders: OAuthPhoneTrackedOrder[] = [];
  for (const item of input) {
    const order = normalizeTrackedOrder(item);
    if (!order || seen.has(order.id)) {
      continue;
    }
    seen.add(order.id);
    orders.push(order);
  }
  return orders
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 120);
}

function normalizeTrackedOrder(value: unknown): OAuthPhoneTrackedOrder | null {
  if (!isRecord(value)) {
    return null;
  }
  const providerId = normalizeRuntimeProviderId(value.providerId);
  if (!providerId) {
    return null;
  }
  const activationId = String(value.activationId || '').trim();
  if (!activationId) {
    return null;
  }
  const status = normalizeOrderStatus(value.status);
  const createdAt = Number(value.createdAt || Date.now());
  const id = String(value.id || trackedOrderId(providerId, activationId));
  return {
    id,
    source: value.source === 'platform' ? 'platform' : 'local',
    providerId,
    activationId,
    phoneNumber: String(value.phoneNumber || ''),
    countryId: String(value.countryId || ''),
    countryName: String(value.countryName || ''),
    countryIso: String(value.countryIso || '').trim().toUpperCase(),
    serviceCode: String(value.serviceCode || ''),
    cost: normalizePriceLimit(value.cost),
    operator: String(value.operator || ''),
    status,
    timeoutSeconds: normalizeSmsTimeoutSeconds(value.timeoutSeconds),
    createdAt,
    updatedAt: Number(value.updatedAt || createdAt),
    completedAt: Number(value.completedAt || 0),
    lastCancelAt: Number(value.lastCancelAt || 0),
    cancelAttempts: normalizeCount(value.cancelAttempts),
    lastCancelMessage: String(value.lastCancelMessage || ''),
  };
}

function normalizeRuntimeProviderId(value: unknown): OAuthPhoneProviderId | '' {
  return value === 'smsbower' || value === 'herosms' || value === 'smspool' || value === 'tigersms' ? value : '';
}

function normalizeOrderStatus(value: unknown): OAuthPhoneTrackedOrder['status'] {
  return value === 'requested' ||
    value === 'waiting' ||
    value === 'received' ||
    value === 'completed' ||
    value === 'canceled' ||
    value === 'error'
    ? value
    : 'requested';
}

function normalizeMaxPrice(value: unknown): number {
  return normalizePriceLimit(value);
}

function normalizePriceLimit(value: unknown): number {
  const price = Number(value || 0);
  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }
  return Math.round(price * 10000) / 10000;
}

function normalizeSmsTimeoutSeconds(value: unknown): number {
  const seconds = Number(value || DEFAULT_SETTINGS.smsTimeoutSeconds);
  if (!Number.isFinite(seconds) || seconds < 15) {
    return DEFAULT_SETTINGS.smsTimeoutSeconds;
  }
  return Math.min(Math.round(seconds), 600);
}

function normalizeCount(value: unknown): number {
  const count = Number(value || 0);
  if (count === -1) {
    return -1;
  }
  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }
  return Math.floor(count);
}

function normalizePriority(value: unknown): number {
  const priority = Number(value || 0);
  if (!Number.isInteger(priority) || priority < 1) {
    return 99;
  }
  return Math.min(priority, 99);
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `oauth-phone-${(hash >>> 0).toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

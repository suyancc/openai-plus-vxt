import { createOAuthPhoneProvider } from './providers';
import { enabledOAuthPhoneProviders, loadOAuthPhoneSettings } from './state';
import type {
  OAuthPhoneBalance,
  OAuthPhoneCountry,
  OAuthPhonePriceOffer,
  OAuthPhoneProviderId,
  OAuthPhoneProviderSettings,
  OAuthPhoneProviderTestResult,
  OAuthPhoneSelectedOffer,
  OAuthPhoneSettings,
} from './types';

export interface OAuthPhonePricePreviewOffer extends OAuthPhonePriceOffer {
  countryName: string;
}

export interface OAuthPhoneRuntimeSelection {
  ok: boolean;
  message: string;
  settings: OAuthPhoneSettings;
  provider?: OAuthPhoneProviderSettings;
  offer?: OAuthPhoneSelectedOffer;
  candidates?: OAuthPhoneRuntimeCandidate[];
}

export interface OAuthPhoneRuntimeCandidate {
  provider: OAuthPhoneProviderSettings;
  offer: OAuthPhoneSelectedOffer;
}

export async function testOAuthPhoneProvider(providerId: OAuthPhoneProviderId): Promise<OAuthPhoneProviderTestResult> {
  const settings = await loadOAuthPhoneSettings();
  const providerSettings = settings.providers.find((provider) => provider.id === providerId);
  if (!providerSettings) {
    return { providerId, ok: false, message: '接码平台配置不存在' };
  }
  if (!providerSettings.apiKey.trim()) {
    return { providerId, ok: false, message: '请先填写 API key' };
  }

  try {
    const client = createOAuthPhoneProvider(providerId);
    const [balance, countries] = await Promise.all([
      client.getBalance(providerSettings),
      client.getCountries(providerSettings),
    ]);
    return {
      providerId,
      ok: true,
      message: `${client.definition.label} 可用，余额 ${formatBalance(balance)}，国家 ${countries.length} 个`,
      balance,
      countryCount: countries.length,
    };
  } catch (error) {
    return {
      providerId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchOAuthPhoneCountries(providerId: OAuthPhoneProviderId): Promise<{
  ok: boolean;
  message: string;
  countries: OAuthPhoneCountry[];
}> {
  const providerSettings = await loadProviderSettings(providerId);
  if (!providerSettings?.apiKey.trim()) {
    return { ok: false, message: '请先填写 API key', countries: [] };
  }
  try {
    const client = createOAuthPhoneProvider(providerId);
    const countries = await client.getCountries(providerSettings);
    return {
      ok: true,
      message: `已获取 ${countries.length} 个国家`,
      countries,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      countries: [],
    };
  }
}

export async function fetchOAuthPhoneOfferMatrix(): Promise<{
  ok: boolean;
  message: string;
  offers: OAuthPhonePricePreviewOffer[];
}> {
  const settings = await loadOAuthPhoneSettings();
  const providers = selectConfiguredProviders(settings);
  if (!providers.length) {
    return { ok: false, message: '没有可用接码平台，请启用平台并填写 API key', offers: [] };
  }
  if (!settings.serviceCode.trim()) {
    return { ok: false, message: '请先填写服务代码', offers: [] };
  }

  const offers: OAuthPhonePricePreviewOffer[] = [];
  const errors: string[] = [];
  for (const provider of providers) {
    const client = createOAuthPhoneProvider(provider.id);
    let countries: OAuthPhoneCountry[] = [];
    try {
      countries = await client.getCountries(provider);
    } catch (error) {
      errors.push(`${client.definition.label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const countryNames = new Map(countries.map((country) => [
      country.id,
      country.name || country.englishName || country.id,
    ]));
    let providerOffers: OAuthPhonePriceOffer[] = [];
    try {
      providerOffers = client.getDetailedPrices
        ? await client.getDetailedPrices(provider, settings.serviceCode)
        : [];
    } catch (error) {
      errors.push(`${client.definition.label}/完整报价: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (client.getDetailedPrices) {
      const selectedCountryIds = [...new Set([
        ...settings.countryIds,
        ...settings.selectedOffers
          .filter((offer) => offer.providerId === provider.id)
          .map((offer) => offer.countryId),
      ].filter(Boolean))];
      for (const countryId of selectedCountryIds) {
        try {
          const next = await client.getDetailedPrices(provider, settings.serviceCode, countryId);
          providerOffers.push(...next);
        } catch {
          // The global detailed table is still usable; country-specific detail is best-effort.
        }
      }
    }

    if (!providerOffers.length) {
      try {
        providerOffers = await client.getPrices(provider, '', settings.serviceCode);
      } catch {
        // Some compatible providers require the country parameter. Fall back to per-country calls.
      }
    }

    if (!providerOffers.length) {
      for (const country of countries) {
        try {
          const next = await client.getPrices(provider, country.id, settings.serviceCode);
          providerOffers.push(...next);
        } catch {
          continue;
        }
      }
    }

    offers.push(...dedupeOffers(providerOffers).map((offer) => ({
      ...offer,
      countryName: countryNames.get(offer.countryId) || offer.countryId,
    })));
  }

  const validOffers = dedupeOffers(offers).filter(isUsableOffer);
  const sorted = sortOffers({
    ...settings,
    providerMode: 'lowest-price',
  }, validOffers);
  if (sorted.length) {
    return {
      ok: true,
      message: `可用报价 ${sorted.length} 个${formatPriceRangeMessage(settings)}`,
      offers: sorted,
    };
  }
  return {
    ok: false,
    message: errors.length ? `未找到可用报价；${errors.slice(0, 3).join('；')}` : '未找到符合条件的报价',
    offers: [],
  };
}

function dedupeOffers<T extends OAuthPhonePriceOffer>(offers: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const offer of offers) {
    const key = [
      offer.providerId,
      offer.countryId,
      offer.serviceCode,
      offer.operator,
      formatOfferPrice(offer.cost),
    ].join('|');
    const previous = byKey.get(key);
    if (!previous || offer.count > previous.count) {
      byKey.set(key, offer);
    }
  }
  return [...byKey.values()];
}

function formatOfferPrice(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '';
}

export async function fetchOAuthPhonePricePreview(): Promise<{
  ok: boolean;
  message: string;
  offers: OAuthPhonePricePreviewOffer[];
}> {
  return fetchOAuthPhonePrices({});
}

export async function selectOAuthPhoneOfferForRuntime(): Promise<OAuthPhoneRuntimeSelection> {
  const settings = await loadOAuthPhoneSettings();
  if (!settings.enabled) {
    return { ok: false, message: 'OAuth 手机接码模块未启用', settings };
  }
  if (!settings.serviceCode.trim()) {
    return { ok: false, message: '请先设置 OAuth 手机接码服务代码', settings };
  }
  const providers = selectConfiguredProviders(settings);
  if (!providers.length) {
    return { ok: false, message: '没有可用接码平台，请启用平台并填写 API key', settings };
  }
  const offers = sortOffers(settings, settings.selectedOffers)
    .filter((offer) => offer.cost > 0)
    .filter((offer) => settings.minPrice > 0 ? offer.cost >= settings.minPrice : true)
    .filter((offer) => settings.maxPrice > 0 ? offer.cost <= settings.maxPrice : true)
    .filter((offer) => providers.some((provider) => provider.id === offer.providerId));
  if (!offers.length) {
    return { ok: false, message: '没有已选择且符合价格范围的 OAuth 接码报价', settings };
  }
  const candidates: OAuthPhoneRuntimeCandidate[] = [];
  for (const offer of offers) {
    const provider = providers.find((item) => item.id === offer.providerId);
    if (provider) {
      candidates.push({ provider, offer });
    }
  }
  const first = candidates[0];
  if (!first) {
    return { ok: false, message: '已选择报价对应的平台未启用', settings };
  }
  return {
    ok: true,
    message: `${first.provider.id}/${first.offer.countryName || first.offer.countryId} $${first.offer.cost}，候选 ${candidates.length} 个`,
    settings,
    provider: first.provider,
    offer: first.offer,
    candidates,
  };
}

export async function fetchOAuthPhonePrices(overrides: Partial<OAuthPhoneSettings> = {}): Promise<{
  ok: boolean;
  message: string;
  offers: OAuthPhonePricePreviewOffer[];
}> {
  const loadedSettings = await loadOAuthPhoneSettings();
  const settings = {
    ...loadedSettings,
    ...overrides,
  };
  settings.countryIds = settings.countryIds.length
    ? settings.countryIds
    : (overrides.selectedOffers || loadedSettings.selectedOffers).map((offer) => offer.countryId);
  settings.selectedCountries = settings.selectedCountries.length
    ? settings.selectedCountries
    : settings.selectedOffers.map((offer) => ({
      id: offer.countryId,
      name: offer.countryName,
      englishName: '',
      chineseName: '',
      providerId: offer.providerId,
      updatedAt: offer.updatedAt,
    }));
  const validation = validatePriceQuery(settings);
  if (validation) {
    return { ok: false, message: validation, offers: [] };
  }

  const providers = selectConfiguredProviders(settings);
  if (!providers.length) {
    return { ok: false, message: '没有可用接码平台，请启用平台并填写 API key', offers: [] };
  }

  const countryNames = new Map(settings.selectedCountries.map((country) => [country.id, country.name]));
  const offers: OAuthPhonePricePreviewOffer[] = [];
  const errors: string[] = [];
  for (const provider of providers) {
    const client = createOAuthPhoneProvider(provider.id);
    for (const countryId of settings.countryIds) {
      try {
        const next = await client.getPrices(provider, countryId, settings.serviceCode);
        offers.push(...next.map((offer) => ({
          ...offer,
          countryName: countryNames.get(offer.countryId) || countryNames.get(countryId) || offer.countryId,
        })));
      } catch (error) {
        errors.push(`${client.definition.label}/${countryId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const validOffers = offers.filter(isUsableOffer);
  const filtered = validOffers
    .filter((offer) => settings.minPrice > 0 ? offer.cost >= settings.minPrice : true)
    .filter((offer) => settings.maxPrice > 0 ? offer.cost <= settings.maxPrice : true);
  const sorted = sortOffers(settings, filtered);
  if (sorted.length) {
    return {
      ok: true,
      message: `可用报价 ${sorted.length} 个${formatPriceRangeMessage(settings)}`,
      offers: sorted,
    };
  }
  return {
    ok: false,
    message: errors.length ? `未找到可用报价；${errors.slice(0, 3).join('；')}` : '未找到符合条件的报价',
    offers: [],
  };
}

export function sortOffers<T extends Pick<OAuthPhonePriceOffer, 'providerId' | 'cost' | 'count'>>(settings: OAuthPhoneSettings, offers: T[]): T[] {
  const priority = new Map(settings.providers.map((provider) => [provider.id, provider.priority]));
  return [...offers].sort((left, right) => {
    if (settings.providerMode === 'lowest-price') {
      return left.cost - right.cost || right.count - left.count;
    }
    if (settings.providerMode === 'highest-stock') {
      return right.count - left.count || left.cost - right.cost;
    }
    return (priority.get(left.providerId) || 99) - (priority.get(right.providerId) || 99) ||
      left.cost - right.cost;
  });
}

function isUsableOffer(offer: Pick<OAuthPhonePriceOffer, 'cost' | 'count'>): boolean {
  return offer.cost > 0 && offer.count !== 0;
}

function selectConfiguredProviders(settings: OAuthPhoneSettings): OAuthPhoneProviderSettings[] {
  const providers = enabledOAuthPhoneProviders(settings);
  if (settings.providerMode !== 'priority') {
    return providers;
  }
  const active = providers.find((provider) => provider.id === settings.activeProviderId);
  return active ? [active, ...providers.filter((provider) => provider.id !== active.id)] : providers;
}

async function loadProviderSettings(providerId: OAuthPhoneProviderId): Promise<OAuthPhoneProviderSettings | undefined> {
  const settings = await loadOAuthPhoneSettings();
  return settings.providers.find((provider) => provider.id === providerId);
}

function validatePriceQuery(settings: OAuthPhoneSettings): string {
  if (!settings.serviceCode.trim()) {
    return '请先填写服务代码';
  }
  if (!settings.countryIds.length) {
    return '请至少填写一个国家 ID';
  }
  return '';
}

function formatBalance(balance: OAuthPhoneBalance): string {
  return `${balance.amount}${balance.currency ? ` ${balance.currency}` : ''}`;
}

function formatPriceRangeMessage(settings: OAuthPhoneSettings): string {
  const parts = [
    settings.minPrice > 0 ? `最低价 ${settings.minPrice}` : '',
    settings.maxPrice > 0 ? `最高价 ${settings.maxPrice}` : '',
  ].filter(Boolean);
  return parts.length ? `，已过滤${parts.join(' / ')}` : '';
}

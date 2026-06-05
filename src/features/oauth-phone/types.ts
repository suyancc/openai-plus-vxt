export type OAuthPhoneProviderId = 'smsbower' | 'herosms' | 'smspool' | 'tigersms' | 'foxsms';

export type OAuthPhoneRuntimeProviderId = OAuthPhoneProviderId | 'api';

export type OAuthPhoneSourceMode = 'provider' | 'api';

export type OAuthPhoneProviderSelectionMode = 'priority' | 'lowest-price' | 'highest-stock';

export type OAuthPhoneOrderStatus =
  | 'idle'
  | 'requested'
  | 'waiting'
  | 'received'
  | 'completed'
  | 'canceled'
  | 'error';

export type OAuthPhoneTrackedOrderSource = 'local' | 'platform';

export type OAuthPhoneActivationStatus = 'ready' | 'retry' | 'complete' | 'cancel';

export interface OAuthPhoneProviderDefinition {
  id: OAuthPhoneProviderId;
  label: string;
  baseUrl: string;
  supportsV2: boolean;
  defaultServiceCode: string;
  priceCurrency: 'USD' | 'RUB' | 'CNY';
}

export interface OAuthPhoneProviderSettings {
  id: OAuthPhoneProviderId;
  enabled: boolean;
  apiKey: string;
  priority: number;
  updatedAt: number;
}

export interface OAuthPhoneSelectedCountry {
  id: string;
  name: string;
  englishName: string;
  chineseName: string;
  providerId: OAuthPhoneProviderId;
  updatedAt: number;
}

export interface OAuthPhoneSelectedOffer {
  providerId: OAuthPhoneProviderId;
  countryId: string;
  countryName: string;
  serviceCode: string;
  cost: number;
  count: number;
  operator: string;
  updatedAt: number;
}

export interface OAuthPhoneApiTarget {
  id: string;
  rawInput: string;
  phone: string;
  url: string;
  disabled: boolean;
  disabledAt: number;
  disabledReason: string;
  useCount: number;
  lastUsedAt: number;
  lastCodeAt: number;
  lastMessage: string;
}

export interface OAuthPhoneTrackedOrder {
  id: string;
  source: OAuthPhoneTrackedOrderSource;
  providerId: OAuthPhoneProviderId;
  activationId: string;
  phoneNumber: string;
  countryId: string;
  countryName: string;
  countryIso: string;
  serviceCode: string;
  cost: number;
  operator: string;
  status: OAuthPhoneOrderStatus;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
  lastCancelAt: number;
  cancelAttempts: number;
  lastCancelMessage: string;
}

export interface OAuthPhoneSettings {
  enabled: boolean;
  sourceMode: OAuthPhoneSourceMode;
  providerMode: OAuthPhoneProviderSelectionMode;
  activeProviderId: OAuthPhoneProviderId;
  serviceCode: string;
  countryIds: string[];
  selectedCountries: OAuthPhoneSelectedCountry[];
  selectedOffers: OAuthPhoneSelectedOffer[];
  minPrice: number;
  maxPrice: number;
  smsTimeoutSeconds: number;
  rawApiTargets: string;
  apiTargets: OAuthPhoneApiTarget[];
  orders: OAuthPhoneTrackedOrder[];
  providers: OAuthPhoneProviderSettings[];
  updatedAt: number;
}

export interface OAuthPhoneCountry {
  id: string;
  name: string;
  englishName: string;
  chineseName: string;
  raw: unknown;
}

export interface OAuthPhoneBalance {
  providerId: OAuthPhoneProviderId;
  amount: number;
  currency: string;
  raw: string;
}

export interface OAuthPhonePriceOffer {
  providerId: OAuthPhoneProviderId;
  countryId: string;
  serviceCode: string;
  cost: number;
  count: number;
  operator: string;
  raw: unknown;
}

export interface OAuthPhoneNumberRequest {
  countryId: string;
  countryName?: string;
  serviceCode: string;
  maxPrice?: number;
  operator?: string;
  expectedCost?: number;
  debug?: (stage: string, data: Record<string, unknown>) => void;
}

export interface OAuthPhoneOrder {
  providerId: OAuthPhoneRuntimeProviderId;
  activationId: string;
  phoneNumber: string;
  countryId: string;
  serviceCode: string;
  cost: number;
  operator: string;
  status: OAuthPhoneOrderStatus;
  createdAt: number;
  updatedAt: number;
  raw: unknown;
}

export interface OAuthPhoneSmsStatus {
  providerId: OAuthPhoneProviderId;
  activationId: string;
  status: OAuthPhoneOrderStatus;
  code: string;
  text: string;
  message: string;
  raw: unknown;
}

export interface OAuthPhoneProviderClient {
  definition: OAuthPhoneProviderDefinition;
  getBalance(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneBalance>;
  getCountries(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneCountry[]>;
  getPrices(
    settings: OAuthPhoneProviderSettings,
    countryId: string,
    serviceCode: string,
  ): Promise<OAuthPhonePriceOffer[]>;
  getDetailedPrices?(
    settings: OAuthPhoneProviderSettings,
    serviceCode: string,
    countryId?: string,
  ): Promise<OAuthPhonePriceOffer[]>;
  getActiveOrders?(settings: OAuthPhoneProviderSettings): Promise<OAuthPhoneOrder[]>;
  requestNumber(
    settings: OAuthPhoneProviderSettings,
    request: OAuthPhoneNumberRequest,
  ): Promise<OAuthPhoneOrder>;
  getSms(settings: OAuthPhoneProviderSettings, order: OAuthPhoneOrder): Promise<OAuthPhoneSmsStatus>;
  setStatus(
    settings: OAuthPhoneProviderSettings,
    order: OAuthPhoneOrder,
    status: OAuthPhoneActivationStatus,
  ): Promise<{ ok: boolean; message: string; raw: unknown }>;
}

export interface OAuthPhoneProviderTestResult {
  providerId: OAuthPhoneProviderId;
  ok: boolean;
  message: string;
  balance?: OAuthPhoneBalance;
  countryCount?: number;
}

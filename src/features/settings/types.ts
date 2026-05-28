import type { AddressProfile } from '../address-autofill/types';

export interface ExtensionSettings {
  addressAutofill: AddressAutofillSettings;
  updatedAt: number;
}

export interface AddressAutofillSettings {
  payOpenAiEnabled: boolean;
  payPalSignupEnabled: boolean;
  countryCode: string;
  city: string;
  lastAddress: AddressProfile | null;
  updatedAt: number;
}

export type CookieClearTarget = 'paypal' | 'chatgpt';

export interface ClearDomainCookiesMessage {
  type: 'opx:clear-domain-cookies';
  target: CookieClearTarget;
}

export interface ClearDomainCookiesResponse {
  ok: boolean;
  target: CookieClearTarget;
  domains: string[];
  removed: number;
  failed: number;
  message: string;
}

export interface AutomationFinishCleanupMessage {
  type: 'opx:automation-finish-cleanup';
  cookieTargets?: CookieClearTarget[];
  closeTabs?: boolean;
  windowId?: number;
  closeDelayMs?: number;
}

export interface AutomationFinishCleanupResponse {
  ok: boolean;
  cookieResults: ClearDomainCookiesResponse[];
  closeTabsScheduled: boolean;
  message: string;
}

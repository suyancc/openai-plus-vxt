import { scopedStorageKey } from '../../app/storage-scope';
import type { AddressProfile } from '../address-autofill/types';
import type { AddressAutofillSettings, ExtensionSettings } from './types';

const SETTINGS_STORAGE_KEY = 'opx.extension.settings';

const DEFAULT_ADDRESS_AUTOFILL_SETTINGS: AddressAutofillSettings = {
  payOpenAiEnabled: true,
  payPalSignupEnabled: true,
  countryCode: 'US',
  city: '',
  lastAddress: null,
  updatedAt: 0,
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  addressAutofill: DEFAULT_ADDRESS_AUTOFILL_SETTINGS,
  updatedAt: 0,
};

const SUPPORTED_COUNTRY_CODES = new Set([
  'RANDOM',
  'US',
  'CA',
  'AU',
  'JP',
  'TW',
  'KR',
  'HK',
  'GB',
  'DE',
  'SG',
  'FR',
  'IT',
  'ES',
  'NL',
  'MY',
  'RU',
  'CN',
  'TH',
  'PH',
  'AR',
  'TR',
  'VN',
]);

export async function loadExtensionSettings(): Promise<ExtensionSettings> {
  const storageKey = scopedStorageKey(SETTINGS_STORAGE_KEY);
  const data = await browser.storage.local.get(storageKey);
  return normalizeExtensionSettings(data[storageKey]);
}

export async function saveAddressAutofillSettings(
  patch: Partial<AddressAutofillSettings>,
): Promise<AddressAutofillSettings> {
  const current = await loadExtensionSettings();
  const addressAutofill = normalizeAddressAutofillSettings({
    ...current.addressAutofill,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeExtensionSettings({
    ...current,
    addressAutofill,
    updatedAt: Date.now(),
  });
  await browser.storage.local.set({ [scopedStorageKey(SETTINGS_STORAGE_KEY)]: next });
  return next.addressAutofill;
}

export async function loadAddressAutofillSettings(): Promise<AddressAutofillSettings> {
  return (await loadExtensionSettings()).addressAutofill;
}

export function normalizeExtensionSettings(value: unknown): ExtensionSettings {
  const source = isRecord(value) ? value : {};
  return {
    addressAutofill: normalizeAddressAutofillSettings(source.addressAutofill),
    updatedAt: Number(source.updatedAt || DEFAULT_SETTINGS.updatedAt),
  };
}

export function normalizeAddressAutofillSettings(value: unknown): AddressAutofillSettings {
  const source = isRecord(value) ? value : {};
  const payOpenAiEnabled =
    source.payOpenAiEnabled === undefined
      ? DEFAULT_ADDRESS_AUTOFILL_SETTINGS.payOpenAiEnabled
      : Boolean(source.payOpenAiEnabled);
  const payPalSignupEnabled =
    source.payPalSignupEnabled === undefined
      ? DEFAULT_ADDRESS_AUTOFILL_SETTINGS.payPalSignupEnabled
      : Boolean(source.payPalSignupEnabled);
  return {
    payOpenAiEnabled,
    payPalSignupEnabled,
    countryCode: normalizeCountryCode(source.countryCode || source.country),
    city: String(source.city || source.region || DEFAULT_ADDRESS_AUTOFILL_SETTINGS.city),
    lastAddress: normalizeAddress(source.lastAddress),
    updatedAt: Number(source.updatedAt || DEFAULT_ADDRESS_AUTOFILL_SETTINGS.updatedAt),
  };
}

function normalizeAddress(value: unknown): AddressProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const line1 = String(value.line1 || '').trim();
  const city = String(value.city || '').trim();
  const countryCode = String(value.countryCode || value.country || 'US').trim().toUpperCase();
  const rawState = String(value.state || '').trim();
  const state = countryCode === 'US' ? rawState.toUpperCase() : rawState;
  const postalCode = String(value.postalCode || '').trim();
  if (!line1 || !city || !state || !postalCode) {
    return null;
  }

  return {
    id: String(value.id || `${Date.now()}`),
    fullName: String(value.fullName || '').trim(),
    line1,
    line2: String(value.line2 || '').trim(),
    city,
    state,
    stateFull: String(value.stateFull || '').trim(),
    postalCode,
    countryCode,
    countryLabel: String(value.countryLabel || '').trim(),
    countryPath: String(value.countryPath || '').trim(),
    phone: String(value.phone || '').trim(),
    identity: normalizeIdentity(value.identity),
    employment: normalizeEmployment(value.employment),
    creditCard: normalizeCreditCard(value.creditCard),
    source: value.source === 'fallback' ? 'fallback' : 'meiguodizhi',
    fetchedAt: Number(value.fetchedAt || 0),
  };
}

function normalizeIdentity(value: unknown): AddressProfile['identity'] {
  const source = isRecord(value) ? value : {};
  return {
    gender: String(source.gender || '').trim(),
    title: String(source.title || '').trim(),
    birthday: String(source.birthday || '').trim(),
    username: String(source.username || '').trim(),
    password: String(source.password || '').trim(),
    temporaryMail: String(source.temporaryMail || '').trim(),
    system: String(source.system || '').trim(),
    userAgent: String(source.userAgent || '').trim(),
    website: String(source.website || '').trim(),
    securityQuestion: String(source.securityQuestion || '').trim(),
    securityAnswer: String(source.securityAnswer || '').trim(),
  };
}

function normalizeEmployment(value: unknown): AddressProfile['employment'] {
  const source = isRecord(value) ? value : {};
  return {
    educationalBackground: String(source.educationalBackground || '').trim(),
    occupation: String(source.occupation || '').trim(),
    employmentStatus: String(source.employmentStatus || '').trim(),
    monthlySalary: String(source.monthlySalary || '').trim(),
    companySize: String(source.companySize || '').trim(),
    companyName: String(source.companyName || '').trim(),
  };
}

function normalizeCreditCard(value: unknown): AddressProfile['creditCard'] {
  const source = isRecord(value) ? value : {};
  const number = String(source.number || '').replace(/\D/g, '');
  const last4 = String(source.last4 || number.slice(-4) || '').replace(/\D/g, '').slice(-4);
  return {
    type: String(source.type || '').trim(),
    number,
    cvv: String(source.cvv || '').trim(),
    expires: String(source.expires || '').trim(),
    last4,
    maskedNumber: String(source.maskedNumber || (last4 ? `**** **** **** ${last4}` : '')).trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function normalizeCountryCode(value: unknown): string {
  const code = String(value || DEFAULT_ADDRESS_AUTOFILL_SETTINGS.countryCode).trim().toUpperCase();
  return SUPPORTED_COUNTRY_CODES.has(code) ? code : DEFAULT_ADDRESS_AUTOFILL_SETTINGS.countryCode;
}

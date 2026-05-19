import { DEFAULT_CHECKOUT_OPTIONS, normalizeCheckoutOptions } from '../features/link-extractor/checkout';
import type { FeatureTab } from './types';
import type { LinkExtractorState } from '../features/link-extractor/types';
import type { AccountInputMode, RegisterState } from '../features/register/types';
import type { SmsCodeRecord, SmsRelayState } from '../features/sms/types';

export const DEFAULT_API_BASE = 'http://127.0.0.1:8787';

const STORAGE_KEY = 'opx.registerAssist.state';

interface AppState {
  activeTab: FeatureTab;
  panelCollapsed: boolean;
  register: RegisterState;
  linkExtractor: LinkExtractorState;
  smsRelay: SmsRelayState;
}

const DEFAULT_REGISTER_STATE: RegisterState = {
  rawInput: '',
  email: '',
  accountLine: '',
  inputMode: 'empty',
  autoOtp: false,
  apiBase: DEFAULT_API_BASE,
  otpRequestedAt: 0,
  updatedAt: 0,
};

const DEFAULT_LINK_STATE: LinkExtractorState = {
  checkoutOptions: DEFAULT_CHECKOUT_OPTIONS,
  updatedAt: 0,
};

const DEFAULT_SMS_RELAY_STATE: SmsRelayState = {
  rawInput: '',
  history: [],
  updatedAt: 0,
};

const DEFAULT_STATE: AppState = {
  activeTab: 'register',
  panelCollapsed: false,
  register: DEFAULT_REGISTER_STATE,
  linkExtractor: DEFAULT_LINK_STATE,
  smsRelay: DEFAULT_SMS_RELAY_STATE,
};

export async function loadAppState(): Promise<AppState> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return normalizeAppState(data[STORAGE_KEY]);
}

export async function saveActiveTab(activeTab: FeatureTab): Promise<AppState> {
  const current = await loadAppState();
  const next = normalizeAppState({ ...current, activeTab });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function savePanelCollapsed(panelCollapsed: boolean): Promise<AppState> {
  const current = await loadAppState();
  const next = normalizeAppState({ ...current, panelCollapsed });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function loadRegisterState(): Promise<RegisterState> {
  return (await loadAppState()).register;
}

export async function saveRegisterState(patch: Partial<RegisterState>): Promise<RegisterState> {
  const current = await loadAppState();
  const register = normalizeRegisterState({
    ...current.register,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, register });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.register;
}

export async function loadLinkExtractorState(): Promise<LinkExtractorState> {
  return (await loadAppState()).linkExtractor;
}

export async function saveLinkExtractorState(patch: Partial<LinkExtractorState>): Promise<LinkExtractorState> {
  const current = await loadAppState();
  const linkExtractor = normalizeLinkExtractorState({
    ...current.linkExtractor,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, linkExtractor });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.linkExtractor;
}

export async function loadSmsRelayState(): Promise<SmsRelayState> {
  return (await loadAppState()).smsRelay;
}

export async function saveSmsRelayState(patch: Partial<SmsRelayState>): Promise<SmsRelayState> {
  const current = await loadAppState();
  const smsRelay = normalizeSmsRelayState({
    ...current.smsRelay,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, smsRelay });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.smsRelay;
}

export function isFeatureTab(value: string): value is FeatureTab {
  return value === 'register' || value === 'link' || value === 'address' || value === 'payment' || value === 'sms';
}

function normalizeAppState(value: unknown): AppState {
  const source = isRecord(value) ? value : {};
  const registerSource = isRecord(source.register) ? source.register : source;
  const linkSource = isRecord(source.linkExtractor) ? source.linkExtractor : source;
  const smsRelaySource = isRecord(source.smsRelay) ? source.smsRelay : DEFAULT_SMS_RELAY_STATE;
  return {
    activeTab: isFeatureTab(String(source.activeTab || '')) ? source.activeTab as FeatureTab : DEFAULT_STATE.activeTab,
    panelCollapsed: Boolean(source.panelCollapsed),
    register: normalizeRegisterState(registerSource),
    linkExtractor: normalizeLinkExtractorState(linkSource),
    smsRelay: normalizeSmsRelayState(smsRelaySource),
  };
}

function normalizeRegisterState(value: unknown): RegisterState {
  const source = isRecord(value) ? value : {};
  return {
    rawInput: String(source.rawInput || DEFAULT_REGISTER_STATE.rawInput),
    email: String(source.email || DEFAULT_REGISTER_STATE.email),
    accountLine: String(source.accountLine || DEFAULT_REGISTER_STATE.accountLine),
    inputMode: normalizeInputMode(source.inputMode),
    autoOtp: Boolean(source.autoOtp),
    apiBase: String(source.apiBase || DEFAULT_REGISTER_STATE.apiBase),
    otpRequestedAt: Number(source.otpRequestedAt || DEFAULT_REGISTER_STATE.otpRequestedAt),
    updatedAt: Number(source.updatedAt || DEFAULT_REGISTER_STATE.updatedAt),
  };
}

function normalizeLinkExtractorState(value: unknown): LinkExtractorState {
  const source = isRecord(value) ? value : {};
  return {
    checkoutOptions: normalizeCheckoutOptions(source.checkoutOptions || DEFAULT_LINK_STATE.checkoutOptions),
    updatedAt: Number(source.updatedAt || DEFAULT_LINK_STATE.updatedAt),
  };
}

function normalizeSmsRelayState(value: unknown): SmsRelayState {
  const source = isRecord(value) ? value : {};
  const history = Array.isArray(source.history)
    ? source.history.map(normalizeSmsCodeRecord).filter((item): item is SmsCodeRecord => Boolean(item))
    : DEFAULT_SMS_RELAY_STATE.history;
  return {
    rawInput: String(source.rawInput || DEFAULT_SMS_RELAY_STATE.rawInput),
    history,
    updatedAt: Number(source.updatedAt || DEFAULT_SMS_RELAY_STATE.updatedAt),
  };
}

function normalizeSmsCodeRecord(value: unknown): SmsCodeRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const phone = String(value.phone || '').trim();
  const code = String(value.code || '').trim();
  if (!phone || !code) {
    return null;
  }

  const receivedAt = Number(value.receivedAt || 0) || Date.now();
  return {
    id: String(value.id || `${phone}-${code}-${receivedAt}`),
    phone,
    code,
    message: String(value.message || '').trim(),
    receivedAt,
  };
}

function normalizeInputMode(value: unknown): AccountInputMode {
  return value === 'email' || value === 'outlook-line' || value === 'invalid' ? value : 'empty';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

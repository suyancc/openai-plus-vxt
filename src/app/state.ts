import {
  DEFAULT_CHECKOUT_OPTIONS,
  DEFAULT_CHECKOUT_EXTRACT_MODE,
  normalizeCheckoutExtractMode,
  normalizeCheckoutOptions,
} from '../features/link-extractor/checkout';
import type { FeatureTab } from './types';
import type {
  AutomationEmailAccount,
  AutomationGeneratedFileRecord,
  AutomationGeneratedFilesState,
  AutomationEmailSelectionMode,
  AutomationLogEntry,
  AutomationOAuthExtractMode,
  AutomationRegistrationMode,
  AutomationRunState,
  AutomationSettings,
  AutomationSmsSelectionMode,
  AutomationSmsSourceMode,
  AutomationSmsTarget,
  AutomationState,
  AutomationStepRecord,
  AutomationStepStatus,
} from '../features/automation/types';
import { createDefaultStepRecords } from '../features/automation/steps';
import type { LinkExtractorState } from '../features/link-extractor/types';
import type { OAuthState } from '../features/oauth/types';
import type { AccountInputMode, RegisterState } from '../features/register/types';
import type { SmsCodeRecord, SmsRelayState } from '../features/sms/types';
import { scopedStorageKey } from './storage-scope';

export const DEFAULT_API_BASE = 'http://127.0.0.1:8787';

const STORAGE_KEY = 'opx.registerAssist.state';

interface AppState {
  activeTab: FeatureTab;
  panelCollapsed: boolean;
  register: RegisterState;
  linkExtractor: LinkExtractorState;
  oauth: OAuthState;
  smsRelay: SmsRelayState;
  automation: AutomationState;
}

const DEFAULT_REGISTER_STATE: RegisterState = {
  rawInput: '',
  email: '',
  accountLine: '',
  inputMode: 'empty',
  autoOtp: false,
  apiBase: DEFAULT_API_BASE,
  otpRequestedAt: 0,
  otpAutoPending: false,
  otpAutoRunning: false,
  otpJobId: '',
  otpLastMessage: '',
  otpLastStartedAt: 0,
  updatedAt: 0,
};

const DEFAULT_LINK_STATE: LinkExtractorState = {
  checkoutOptions: DEFAULT_CHECKOUT_OPTIONS,
  checkoutExtractMode: DEFAULT_CHECKOUT_EXTRACT_MODE,
  updatedAt: 0,
};

const DEFAULT_SMS_RELAY_STATE: SmsRelayState = {
  rawInput: '',
  history: [],
  updatedAt: 0,
};

const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  registrationMode: 'email',
  rawEmails: '',
  rawSms: '',
  emailSelectionMode: 'next',
  specifiedEmailId: '',
  smsSourceMode: 'api',
  smsSelectionMode: 'random',
  batchAccountLimit: 1,
  stopOnError: true,
  autoOpenCheckout: true,
  debugMode: false,
  oauthExtractMode: 'email',
  checkoutOptions: {},
  checkoutExtractMode: DEFAULT_CHECKOUT_EXTRACT_MODE,
};

const DEFAULT_AUTOMATION_RUN: AutomationRunState = {
  running: false,
  paused: false,
  currentStepId: '',
  selectedEmailId: '',
  selectedSmsId: '',
  selectedRegisterPhoneId: '',
  registerPhoneSource: '',
  registerPhoneNumber: '',
  registerPhoneCountryId: '',
  registerPhoneCountryIso: '',
  registerPhoneServiceCode: '',
  registerPhoneActivationId: '',
  registerPhoneOperator: '',
  registerPhoneCost: 0,
  checkoutUrl: '',
  sessionEmail: '',
  targetTabId: 0,
  targetWindowId: 0,
  startedAt: 0,
  finishedAt: 0,
};

const DEFAULT_AUTOMATION_GENERATED_FILES: AutomationGeneratedFilesState = {
  records: [],
  sub2apiJson: '',
  cpaJson: '',
  updatedAt: 0,
};

const DEFAULT_AUTOMATION_STATE: AutomationState = {
  settings: DEFAULT_AUTOMATION_SETTINGS,
  emails: [],
  smsTargets: [],
  steps: createDefaultStepRecords(),
  logs: [],
  run: DEFAULT_AUTOMATION_RUN,
  generatedFiles: DEFAULT_AUTOMATION_GENERATED_FILES,
  updatedAt: 0,
};

const DEFAULT_OAUTH_STATE: OAuthState = {
  codeVerifier: '',
  codeChallenge: '',
  state: '',
  redirectUri: 'http://localhost:1455/auth/callback',
  authUrl: '',
  email: '',
  password: '',
  startedAt: 0,
  callbackUrl: '',
  codeParam: '',
  exchangeStatus: 'idle',
  exchangeMessage: '',
  exportSource: '',
  phoneVerification: {
    status: 'idle',
    providerId: '',
    countryId: '',
    countryName: '',
    countryIso: '',
    serviceCode: '',
    cost: 0,
    operator: '',
    activationId: '',
    phoneNumber: '',
    smsCode: '',
    message: '',
    startedAt: 0,
    updatedAt: 0,
    logs: [],
  },
  credentials: null,
  cpaJson: '',
  sub2apiJson: '',
  updatedAt: 0,
};

const DEFAULT_STATE: AppState = {
  activeTab: 'register',
  panelCollapsed: false,
  register: DEFAULT_REGISTER_STATE,
  linkExtractor: DEFAULT_LINK_STATE,
  oauth: DEFAULT_OAUTH_STATE,
  smsRelay: DEFAULT_SMS_RELAY_STATE,
  automation: DEFAULT_AUTOMATION_STATE,
};

export async function loadAppState(): Promise<AppState> {
  const storageKey = scopedStorageKey(STORAGE_KEY);
  const data = await browser.storage.local.get(storageKey);
  return normalizeAppState(data[storageKey]);
}

export async function saveActiveTab(activeTab: FeatureTab): Promise<AppState> {
  const current = await loadAppState();
  const next = normalizeAppState({ ...current, activeTab });
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
  return next;
}

export async function savePanelCollapsed(panelCollapsed: boolean): Promise<AppState> {
  const current = await loadAppState();
  const next = normalizeAppState({ ...current, panelCollapsed });
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
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
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
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
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
  return next.linkExtractor;
}

export async function loadOAuthState(): Promise<OAuthState> {
  return (await loadAppState()).oauth;
}

export async function saveOAuthState(patch: Partial<OAuthState>): Promise<OAuthState> {
  const current = await loadAppState();
  const oauth = normalizeOAuthState({
    ...current.oauth,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, oauth });
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
  return next.oauth;
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
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
  return next.smsRelay;
}

export async function loadAutomationState(): Promise<AutomationState> {
  return (await loadAppState()).automation;
}

export async function saveAutomationState(patch: Partial<AutomationState>): Promise<AutomationState> {
  const current = await loadAppState();
  const automation = normalizeAutomationState({
    ...current.automation,
    ...patch,
    settings: patch.settings ? patch.settings : current.automation.settings,
    run: patch.run ? patch.run : current.automation.run,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, automation });
  await browser.storage.local.set({ [scopedStorageKey(STORAGE_KEY)]: next });
  return next.automation;
}

export function isFeatureTab(value: string): value is FeatureTab {
  return (
    value === 'register' ||
    value === 'automation' ||
    value === 'link' ||
    value === 'oauth' ||
    value === 'address' ||
    value === 'sms' ||
    value === 'settings'
  );
}

function normalizeAppState(value: unknown): AppState {
  const source = isRecord(value) ? value : {};
  const registerSource = isRecord(source.register) ? source.register : source;
  const linkSource = isRecord(source.linkExtractor) ? source.linkExtractor : source;
  const oauthSource = isRecord(source.oauth) ? source.oauth : DEFAULT_OAUTH_STATE;
  const smsRelaySource = isRecord(source.smsRelay) ? source.smsRelay : DEFAULT_SMS_RELAY_STATE;
  const automationSource = isRecord(source.automation) ? source.automation : DEFAULT_AUTOMATION_STATE;
  return {
    activeTab: isFeatureTab(String(source.activeTab || '')) ? source.activeTab as FeatureTab : DEFAULT_STATE.activeTab,
    panelCollapsed: Boolean(source.panelCollapsed),
    register: normalizeRegisterState(registerSource),
    linkExtractor: normalizeLinkExtractorState(linkSource),
    oauth: normalizeOAuthState(oauthSource),
    smsRelay: normalizeSmsRelayState(smsRelaySource),
    automation: normalizeAutomationState(automationSource),
  };
}

function normalizeAutomationState(value: unknown): AutomationState {
  const source = isRecord(value) ? value : {};
  const settings = normalizeAutomationSettings(source.settings);
  const smsTargets = Array.isArray(source.smsTargets)
    ? source.smsTargets
      .map(normalizeAutomationSmsTarget)
      .filter((item): item is AutomationSmsTarget => Boolean(item))
      .filter((target) => settings.smsSourceMode === 'foxsms' || target.source === 'api')
    : [];
  const run = normalizeAutomationRun(source.run);
  if (run.selectedSmsId && !smsTargets.some((target) => target.id === run.selectedSmsId)) {
    run.selectedSmsId = '';
  }
  return {
    settings,
    emails: Array.isArray(source.emails) ? source.emails.map(normalizeAutomationEmail).filter((item): item is AutomationEmailAccount => Boolean(item)) : [],
    smsTargets,
    steps: normalizeAutomationSteps(source.steps),
    logs: Array.isArray(source.logs) ? source.logs.map(normalizeAutomationLog).filter((item): item is AutomationLogEntry => Boolean(item)).slice(0, 160) : [],
    run,
    generatedFiles: normalizeAutomationGeneratedFiles(source.generatedFiles),
    updatedAt: Number(source.updatedAt || DEFAULT_AUTOMATION_STATE.updatedAt),
  };
}

function normalizeAutomationSettings(value: unknown): AutomationSettings {
  const source = isRecord(value) ? value : {};
  const rawSms = normalizeAutomationApiRawSms(source.rawSms);
  return {
    registrationMode: normalizeAutomationRegistrationMode(source.registrationMode),
    rawEmails: String(source.rawEmails || DEFAULT_AUTOMATION_SETTINGS.rawEmails),
    rawSms,
    emailSelectionMode: normalizeAutomationEmailSelectionMode(source.emailSelectionMode),
    specifiedEmailId: String(source.specifiedEmailId || DEFAULT_AUTOMATION_SETTINGS.specifiedEmailId),
    smsSourceMode: normalizeAutomationSmsSourceMode(source.smsSourceMode),
    smsSelectionMode: normalizeAutomationSmsSelectionMode(source.smsSelectionMode),
    batchAccountLimit: normalizeAutomationBatchAccountLimit(source.batchAccountLimit),
    stopOnError: source.stopOnError === undefined ? DEFAULT_AUTOMATION_SETTINGS.stopOnError : Boolean(source.stopOnError),
    autoOpenCheckout: source.autoOpenCheckout === undefined ? DEFAULT_AUTOMATION_SETTINGS.autoOpenCheckout : Boolean(source.autoOpenCheckout),
    debugMode: source.debugMode === undefined ? DEFAULT_AUTOMATION_SETTINGS.debugMode : Boolean(source.debugMode),
    oauthExtractMode: normalizeAutomationOAuthExtractMode(source.oauthExtractMode),
    checkoutOptions: isRecord(source.checkoutOptions) ? source.checkoutOptions : DEFAULT_AUTOMATION_SETTINGS.checkoutOptions,
    checkoutExtractMode: normalizeCheckoutExtractMode(source.checkoutExtractMode || DEFAULT_AUTOMATION_SETTINGS.checkoutExtractMode),
  };
}

function normalizeAutomationApiRawSms(value: unknown): string {
  return String(value || DEFAULT_AUTOMATION_SETTINGS.rawSms)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('----'))
    .join('\n');
}

function normalizeAutomationRun(value: unknown): AutomationRunState {
  const source = isRecord(value) ? value : {};
  return {
    running: Boolean(source.running),
    paused: Boolean(source.paused),
    currentStepId: String(source.currentStepId || DEFAULT_AUTOMATION_RUN.currentStepId) as AutomationRunState['currentStepId'],
    selectedEmailId: String(source.selectedEmailId || DEFAULT_AUTOMATION_RUN.selectedEmailId),
    selectedSmsId: String(source.selectedSmsId || DEFAULT_AUTOMATION_RUN.selectedSmsId),
    selectedRegisterPhoneId: String(source.selectedRegisterPhoneId || DEFAULT_AUTOMATION_RUN.selectedRegisterPhoneId),
    registerPhoneSource: String(source.registerPhoneSource || DEFAULT_AUTOMATION_RUN.registerPhoneSource),
    registerPhoneNumber: String(source.registerPhoneNumber || DEFAULT_AUTOMATION_RUN.registerPhoneNumber),
    registerPhoneCountryId: String(source.registerPhoneCountryId || DEFAULT_AUTOMATION_RUN.registerPhoneCountryId),
    registerPhoneCountryIso: String(source.registerPhoneCountryIso || DEFAULT_AUTOMATION_RUN.registerPhoneCountryIso).trim().toUpperCase(),
    registerPhoneServiceCode: String(source.registerPhoneServiceCode || DEFAULT_AUTOMATION_RUN.registerPhoneServiceCode),
    registerPhoneActivationId: String(source.registerPhoneActivationId || DEFAULT_AUTOMATION_RUN.registerPhoneActivationId),
    registerPhoneOperator: String(source.registerPhoneOperator || DEFAULT_AUTOMATION_RUN.registerPhoneOperator),
    registerPhoneCost: Number(source.registerPhoneCost || DEFAULT_AUTOMATION_RUN.registerPhoneCost),
    checkoutUrl: String(source.checkoutUrl || DEFAULT_AUTOMATION_RUN.checkoutUrl),
    sessionEmail: String(source.sessionEmail || DEFAULT_AUTOMATION_RUN.sessionEmail),
    targetTabId: Number(source.targetTabId || DEFAULT_AUTOMATION_RUN.targetTabId),
    targetWindowId: Number(source.targetWindowId || DEFAULT_AUTOMATION_RUN.targetWindowId),
    startedAt: Number(source.startedAt || DEFAULT_AUTOMATION_RUN.startedAt),
    finishedAt: Number(source.finishedAt || DEFAULT_AUTOMATION_RUN.finishedAt),
  };
}

function normalizeAutomationSteps(value: unknown): AutomationStepRecord[] {
  const defaults = createDefaultStepRecords();
  const existing = Array.isArray(value)
    ? new Map(value.map(normalizeAutomationStep).filter((item): item is AutomationStepRecord => Boolean(item)).map((step) => [step.id, step]))
    : new Map<string, AutomationStepRecord>();
  return defaults.map((step) => existing.get(step.id) || step);
}

function normalizeAutomationStep(value: unknown): AutomationStepRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id || '') as AutomationStepRecord['id'];
  if (!createDefaultStepRecords().some((step) => step.id === id)) {
    return null;
  }
  return {
    id,
    status: normalizeAutomationStepStatus(value.status),
    message: String(value.message || ''),
    startedAt: Number(value.startedAt || 0),
    finishedAt: Number(value.finishedAt || 0),
  };
}

function normalizeAutomationEmail(value: unknown): AutomationEmailAccount | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawInput = String(value.rawInput || '').trim();
  const email = String(value.email || '').trim();
  if (!rawInput || !email) {
    return null;
  }
  return {
    id: String(value.id || email),
    rawInput,
    email,
    status: normalizeAutomationEmailStatus(value.status),
    useCount: Number(value.useCount || 0),
    lastUsedAt: Number(value.lastUsedAt || 0),
    lastMessage: String(value.lastMessage || ''),
  };
}

function normalizeAutomationSmsTarget(value: unknown): AutomationSmsTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  const phone = String(value.phone || '').trim();
  const source = normalizeAutomationSmsSourceMode(value.source);
  const url = String(value.url || '').trim();
  if (!phone || (source === 'api' && !url)) {
    return null;
  }
  return {
    id: String(value.id || (source === 'foxsms' ? `foxsms:${phone}` : `${phone}-${url}`)),
    rawInput: String(value.rawInput || (source === 'foxsms' ? phone : `${phone}----${url}`)),
    source,
    phone,
    url,
    activationId: String(value.activationId || ''),
    countryCode: String(value.countryCode || (source === 'foxsms' ? 'jpn' : '')),
    projectId: String(value.projectId || (source === 'foxsms' ? '35' : '')),
    disabled: value.disabled === true,
    disabledAt: Number(value.disabledAt || 0),
    disabledReason: String(value.disabledReason || ''),
    useCount: Number(value.useCount || 0),
    lastUsedAt: Number(value.lastUsedAt || 0),
    lastCodeAt: Number(value.lastCodeAt || 0),
    lastMessage: String(value.lastMessage || ''),
  };
}

function normalizeAutomationLog(value: unknown): AutomationLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const message = String(value.message || '').trim();
  if (!message) {
    return null;
  }
  return {
    id: String(value.id || `${Date.now()}`),
    time: Number(value.time || Date.now()),
    level: value.level === 'success' || value.level === 'error' || value.level === 'warn' ? value.level : 'info',
    stepId: String(value.stepId || '') as AutomationLogEntry['stepId'],
    message,
  };
}

function normalizeAutomationGeneratedFiles(value: unknown): AutomationGeneratedFilesState {
  const source = isRecord(value) ? value : {};
  const records = Array.isArray(source.records)
    ? source.records.map(normalizeAutomationGeneratedFileRecord).filter((item): item is AutomationGeneratedFileRecord => Boolean(item))
    : [];
  return {
    records,
    sub2apiJson: String(source.sub2apiJson || DEFAULT_AUTOMATION_GENERATED_FILES.sub2apiJson),
    cpaJson: String(source.cpaJson || DEFAULT_AUTOMATION_GENERATED_FILES.cpaJson),
    updatedAt: Number(source.updatedAt || DEFAULT_AUTOMATION_GENERATED_FILES.updatedAt),
  };
}

function normalizeAutomationGeneratedFileRecord(value: unknown): AutomationGeneratedFileRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const email = String(value.email || '').trim();
  const sub2apiJson = String(value.sub2apiJson || '').trim();
  const cpaJson = String(value.cpaJson || '').trim();
  if (!email || (!sub2apiJson && !cpaJson)) {
    return null;
  }
  const createdAt = Number(value.createdAt || 0) || Date.now();
  return {
    id: String(value.id || `${email}-${createdAt}`),
    email,
    source: String(value.source || ''),
    sub2apiJson,
    cpaJson,
    createdAt,
  };
}

function normalizeAutomationEmailSelectionMode(value: unknown): AutomationEmailSelectionMode {
  return value === 'specified' ? 'specified' : 'next';
}

function normalizeAutomationSmsSelectionMode(value: unknown): AutomationSmsSelectionMode {
  return value === 'next' ? 'next' : 'random';
}

function normalizeAutomationSmsSourceMode(value: unknown): AutomationSmsSourceMode {
  return 'api';
}

function normalizeAutomationRegistrationMode(value: unknown): AutomationRegistrationMode {
  return value === 'phone' ? 'phone' : 'email';
}

function normalizeAutomationBatchAccountLimit(value: unknown): number {
  const limit = Number(value || DEFAULT_AUTOMATION_SETTINGS.batchAccountLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_AUTOMATION_SETTINGS.batchAccountLimit;
  }
  return Math.min(limit, 999);
}

function normalizeAutomationOAuthExtractMode(value: unknown): AutomationOAuthExtractMode {
  return value === 'direct' ? 'direct' : 'email';
}

function normalizeAutomationStepStatus(value: unknown): AutomationStepStatus {
  return value === 'running' || value === 'success' || value === 'error' || value === 'skipped' ? value : 'pending';
}

function normalizeAutomationEmailStatus(value: unknown): AutomationEmailAccount['status'] {
  return value === 'running' || value === 'used' || value === 'error' ? value : 'idle';
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
    otpAutoPending: Boolean(source.otpAutoPending),
    otpAutoRunning: Boolean(source.otpAutoRunning),
    otpJobId: String(source.otpJobId || DEFAULT_REGISTER_STATE.otpJobId),
    otpLastMessage: String(source.otpLastMessage || DEFAULT_REGISTER_STATE.otpLastMessage),
    otpLastStartedAt: Number(source.otpLastStartedAt || DEFAULT_REGISTER_STATE.otpLastStartedAt),
    updatedAt: Number(source.updatedAt || DEFAULT_REGISTER_STATE.updatedAt),
  };
}

function normalizeLinkExtractorState(value: unknown): LinkExtractorState {
  const source = isRecord(value) ? value : {};
  return {
    checkoutOptions: normalizeCheckoutOptions(source.checkoutOptions || DEFAULT_LINK_STATE.checkoutOptions),
    checkoutExtractMode: normalizeCheckoutExtractMode(source.checkoutExtractMode || DEFAULT_LINK_STATE.checkoutExtractMode),
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

function normalizeOAuthState(value: unknown): OAuthState {
  const source = isRecord(value) ? value : {};
  return {
    codeVerifier: String(source.codeVerifier || DEFAULT_OAUTH_STATE.codeVerifier),
    codeChallenge: String(source.codeChallenge || DEFAULT_OAUTH_STATE.codeChallenge),
    state: String(source.state || DEFAULT_OAUTH_STATE.state),
    redirectUri: String(source.redirectUri || DEFAULT_OAUTH_STATE.redirectUri),
    authUrl: String(source.authUrl || DEFAULT_OAUTH_STATE.authUrl),
    email: String(source.email || DEFAULT_OAUTH_STATE.email),
    password: String(source.password || DEFAULT_OAUTH_STATE.password),
    startedAt: Number(source.startedAt || DEFAULT_OAUTH_STATE.startedAt),
    callbackUrl: String(source.callbackUrl || DEFAULT_OAUTH_STATE.callbackUrl),
    codeParam: String(source.codeParam || DEFAULT_OAUTH_STATE.codeParam),
    exchangeStatus: normalizeOAuthExchangeStatus(source.exchangeStatus),
    exchangeMessage: String(source.exchangeMessage || DEFAULT_OAUTH_STATE.exchangeMessage),
    exportSource: normalizeOAuthExportSource(source.exportSource),
    phoneVerification: normalizeOAuthPhoneVerificationState(source.phoneVerification),
    credentials: normalizeOAuthCredentials(source.credentials),
    cpaJson: String(source.cpaJson || DEFAULT_OAUTH_STATE.cpaJson),
    sub2apiJson: String(source.sub2apiJson || DEFAULT_OAUTH_STATE.sub2apiJson),
    updatedAt: Number(source.updatedAt || DEFAULT_OAUTH_STATE.updatedAt),
  };
}

function normalizeOAuthPhoneVerificationState(value: unknown): OAuthState['phoneVerification'] {
  const source = isRecord(value) ? value : {};
  return {
    status: normalizeOAuthPhoneVerificationStatus(source.status),
    providerId: String(source.providerId || ''),
    countryId: String(source.countryId || ''),
    countryName: String(source.countryName || ''),
    countryIso: String(source.countryIso || '').trim().toUpperCase(),
    serviceCode: String(source.serviceCode || ''),
    cost: Number(source.cost || 0),
    operator: String(source.operator || ''),
    activationId: String(source.activationId || ''),
    phoneNumber: String(source.phoneNumber || ''),
    smsCode: String(source.smsCode || ''),
    message: String(source.message || ''),
    startedAt: Number(source.startedAt || 0),
    updatedAt: Number(source.updatedAt || 0),
    logs: normalizeOAuthPhoneLogs(source.logs),
  };
}

function normalizeOAuthPhoneLogs(value: unknown): OAuthState['phoneVerification']['logs'] {
  const input = Array.isArray(value) ? value : [];
  return input
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const time = Number(item.time || 0);
      const stage = String(item.stage || '').trim();
      if (!time || !stage) {
        return null;
      }
      return {
        id: String(item.id || `${time}-${stage}`),
        time,
        stage,
        message: String(item.message || ''),
        data: String(item.data || ''),
      };
    })
    .filter((item): item is OAuthState['phoneVerification']['logs'][number] => Boolean(item))
    .slice(-80);
}

function normalizeOAuthPhoneVerificationStatus(value: unknown): OAuthState['phoneVerification']['status'] {
  return value === 'requesting' ||
    value === 'requested' ||
    value === 'waiting' ||
    value === 'received' ||
    value === 'submitted' ||
    value === 'success' ||
    value === 'error' ||
    value === 'canceled'
    ? value
    : 'idle';
}

function normalizeOAuthCredentials(value: unknown): OAuthState['credentials'] {
  if (!isRecord(value)) {
    return null;
  }
  const accessToken = String(value.access_token || '').trim();
  if (!accessToken) {
    return null;
  }
  return {
    access_token: accessToken,
    account_id: String(value.account_id || ''),
    chatgpt_user_id: String(value.chatgpt_user_id || ''),
    disabled: Boolean(value.disabled),
    email: String(value.email || ''),
    expired: String(value.expired || ''),
    id_token: String(value.id_token || ''),
    id_token_synthetic: Boolean(value.id_token_synthetic),
    last_refresh: String(value.last_refresh || ''),
    plan_type: String(value.plan_type || ''),
    refresh_token: String(value.refresh_token || ''),
    session_token: String(value.session_token || ''),
    source: String(value.source || ''),
    type: 'codex',
  };
}

function normalizeOAuthExchangeStatus(value: unknown): OAuthState['exchangeStatus'] {
  return value === 'pending' || value === 'success' || value === 'error' ? value : 'idle';
}

function normalizeOAuthExportSource(value: unknown): OAuthState['exportSource'] {
  return value === 'oauth-code' || value === 'chatgpt-session-add-phone' || value === 'chatgpt-session-direct'
    ? value
    : '';
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

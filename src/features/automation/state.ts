import { loadAutomationState, saveAutomationState } from '../../app/state';
import { saveLinkExtractorState } from '../../app/state';
import { normalizeCheckoutExtractMode, normalizeCheckoutOptions } from '../link-extractor/checkout';
import { parseAccountInput } from '../register/account-input';
import { parseSmsRelayTargets } from '../sms/parser';
import { createDefaultStepRecords } from './steps';
import type {
  AutomationEmailAccount,
  AutomationGeneratedFileRecord,
  AutomationGeneratedFilesState,
  AutomationLogEntry,
  AutomationLogLevel,
  AutomationSettings,
  AutomationSettingsParseResult,
  AutomationSmsTarget,
  AutomationSmsSourceMode,
  AutomationState,
  AutomationStepId,
  AutomationStepRecord,
  AutomationStepStatus,
} from './types';

const MAX_LOG_ENTRIES = 180;

export async function saveAutomationSettings(patch: Partial<AutomationSettings>): Promise<AutomationState> {
  const current = await loadAutomationState();
  const settings: AutomationSettings = {
    ...current.settings,
    ...patch,
    checkoutOptions: {
      ...current.settings.checkoutOptions,
      ...(patch.checkoutOptions || {}),
    },
  };
  const parsed = parseAutomationSettings(settings, current);
  if (patch.checkoutOptions) {
    await saveLinkExtractorState({
      checkoutOptions: normalizeCheckoutOptions(settings.checkoutOptions),
      checkoutExtractMode: normalizeCheckoutExtractMode(settings.checkoutExtractMode),
    });
  }
  return saveAutomationState({
    settings,
    emails: parsed.emails,
    smsTargets: parsed.smsTargets,
  });
}

export function parseAutomationSettings(settings: AutomationSettings, current?: AutomationState): AutomationSettingsParseResult {
  return {
    ...parseAutomationEmails(settings.rawEmails, current?.emails || []),
    ...parseAutomationSms(settings.rawSms, settings.smsSourceMode || 'api', current?.smsTargets || []),
  };
}

export async function appendAutomationLog(
  level: AutomationLogLevel,
  message: string,
  stepId: AutomationStepId | '' = '',
): Promise<AutomationState> {
  const current = await loadAutomationState();
  const entry: AutomationLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now(),
    level,
    stepId,
    message,
  };
  return saveAutomationState({
    logs: [entry, ...current.logs].slice(0, MAX_LOG_ENTRIES),
  });
}

export async function clearAutomationLogs(): Promise<AutomationState> {
  return saveAutomationState({ logs: [] });
}

export async function resetAutomationProgress(): Promise<AutomationState> {
  const current = await loadAutomationState();
  return saveAutomationState({
    steps: createDefaultStepRecords(),
    run: {
      ...current.run,
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
    },
  });
}

export async function resetAutomationFromStep(stepId: AutomationStepId): Promise<AutomationState> {
  const current = await loadAutomationState();
  const defaultsById = new Map(createDefaultStepRecords().map((step) => [step.id, step]));
  const startIndex = current.steps.findIndex((step) => step.id === stepId);
  const resetIndex = startIndex >= 0 ? startIndex : 0;
  return saveAutomationState({
    steps: current.steps.map((step, index) => {
      if (index < resetIndex) {
        return step;
      }
      return defaultsById.get(step.id) || {
        ...step,
        status: 'pending',
        message: '',
        startedAt: 0,
        finishedAt: 0,
      };
    }),
    run: {
      ...current.run,
      running: false,
      paused: false,
      currentStepId: stepId,
      startedAt: 0,
      finishedAt: 0,
    },
  });
}

export async function markAutomationStep(
  stepId: AutomationStepId,
  status: AutomationStepStatus,
  message = '',
): Promise<AutomationState> {
  const current = await loadAutomationState();
  const now = Date.now();
  return saveAutomationState({
    steps: current.steps.map((step) => step.id === stepId
      ? {
          ...step,
          status,
          message,
          startedAt: status === 'running' ? now : step.startedAt,
          finishedAt: status === 'success' || status === 'error' || status === 'skipped' ? now : step.finishedAt,
        }
      : step),
    run: {
      ...current.run,
      currentStepId: status === 'running' ? stepId : current.run.currentStepId,
    },
  });
}

export async function setAutomationRunning(running: boolean, paused = false): Promise<AutomationState> {
  const current = await loadAutomationState();
  return saveAutomationState({
    run: {
      ...current.run,
      running,
      paused,
      startedAt: running && !current.run.startedAt ? Date.now() : current.run.startedAt,
      finishedAt: running ? 0 : Date.now(),
    },
  });
}

export async function updateAutomationRun(patch: Partial<AutomationState['run']>): Promise<AutomationState> {
  const current = await loadAutomationState();
  return saveAutomationState({
    run: {
      ...current.run,
      ...patch,
    },
  });
}

export async function updateAutomationEmails(emails: AutomationEmailAccount[]): Promise<AutomationState> {
  return saveAutomationState({ emails });
}

export async function updateAutomationSmsTargets(smsTargets: AutomationSmsTarget[]): Promise<AutomationState> {
  return saveAutomationState({ smsTargets });
}

export async function saveAutomationGeneratedFile(record: AutomationGeneratedFileRecord): Promise<AutomationState> {
  const current = await loadAutomationState();
  const records = upsertGeneratedFileRecord(current.generatedFiles.records, record);
  return saveAutomationState({
    generatedFiles: buildGeneratedFilesState(records),
  });
}

export async function clearAutomationGeneratedFiles(): Promise<AutomationState> {
  return saveAutomationState({
    generatedFiles: {
      records: [],
      sub2apiJson: '',
      cpaJson: '',
      updatedAt: Date.now(),
    },
  });
}

export function findStepRecord(state: AutomationState, stepId: AutomationStepId): AutomationStepRecord {
  return state.steps.find((step) => step.id === stepId) || createDefaultStepRecords().find((step) => step.id === stepId)!;
}

function parseAutomationEmails(rawEmails: string, existing: AutomationEmailAccount[]): {
  emails: AutomationEmailAccount[];
  emailErrors: string[];
} {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const emailErrors: string[] = [];
  const seen = new Set<string>();
  const emails: AutomationEmailAccount[] = [];

  rawEmails.split(/\r?\n/).forEach((line, index) => {
    const rawInput = line.trim();
    if (!rawInput) {
      return;
    }
    const parsed = parseAccountInput(rawInput);
    if (!parsed.ok) {
      emailErrors.push(`第 ${index + 1} 行：${parsed.message}`);
      return;
    }
    const id = stableId(rawInput);
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const previous = existingById.get(id);
    emails.push({
      id,
      rawInput,
      email: parsed.email,
      status: previous?.status || 'idle',
      useCount: previous?.useCount || 0,
      lastUsedAt: previous?.lastUsedAt || 0,
      lastMessage: previous?.lastMessage || '',
    });
  });

  return { emails, emailErrors };
}

function parseAutomationSms(rawSms: string, sourceMode: AutomationSmsSourceMode, existing: AutomationSmsTarget[]): {
  smsTargets: AutomationSmsTarget[];
  smsErrors: string[];
} {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  if (sourceMode === 'foxsms') {
    return parseFoxSmsAutomationTargets(rawSms, existingById);
  }
  return parseApiAutomationTargets(rawSms, existingById);
}

function parseApiAutomationTargets(
  rawSms: string,
  existingById: Map<string, AutomationSmsTarget>,
): {
  smsTargets: AutomationSmsTarget[];
  smsErrors: string[];
} {
  const parsed = parseSmsRelayTargets(rawSms);
  return {
    smsTargets: parsed.targets.map((target) => {
      const rawInput = `${target.phone}----${target.url}`;
      const id = target.id || stableId(rawInput);
      const previous = existingById.get(id);
      return buildAutomationSmsTarget({
        id,
        rawInput,
        source: 'api',
        phone: target.phone,
        url: target.url,
        previous,
      });
    }),
    smsErrors: parsed.errors,
  };
}

function parseFoxSmsAutomationTargets(
  rawSms: string,
  existingById: Map<string, AutomationSmsTarget>,
): {
  smsTargets: AutomationSmsTarget[];
  smsErrors: string[];
} {
  const smsTargets: AutomationSmsTarget[] = [];
  const smsErrors: string[] = [];
  const seen = new Set<string>();

  rawSms.split(/\r?\n/).forEach((line, index) => {
    const rawInput = line.trim();
    if (!rawInput) {
      return;
    }
    if (rawInput.includes('----')) {
      smsErrors.push(`第 ${index + 1} 行：Fox SMS 模式只填写手机号，不需要 API 链接`);
      return;
    }
    const phone = normalizeFoxSmsPhone(rawInput);
    if (!phone) {
      smsErrors.push(`第 ${index + 1} 行：手机号为空`);
      return;
    }
    if (!/^\d{7,15}$/.test(phone)) {
      smsErrors.push(`第 ${index + 1} 行：手机号格式不正确`);
      return;
    }
    const id = `foxsms:${phone}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    smsTargets.push(buildAutomationSmsTarget({
      id,
      rawInput: phone,
      source: 'foxsms',
      phone,
      url: '',
      previous: existingById.get(id),
    }));
  });

  return { smsTargets, smsErrors };
}

function buildAutomationSmsTarget(input: {
  id: string;
  rawInput: string;
  source: AutomationSmsSourceMode;
  phone: string;
  url: string;
  previous?: AutomationSmsTarget;
}): AutomationSmsTarget {
  return {
    id: input.id,
    rawInput: input.rawInput,
    source: input.source,
    phone: input.phone,
    url: input.url,
    activationId: input.previous?.source === input.source ? input.previous.activationId : '',
    countryCode: input.source === 'foxsms' ? input.previous?.countryCode || 'jpn' : '',
    projectId: input.source === 'foxsms' ? input.previous?.projectId || '35' : '',
    disabled: input.previous?.disabled || false,
    disabledAt: input.previous?.disabledAt || 0,
    disabledReason: input.previous?.disabledReason || '',
    useCount: input.previous?.useCount || 0,
    lastUsedAt: input.previous?.lastUsedAt || 0,
    lastCodeAt: input.previous?.lastCodeAt || 0,
    lastMessage: input.previous?.lastMessage || '',
  };
}

function normalizeFoxSmsPhone(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `auto-${(hash >>> 0).toString(36)}`;
}

function upsertGeneratedFileRecord(
  records: AutomationGeneratedFileRecord[],
  record: AutomationGeneratedFileRecord,
): AutomationGeneratedFileRecord[] {
  const next = records.filter((item) => item.email.toLowerCase() !== record.email.toLowerCase());
  next.unshift(record);
  return next.slice(0, 120);
}

function buildGeneratedFilesState(records: AutomationGeneratedFileRecord[]): AutomationGeneratedFilesState {
  return {
    records,
    sub2apiJson: buildCombinedSub2ApiJson(records),
    cpaJson: buildCombinedCpaJson(records),
    updatedAt: Date.now(),
  };
}

function buildCombinedSub2ApiJson(records: AutomationGeneratedFileRecord[]): string {
  const accounts: unknown[] = [];
  let exportedAt = '';

  for (const record of [...records].reverse()) {
    const parsed = parseJsonRecord(record.sub2apiJson);
    if (!parsed) {
      continue;
    }
    if (!exportedAt && typeof parsed.exported_at === 'string') {
      exportedAt = parsed.exported_at;
    }
    if (Array.isArray(parsed.accounts)) {
      accounts.push(...parsed.accounts);
    }
  }

  return `${JSON.stringify({
    exported_at: exportedAt || new Date().toISOString(),
    proxies: [],
    accounts,
  }, null, 2)}\n`;
}

function buildCombinedCpaJson(records: AutomationGeneratedFileRecord[]): string {
  const accounts = [...records]
    .reverse()
    .map((record) => parseJsonRecord(record.cpaJson))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  return `${JSON.stringify(accounts, null, 2)}\n`;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

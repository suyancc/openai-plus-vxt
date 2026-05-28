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
    ...parseAutomationSms(settings.rawSms, current?.smsTargets || []),
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

function parseAutomationSms(rawSms: string, existing: AutomationSmsTarget[]): {
  smsTargets: AutomationSmsTarget[];
  smsErrors: string[];
} {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const parsed = parseSmsRelayTargets(rawSms);
  const smsTargets = parsed.targets.map((target) => {
    const rawInput = `${target.phone}----${target.url}`;
    const id = target.id || stableId(rawInput);
    const previous = existingById.get(id);
    return {
      id,
      rawInput,
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

  return {
    smsTargets,
    smsErrors: parsed.errors,
  };
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

import {
  loadAutomationState,
  saveRegisterState,
} from '../../app/state';
import {
  updateAutomationEmails,
  updateAutomationRun,
  updateAutomationSmsTargets,
} from './state';
import type {
  AutomationEmailAccount,
  AutomationSmsTarget,
  AutomationState,
} from './types';
import { shortFailureReason } from './runner-format';

export async function ensureSelectedEmail(): Promise<AutomationEmailAccount> {
  const state = await loadAutomationState();
  const email = currentEmail(state);
  if (!email) {
    const selected = selectEmail(state);
    if (selected) {
      await updateAutomationRun({
        selectedEmailId: selected.id,
        sessionEmail: selected.email,
      });
      return writeRegisterStateFromEmail(selected);
    }
    throw new Error('没有当前邮箱，请先执行“选择邮箱”或在自动化设置页添加邮箱');
  }
  return writeRegisterStateFromEmail(email);
}

export async function writeRegisterStateFromEmail(email: AutomationEmailAccount): Promise<AutomationEmailAccount> {
  await saveRegisterState({
    rawInput: email.rawInput,
    email: email.email,
    accountLine: email.rawInput.includes('----') ? email.rawInput : '',
    inputMode: email.rawInput.includes('----') ? 'outlook-line' : 'email',
    autoOtp: email.rawInput.includes('----'),
  });
  return email;
}

export function selectEmail(state: AutomationState): AutomationEmailAccount | null {
  if (state.settings.emailSelectionMode === 'specified' && state.settings.specifiedEmailId) {
    return state.emails.find((email) => email.id === state.settings.specifiedEmailId) || null;
  }
  if (state.run.selectedEmailId) {
    const selected = state.emails.find((email) => email.id === state.run.selectedEmailId && email.status === 'running');
    if (selected) {
      return selected;
    }
  }
  return [...state.emails]
    .filter((email) => email.status !== 'used' && email.status !== 'error')
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt || left.useCount - right.useCount)[0] || null;
}

export function selectSmsTarget(state: AutomationState): AutomationSmsTarget | null {
  const available = availableSmsTargets(state);
  if (!available.length) {
    return null;
  }
  const candidates = [...available].sort((left, right) => left.useCount - right.useCount || left.lastUsedAt - right.lastUsedAt);
  if (state.settings.smsSelectionMode === 'next') {
    return candidates[0] || null;
  }
  const leastUsed = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)));
  return leastUsed[Math.floor(Math.random() * leastUsed.length)] || candidates[0] || null;
}

export function availableSmsTargets(state: AutomationState): AutomationSmsTarget[] {
  return state.smsTargets.filter((target) => target.source === 'api' && !target.disabled);
}

export function hasNextBatchEmail(state: AutomationState): boolean {
  if (state.settings.emailSelectionMode === 'specified') {
    return false;
  }
  return state.emails.some((email) => email.status !== 'used' && email.status !== 'error');
}

export function normalizeBatchAccountLimit(value: unknown): number {
  const limit = Number(value || 1);
  if (!Number.isInteger(limit) || limit < 1) {
    return 1;
  }
  return Math.min(limit, 999);
}

export function currentEmail(state: AutomationState): AutomationEmailAccount | null {
  return state.emails.find((email) => email.id === state.run.selectedEmailId) || null;
}

export function currentSmsTarget(state: AutomationState): AutomationSmsTarget | null {
  return state.smsTargets.find((target) => target.id === state.run.selectedSmsId) || null;
}

export async function markSelectedEmailUsed(message: string): Promise<void> {
  const state = await loadAutomationState();
  if (!state.run.selectedEmailId) {
    return;
  }
  await updateAutomationEmails(state.emails.map((email) => email.id === state.run.selectedEmailId
    ? { ...email, status: 'used', lastMessage: message }
    : email));
}

export async function markSelectedEmailError(message: string): Promise<void> {
  const state = await loadAutomationState();
  if (!state.run.selectedEmailId) {
    return;
  }
  await updateAutomationEmails(state.emails.map((email) => email.id === state.run.selectedEmailId
    ? { ...email, status: 'error', lastMessage: message }
    : email));
}

export async function markSmsCodeReceived(id: string, message: string): Promise<void> {
  const state = await loadAutomationState();
  await updateAutomationSmsTargets(state.smsTargets.map((target) => target.id === id
    ? { ...target, lastCodeAt: Date.now(), lastMessage: message }
    : target));
}

export async function markSmsMessage(id: string, message: string): Promise<void> {
  const state = await loadAutomationState();
  await updateAutomationSmsTargets(state.smsTargets.map((target) => target.id === id
    ? { ...target, lastMessage: message }
    : target));
}

export async function markSelectedSmsDisabled(reason: string): Promise<AutomationSmsTarget | null> {
  const state = await loadAutomationState();
  const selectedId = state.run.selectedSmsId;
  const selected = selectedId
    ? state.smsTargets.find((target) => target.id === selectedId) || null
    : null;
  if (!selected) {
    await updateAutomationRun({ selectedSmsId: '' });
    return null;
  }
  const disabledAt = Date.now();
  const disabledReason = shortFailureReason(reason);
  await updateAutomationSmsTargets(state.smsTargets.map((target) => target.id === selected.id
    ? {
        ...target,
        disabled: true,
        disabledAt,
        disabledReason,
        lastMessage: disabledReason,
      }
    : target));
  await updateAutomationRun({ selectedSmsId: '' });
  return {
    ...selected,
    disabled: true,
    disabledAt,
    disabledReason,
    lastMessage: disabledReason,
  };
}

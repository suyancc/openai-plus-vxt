import { loadSmsRelayState, saveSmsRelayState } from '../../app/state';
import type { SmsCodeRecord } from '../sms/types';

export async function loadSeenSmsCodes(phone: string): Promise<Set<string>> {
  const state = await loadSmsRelayState();
  return new Set(
    state.history
      .filter((item) => phonesEqual(item.phone, phone))
      .map((item) => smsCodeKey(phone, item.code)),
  );
}

export function smsCodeKey(phone: string, code: string): string {
  return `${normalizePhone(phone)}|${code}`;
}

function phonesEqual(left: string, right: string): boolean {
  const leftPhone = normalizePhone(left);
  const rightPhone = normalizePhone(right);
  return Boolean(leftPhone && rightPhone && (leftPhone === rightPhone || leftPhone.endsWith(rightPhone) || rightPhone.endsWith(leftPhone)));
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

export async function appendSmsHistory(phone: string, code: string, message: string): Promise<void> {
  const state = await loadSmsRelayState();
  const exists = state.history.some((item) => item.phone === phone && item.code === code);
  if (exists) {
    return;
  }
  const record: SmsCodeRecord = {
    id: `${phone}-${code}-${Date.now()}`,
    phone,
    code,
    message,
    receivedAt: Date.now(),
  };
  await saveSmsRelayState({ history: [record, ...state.history].slice(0, 80) });
}

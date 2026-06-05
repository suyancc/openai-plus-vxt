import type { ActionResult } from './types';
import {
  buildOtpDebugData,
  fillOtpTarget,
  findOtpContinueButton,
  findOtpTarget,
  isVisible,
} from './openai-email-otp-dom';
import { isPhoneVerificationPath } from './phone-verification-url';
import { countryIsoToCallingCode } from '../oauth-phone/country-map';

interface PhoneFillPayload {
  phoneNumber: string;
  countryIso: string;
}

const PHONE_ENTRY_LABELS = [
  '使用电话号码继续',
  '使用手机号继续',
  'continue with phone',
  'continue with phone number',
  'use phone',
  'phone number',
];

const CONTINUE_LABELS = [
  '继续',
  'continue',
  '下一步',
  'next',
  '发送验证码',
  'send code',
];

const COOKIE_DISMISS_LABELS = [
  '拒绝非必需',
  'reject non-essential',
  'reject all',
  '全部接受',
  'accept all',
];

const PHONE_ENTRY_WAIT_MS = 10_000;
const PHONE_INPUT_WAIT_MS = 10_000;
const PHONE_INPUT_AFTER_CLICK_WAIT_MS = 2_500;
const PHONE_ENTRY_CLICK_ATTEMPTS = 4;

interface ClickDebugData {
  text: string;
  centerX: number;
  centerY: number;
  topElement: string;
  covered: boolean;
  connected: boolean;
}

interface PhoneEntryOpenResult {
  input: HTMLInputElement | null;
  entryFound: boolean;
  entryClickAttempts: ClickDebugData[];
  dismissedButtons: string[];
}

export function isPhoneVerificationPage(): boolean {
  return location.hostname === 'auth.openai.com' && isPhoneVerificationPath(location.pathname);
}

export async function fillRegisterPhoneAndContinue(payload: PhoneFillPayload): Promise<ActionResult> {
  if (!isRegisterLoginPage()) {
    return fail('当前页面不是 ChatGPT 登录页', collectPhoneDebugData(payload));
  }

  await waitForDocumentReady(8_000);
  const dismissedButtons = await dismissCookiePrompt();
  const entryClickAttempts: ClickDebugData[] = [];
  let input = findPhoneInput();
  if (!input) {
    const opened = await openPhoneEntry();
    input = opened.input;
    dismissedButtons.push(...opened.dismissedButtons);
    entryClickAttempts.push(...opened.entryClickAttempts);
    if (!opened.entryFound && !input) {
      return fail('没有找到“使用电话号码继续”按钮', collectPhoneDebugData(payload, {
        dismissedButtons,
        entryClickAttempts,
      }));
    }
  }

  input = input || await waitForPhoneInput(PHONE_INPUT_WAIT_MS);
  if (!input) {
    return fail('没有找到手机号输入框', collectPhoneDebugData(payload, {
      dismissedButtons,
      entryClickAttempts,
    }));
  }
  if (!isWritableInput(input)) {
    await waitForWritableInput(input, 3_500);
  }
  if (!isWritableInput(input)) {
    return fail('手机号输入框仍然不可写', collectPhoneDebugData(payload, {
      dismissedButtons,
      entryClickAttempts,
    }));
  }

  const value = normalizePhoneForInput(payload.phoneNumber, payload.countryIso);
  if (!value) {
    return fail('手机号为空', collectPhoneDebugData(payload, {
      dismissedButtons,
      entryClickAttempts,
    }));
  }
  focusInput(input);
  setNativeValue(input, value);
  dispatchInputEvent(input, value);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUiTick(220);

  if (!input.value.replace(/[^\d]/g, '').includes(value.replace(/[^\d]/g, '').slice(-6))) {
    return fail('手机号输入框没有接受输入值', collectPhoneDebugData(payload, {
      dismissedButtons,
      entryClickAttempts,
      normalizedPhoneLength: value.length,
    }));
  }

  const button = findContinueButton();
  if (!button) {
    return fail('没有找到手机号继续按钮', collectPhoneDebugData(payload, {
      dismissedButtons,
      entryClickAttempts,
      normalizedPhoneLength: value.length,
    }));
  }
  if (!isClickableButton(button)) {
    await waitForClickableButton(button, 3_500);
  }
  if (!isClickableButton(button)) {
    return fail('手机号继续按钮仍然不可点击', collectPhoneDebugData(payload, {
      dismissedButtons,
      entryClickAttempts,
      normalizedPhoneLength: value.length,
    }));
  }
  clickElement(button);
  await waitForUiTick(160);
  return ok(`已填写注册手机号 ${maskPhone(payload.phoneNumber)} 并点击继续`, collectPhoneDebugData(payload, {
    dismissedButtons,
    entryClickAttempts,
    normalizedPhoneLength: value.length,
  }));
}

export async function fillRegisterPhoneOtpAndContinue(code: string): Promise<ActionResult> {
  if (!isPhoneVerificationPage()) {
    return fail('当前页面不是手机验证码页', buildOtpDebugData());
  }
  const normalized = code.replace(/\D/g, '').slice(0, 8);
  if (!normalized) {
    return fail('手机验证码为空');
  }
  const target = findOtpTarget();
  if (!target) {
    return fail('没有找到手机验证码输入框', buildOtpDebugData());
  }
  fillOtpTarget(target, normalized);
  await waitForUiTick(120);
  const button = findOtpContinueButton();
  if (!button) {
    return fail('没有找到手机验证码继续按钮', buildOtpDebugData());
  }
  if (button.disabled) {
    await waitForClickableButton(button, 2_500);
  }
  if (!isClickableButton(button)) {
    return fail('手机验证码继续按钮仍然不可点击', buildOtpDebugData());
  }
  clickElement(button);
  return ok(`已填入注册手机验证码并点击继续（${target.kind === 'multi' ? `${target.inputs.length} 格输入框` : '单输入框'}）`);
}

function isRegisterLoginPage(): boolean {
  return (
    location.hostname === 'chatgpt.com' &&
    location.pathname.startsWith('/auth/login')
  ) || (
    location.hostname === 'auth.openai.com' &&
    isOpenAiLogInPath(location.pathname)
  );
}

function isOpenAiLogInPath(pathname: string): boolean {
  return pathname === '/log-in' || pathname.startsWith('/log-in/');
}

async function openPhoneEntry(): Promise<PhoneEntryOpenResult> {
  const deadline = Date.now() + PHONE_ENTRY_WAIT_MS + PHONE_INPUT_WAIT_MS;
  const entryClickAttempts: ClickDebugData[] = [];
  const dismissedButtons: string[] = [];
  let entryFound = false;

  for (let attempt = 0; attempt < PHONE_ENTRY_CLICK_ATTEMPTS && Date.now() <= deadline; attempt += 1) {
    const existing = findPhoneInput();
    if (existing) {
      return { input: existing, entryFound, entryClickAttempts, dismissedButtons };
    }

    dismissedButtons.push(...await dismissCookiePrompt());
    const entry = await waitForPhoneEntryButton(Math.min(2_000, Math.max(300, deadline - Date.now())));
    const inputAfterWait = findPhoneInput();
    if (inputAfterWait) {
      return { input: inputAfterWait, entryFound, entryClickAttempts, dismissedButtons };
    }
    if (!entry) {
      await waitForUiTick(250);
      continue;
    }

    entryFound = true;
    if (!isClickableButton(entry)) {
      await waitForClickableButton(entry, 1_500);
    }
    if (!isClickableButton(entry)) {
      entryClickAttempts.push(describeClickTarget(entry));
      await waitForUiTick(350);
      continue;
    }

    entryClickAttempts.push(clickElement(entry));
    const input = await waitForPhoneInput(PHONE_INPUT_AFTER_CLICK_WAIT_MS);
    if (input) {
      return { input, entryFound, entryClickAttempts, dismissedButtons };
    }
    await waitForUiTick(450);
  }

  return {
    input: findPhoneInput(),
    entryFound,
    entryClickAttempts,
    dismissedButtons,
  };
}

async function dismissCookiePrompt(): Promise<string[]> {
  const clicked: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const button = findCookieDismissButton();
    if (!button) {
      break;
    }
    clicked.push(compactText(button.textContent || button.ariaLabel || ''));
    clickElement(button);
    await waitForUiTick(220);
  }
  return clicked;
}

function findCookieDismissButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const label of COOKIE_DISMISS_LABELS) {
    const button = buttons.find((item) => {
      if (!isVisible(item) || !isClickableButton(item)) {
        return false;
      }
      const text = normalizedText(item.textContent || item.ariaLabel || '');
      return text.includes(label.toLowerCase());
    });
    if (button) {
      return button;
    }
  }
  return null;
}

function findPhoneEntryButton(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!isVisible(button) || !isClickableButton(button)) {
      return false;
    }
    const text = normalizedText(button.textContent || button.ariaLabel || button.getAttribute('data-dd-action-name') || '');
    return PHONE_ENTRY_LABELS.some((label) => text.includes(label.toLowerCase()));
  }) || null;
}

async function waitForPhoneEntryButton(timeoutMs: number): Promise<HTMLButtonElement | null> {
  const deadline = Date.now() + timeoutMs;
  let entry = findPhoneEntryButton();
  while (!entry && !findPhoneInput() && Date.now() <= deadline) {
    await waitForUiTick(150);
    entry = findPhoneEntryButton();
  }
  return entry;
}

function findPhoneInput(): HTMLInputElement | null {
  const selectors = [
    'input[type="tel"]',
    'input[autocomplete="tel"]',
    'input[name*="phone" i]',
    'input[id*="phone" i]',
    'input[name*="tel" i]',
    'input[id*="tel" i]',
    'input[name="phone_number"]',
    'input[name="phoneNumber"]',
    'input[name="username"]',
    'input[aria-label*="phone" i]',
    'input[placeholder*="phone" i]',
    'input[inputmode="tel"]',
    'input[inputmode="numeric"]',
  ];
  for (const selector of selectors) {
    const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector)).find((item) => isVisible(item));
    if (input) {
      return input;
    }
  }
  return null;
}

function findContinueButton(): HTMLButtonElement | null {
  for (const selector of [
    'button[type="submit"]',
    'button[data-dd-action-name="Continue"]',
    'form button:not([type="button"])',
  ]) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((item) => isVisible(item));
    if (button) {
      return button;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!isVisible(button)) {
      return false;
    }
    const text = normalizedText(button.textContent || button.ariaLabel || '');
    return CONTINUE_LABELS.some((label) => text.includes(label.toLowerCase()));
  }) || null;
}

async function waitForPhoneInput(timeoutMs: number): Promise<HTMLInputElement | null> {
  const deadline = Date.now() + timeoutMs;
  let input = findPhoneInput();
  while (!input && Date.now() <= deadline) {
    await waitForUiTick(150);
    input = findPhoneInput();
  }
  return input;
}

function focusInput(input: HTMLInputElement): void {
  input.scrollIntoView({ block: 'center', inline: 'center' });
  clickElement(input);
  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(0, input.value.length);
  } catch {
    // Some phone inputs do not support text selection.
  }
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value') ||
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const setter = prototypeDescriptor?.set || ownDescriptor?.set;
  if (setter) {
    setter.call(input, value);
    return;
  }
  input.value = value;
}

function dispatchInputEvent(input: HTMLInputElement, value: string): void {
  try {
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: value,
    }));
  } catch {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function clickElement(element: HTMLElement): ClickDebugData {
  const debug = describeClickTarget(element);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: type.endsWith('down') ? 1 : 0,
      pointerId: 1,
      pointerType: 'mouse',
    }));
  }
  element.click();
  return debug;
}

function describeClickTarget(element: HTMLElement): ClickDebugData {
  const rect = element.getBoundingClientRect();
  const centerX = Math.round(rect.left + rect.width / 2);
  const centerY = Math.round(rect.top + rect.height / 2);
  const top = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
  return {
    text: compactText(element.textContent || element.ariaLabel || ''),
    centerX,
    centerY,
    topElement: top ? elementDebugName(top) : '',
    covered: Boolean(top && top !== element && !element.contains(top)),
    connected: element.isConnected,
  };
}

function elementDebugName(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = typeof element.className === 'string' && element.className.trim()
    ? `.${element.className.trim().replace(/\s+/g, '.')}`.slice(0, 80)
    : '';
  const text = compactText(element.textContent || element.ariaLabel || '');
  return `${tag}${id}${className}${text ? `:${text}` : ''}`.slice(0, 160);
}

function isWritableInput(input: HTMLInputElement): boolean {
  return isVisible(input) && !input.disabled && !input.readOnly && input.isConnected;
}

function isClickableButton(button: HTMLButtonElement): boolean {
  return isVisible(button) &&
    !button.disabled &&
    button.getAttribute('aria-disabled') !== 'true' &&
    button.dataset.disabled !== 'true';
}

async function waitForWritableInput(input: HTMLInputElement, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isWritableInput(input) && Date.now() <= deadline) {
    await waitForUiTick(100);
  }
}

async function waitForClickableButton(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isClickableButton(button) && Date.now() <= deadline) {
    await waitForUiTick(100);
  }
}

function normalizePhoneForInput(phoneNumber: string, countryIso: string): string {
  const digits = phoneNumber.replace(/[^\d]/g, '');
  if (!digits) {
    return '';
  }
  const callingCode = countryIsoToCallingCode(countryIso);
  if (callingCode && !digits.startsWith(callingCode)) {
    return `+${callingCode}${digits}`;
  }
  return phoneNumber.trim().startsWith('+') ? phoneNumber.trim() : `+${digits}`;
}

function collectPhoneDebugData(
  payload: PhoneFillPayload,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const input = findPhoneInput();
  const entry = findPhoneEntryButton();
  const button = findContinueButton();
  return {
    url: location.href,
    readyState: document.readyState,
    expectedCountryIso: payload.countryIso,
    expectedPhoneLength: payload.phoneNumber.length,
    entryFound: Boolean(entry),
    entryText: compactText(entry?.textContent || entry?.ariaLabel || ''),
    inputFound: Boolean(input),
    inputType: input?.type || '',
    inputName: input?.name || '',
    inputId: input?.id || '',
    inputValueLength: input?.value?.length || 0,
    inputDisabled: Boolean(input?.disabled),
    inputReadOnly: Boolean(input?.readOnly),
    buttonFound: Boolean(button),
    buttonText: compactText(button?.textContent || button?.ariaLabel || ''),
    buttonDisabled: Boolean(button?.disabled),
    ...extra,
    visibleButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(isVisible).map((item) => compactText(item.textContent || item.ariaLabel || '')).slice(0, 12),
    visibleInputs: Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isVisible).map((item) => ({
      type: item.type,
      name: item.name,
      id: item.id,
      autocomplete: item.autocomplete,
      inputMode: item.inputMode,
      placeholder: item.placeholder,
      valueLength: item.value.length,
    })).slice(0, 12),
  };
}

function maskPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length <= 6) {
    return digits;
  }
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function waitForUiTick(ms = 160): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForDocumentReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (document.readyState === 'loading' && Date.now() <= deadline) {
    await waitForUiTick(120);
  }
}

function ok(message: string, data?: unknown): ActionResult {
  return data === undefined ? { ok: true, message } : { ok: true, message, data };
}

function fail(message: string, data?: unknown): ActionResult {
  return data === undefined ? { ok: false, message } : { ok: false, message, data };
}

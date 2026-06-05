export interface OtpTarget {
  kind: 'single' | 'multi';
  input: HTMLInputElement | null;
  inputs: HTMLInputElement[];
}

const STRONG_SINGLE_SELECTORS = [
  'input[name="code"]',
  'input[name="otp"]',
  'input[name*="code" i]',
  'input[name*="otp" i]',
  'input[name*="verification" i]',
  'input[id*="code" i]',
  'input[id*="otp" i]',
  'input[id*="verification" i]',
  'input[autocomplete="one-time-code"]',
  'input[data-testid*="code" i]',
  'input[data-testid*="otp" i]',
  'input[data-testid*="verification" i]',
  'input[aria-label*="code" i]',
  'input[aria-label*="otp" i]',
  'input[aria-label*="verification" i]',
  'input[aria-label*="验证码"]',
  'input[aria-label*="確認コード"]',
  'input[aria-label*="認証コード"]',
  'input[placeholder*="code" i]',
  'input[placeholder*="otp" i]',
  'input[placeholder*="verification" i]',
  'input[placeholder*="验证码"]',
  'input[placeholder*="確認コード"]',
  'input[placeholder*="認証コード"]',
];

const MULTI_INPUT_SELECTORS = [
  'input[maxlength="1"][inputmode="numeric"]',
  'input[maxlength="1"][inputmode="decimal"]',
  'input[maxlength="1"][type="tel"]',
  'input[maxlength="1"][type="text"]',
  'input[aria-label*="digit" i]',
  'input[aria-label*="数字"]',
  'input[aria-label*="桁"]',
  'input[data-testid*="digit" i]',
  'input[data-testid*="otp" i]',
  'input[data-testid*="code" i]',
];

const CONTINUE_BUTTON_LABELS = [
  'continue',
  'verify',
  'submit',
  'next',
  '继续',
  '下一步',
  '验证',
  '提交',
  '続ける',
  '続行',
  '次へ',
  '確認',
  '認証',
  '送信',
];

const OTP_HINTS = [
  'code',
  'otp',
  'verification',
  'verify',
  'one-time',
  'one time',
  'security',
  '验证码',
  '验证',
  '確認コード',
  '認証コード',
  'コード',
  '認証',
];

export function findOtpTarget(): OtpTarget | null {
  const multi = findMultiOtpInputs();
  if (multi.length >= 4) {
    return { kind: 'multi', input: multi[0] || null, inputs: multi };
  }

  const single = findSingleOtpInput();
  if (single) {
    return { kind: 'single', input: single, inputs: [single] };
  }

  return null;
}

export function fillOtpTarget(target: OtpTarget, code: string): void {
  if (target.kind === 'multi') {
    const chars = code.slice(0, target.inputs.length).split('');
    target.inputs.forEach((input, index) => {
      fillInput(input, chars[index] || '');
    });
    return;
  }

  if (target.input) {
    fillInput(target.input, code);
  }
}

export function findOtpContinueButton(): HTMLButtonElement | null {
  for (const selector of [
    '[data-testid="login-form"] button[type="submit"]',
    'button[data-dd-action-name="Continue"]',
    'button[type="submit"]',
    'form button:not([type="button"])',
  ]) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button && isVisible(button)) {
      return button;
    }
  }

  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!isVisible(button)) {
      return false;
    }
    const text = normalizedText(button.textContent || '');
    const label = normalizedText(button.ariaLabel || '');
    const actionName = normalizedText(button.getAttribute('data-dd-action-name') || '');
    return CONTINUE_BUTTON_LABELS.some((key) => text.includes(key) || label.includes(key) || actionName.includes(key));
  }) ?? null;
}

export function buildOtpDebugData(): Record<string, unknown> {
  return {
    url: location.href,
    readyState: document.readyState,
    inputCount: document.querySelectorAll('input').length,
    candidates: Array.from(document.querySelectorAll<HTMLInputElement>('input')).slice(0, 16).map((input) => ({
      type: input.type,
      name: input.name,
      id: input.id,
      autocomplete: input.autocomplete,
      inputMode: input.inputMode,
      maxLength: input.maxLength,
      placeholder: input.placeholder,
      ariaLabel: input.ariaLabel,
      testId: input.getAttribute('data-testid') || '',
      disabled: input.disabled,
      readOnly: input.readOnly,
      visible: isVisible(input),
      likelyOtp: isLikelyOtpInput(input),
      singleDigit: isSingleDigitInput(input),
    })),
    headings: visibleTexts('h1, h2, [role="heading"]').slice(0, 8),
    buttons: visibleTexts('button').slice(0, 12),
  };
}

export function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width > 0 &&
    rect.height > 0;
}

function findMultiOtpInputs(): HTMLInputElement[] {
  const candidates = uniqueInputs([
    ...MULTI_INPUT_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll<HTMLInputElement>(selector))),
    ...Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(isSingleDigitInput),
  ]);

  return candidates
    .filter((input) => isUsableInput(input) && isVisible(input))
    .sort(compareDocumentOrder);
}

function findSingleOtpInput(): HTMLInputElement | null {
  for (const selector of STRONG_SINGLE_SELECTORS) {
    const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector)).find(isUsableOtpCandidate);
    if (input) {
      return input;
    }
  }

  const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
  const hinted = allInputs.find((input) => isUsableOtpCandidate(input) && isLikelyOtpInput(input));
  if (hinted) {
    return hinted;
  }

  return allInputs.find((input) => {
    if (!isUsableInput(input) || !isVisible(input)) {
      return false;
    }
    const type = normalizedText(input.type || 'text');
    return ['text', 'tel', 'number', ''].includes(type) && (input.inputMode === 'numeric' || input.maxLength >= 4 || allInputs.length <= 2);
  }) ?? null;
}

function isUsableOtpCandidate(input: HTMLInputElement): boolean {
  return isUsableInput(input) && (isVisible(input) || isLikelyOtpInput(input));
}

function isUsableInput(input: HTMLInputElement): boolean {
  const type = normalizedText(input.type || 'text');
  return input.isConnected &&
    !input.disabled &&
    !input.readOnly &&
    type !== 'hidden' &&
    type !== 'password' &&
    type !== 'email';
}

function isSingleDigitInput(input: HTMLInputElement): boolean {
  if (input.maxLength !== 1) {
    return false;
  }
  const haystack = inputHaystack(input);
  return input.inputMode === 'numeric' ||
    input.inputMode === 'decimal' ||
    input.type === 'tel' ||
    input.type === 'number' ||
    haystack.includes('digit') ||
    haystack.includes('数字') ||
    haystack.includes('桁') ||
    OTP_HINTS.some((key) => haystack.includes(key));
}

function isLikelyOtpInput(input: HTMLInputElement): boolean {
  const haystack = inputHaystack(input);
  return input.autocomplete === 'one-time-code' ||
    OTP_HINTS.some((key) => haystack.includes(key)) ||
    (input.inputMode === 'numeric' && input.maxLength >= 4 && input.maxLength <= 8);
}

function inputHaystack(input: HTMLInputElement): string {
  return normalizedText([
    input.name,
    input.id,
    input.placeholder,
    input.ariaLabel,
    input.autocomplete,
    input.inputMode,
    input.getAttribute('data-testid') || '',
    input.getAttribute('aria-describedby') || '',
    input.getAttribute('aria-labelledby') || '',
    input.closest('label')?.textContent || '',
    input.parentElement?.textContent || '',
  ].join(' '));
}

function fillInput(input: HTMLInputElement, value: string): void {
  input.scrollIntoView({ block: 'center', inline: 'center' });
  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(0, input.value.length);
  } catch {
    // Some numeric inputs do not support text selection.
  }
  setNativeValue(input, value);
  dispatchInputEvents(input, value);
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

function dispatchInputEvents(input: HTMLInputElement, value: string): void {
  try {
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      composed: true,
      data: value,
      inputType: 'insertText',
    }));
  } catch {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    key: value.slice(-1) || '0',
  }));
}

function visibleTexts(selector: string): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter(isVisible)
    .map((element) => compactText(element.textContent || element.ariaLabel || ''))
    .filter(Boolean);
}

function uniqueInputs(inputs: HTMLInputElement[]): HTMLInputElement[] {
  return Array.from(new Set(inputs));
}

function compareDocumentOrder(left: HTMLInputElement, right: HTMLInputElement): number {
  if (left === right) {
    return 0;
  }
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

import type { ActionResult } from './types';

const OTP_SELECTORS = [
  'input[name="code"]',
  'input[name="otp"]',
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[type="text"]',
];

export function isEmailVerificationPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/email-verification');
}

export async function fillOtpAndContinue(code: string): Promise<ActionResult> {
  const normalized = code.replace(/\D/g, '');
  if (!normalized) {
    return fail('验证码不能为空');
  }

  const input = findOtpInput();
  if (!input) {
    return fail('没有找到验证码输入框');
  }

  setNativeValue(input, normalized);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await waitForUiTick();

  const button = findContinueButton();
  if (!button) {
    return fail('没有找到验证码继续按钮');
  }

  if (button.disabled) {
    await waitForEnabled(button, 2500);
  }

  if (button.disabled) {
    return fail('验证码继续按钮仍然不可点击');
  }

  button.click();
  return ok('已填入验证码并点击继续');
}

function findOtpInput(): HTMLInputElement | null {
  for (const selector of OTP_SELECTORS) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input) {
      return input;
    }
  }

  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
  return candidates.find((input) => {
    const label = [
      input.placeholder,
      input.ariaLabel,
      input.name,
      input.id,
    ].join(' ').toLowerCase();
    return label.includes('code') || label.includes('otp') || label.includes('验证');
  }) ?? null;
}

function findContinueButton(): HTMLButtonElement | null {
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) {
    return submit;
  }

  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const text = (button.textContent || '').trim();
    return text === '继续' || text.toLowerCase() === 'continue';
  }) ?? null;
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
}

function waitForUiTick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 60));
}

function waitForEnabled(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
  const started = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (!button.disabled || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

function ok(message: string): ActionResult {
  return { ok: true, message };
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

import type { ActionResult } from './types';

const EMAIL_SELECTORS = [
  'input#email',
  'input[name="email"]',
  'input[type="email"]',
  'input[autocomplete="email"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'form button:not([type="button"])',
];

export function isChatGptLoginPage(): boolean {
  return location.hostname === 'chatgpt.com' && location.pathname.startsWith('/auth/login');
}

export async function fillEmailAndContinue(email: string): Promise<ActionResult> {
  const input = findFirst<HTMLInputElement>(EMAIL_SELECTORS);
  if (!input) {
    return fail('没有找到邮箱输入框');
  }

  setNativeValue(input, email);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await waitForUiTick();

  const button = findSubmitButton();
  if (!button) {
    return fail('没有找到继续按钮');
  }

  if (button.disabled) {
    await waitForEnabled(button, 2500);
  }

  if (button.disabled) {
    return fail('继续按钮仍然不可点击');
  }

  button.click();
  return ok('已填入邮箱并点击继续');
}

function findSubmitButton(): HTMLButtonElement | null {
  for (const selector of SUBMIT_SELECTORS) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button) {
      return button;
    }
  }

  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const text = (button.textContent || '').trim();
    return text === '继续' || text.toLowerCase() === 'continue';
  }) ?? null;
}

function findFirst<T extends Element>(selectors: string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) {
      return element;
    }
  }
  return null;
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

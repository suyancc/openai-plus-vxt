import type { ActionResult } from './types';

export type RegisterReadyKind = 'email' | 'otp' | 'profile';

const EMAIL_SELECTORS = [
  '[data-testid="login-form"] input#email[name="email"][type="email"]',
  '[data-testid="login-form"] input[name="email"][type="email"]',
  'form input#email[name="email"][type="email"]',
  'form[aria-label="选择登录选项"] input[name="email"][type="email"]',
  'input#email',
  'input[id$="-email"]',
  'input[name="email"]',
  'input[type="email"]',
  'input[autocomplete="email"]',
];

const OTP_SELECTORS = [
  'input[name="code"]',
  'input[name="otp"]',
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[type="text"]',
];

type ProfileFormMode = 'age' | 'birthday' | 'unknown';

export function checkRegisterPageReady(kind: RegisterReadyKind): ActionResult {
  if (kind === 'email') {
    return checkEmailReady();
  }
  if (kind === 'otp') {
    return checkOtpReady();
  }
  return checkProfileReady();
}

function checkEmailReady(): ActionResult {
  if (!isLoginPage()) {
    return fail('当前页面不是 ChatGPT 登录页');
  }
  const input = findVisible(EMAIL_SELECTORS) as HTMLInputElement | null;
  if (!input) {
    return fail('邮箱输入框还没有渲染完成');
  }
  if (!isWritableInput(input)) {
    return fail('邮箱输入框还不能输入', {
      inputDisabled: input.disabled,
      inputReadOnly: input.readOnly,
      inputConnected: input.isConnected,
      url: location.href,
      readyState: document.readyState,
    });
  }
  const button = findSubmitButton(['继续', 'continue', 'email']);
  if (!button) {
    return fail('继续按钮还没有渲染完成');
  }
  return ok('邮箱输入框已就绪');
}

function checkOtpReady(): ActionResult {
  if (location.hostname !== 'auth.openai.com' || !location.pathname.startsWith('/email-verification')) {
    return fail('当前页面不是邮箱验证码页');
  }
  if (!findVisible(OTP_SELECTORS)) {
    return fail('验证码输入框还没有渲染完成');
  }
  if (!findSubmitButton(['继续', 'continue'])) {
    return fail('验证码继续按钮还没有渲染完成');
  }
  return ok('验证码输入框已就绪');
}

function checkProfileReady(): ActionResult {
  if (location.hostname !== 'auth.openai.com' || !location.pathname.startsWith('/about-you')) {
    return fail('当前页面不是资料填写页');
  }
  const retryableError = findRetryableAboutYouError();
  if (retryableError) {
    return fail(`资料页错误：${retryableError}`, {
      retryableAboutYouError: true,
      errorText: retryableError,
      url: location.href,
      readyState: document.readyState,
    });
  }
  const formMode = detectProfileFormMode();
  if (formMode === 'unknown') {
    return fail('资料输入框还没有渲染完成', {
      profileFormMode: formMode,
      visibleInputs: visibleProfileInputs().length,
      hasBirthdayInput: Boolean(findBirthdayInput()),
      birthdaySegments: birthdaySegmentState(),
    });
  }
  if (!findSubmitButton(['完成帐户创建', '完成账户创建', 'create account', 'continue'])) {
    return fail('创建账号按钮还没有渲染完成');
  }
  return ok(
    formMode === 'birthday' ? '资料填写表单已就绪（生日格式）' : '资料填写表单已就绪（年龄格式）',
    { profileFormMode: formMode },
  );
}

function detectProfileFormMode(): ProfileFormMode {
  const inputs = visibleProfileInputs();
  const hasAge = inputs.some((input) => looksLikeAgeInput(input)) || findInputByText(['年龄', 'age']);
  if (hasAge) {
    return 'age';
  }
  if (hasCompleteBirthdaySegments()) {
    return 'birthday';
  }
  return 'unknown';
}

function visibleProfileInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input) => {
    const type = (input.type || 'text').toLowerCase();
    return ['text', 'number', 'tel', ''].includes(type) && isVisible(input);
  });
}

function findBirthdayInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[name="birthday"], input.react-aria-Input[name="birthday"]');
}

function hasCompleteBirthdaySegments(): boolean {
  const state = birthdaySegmentState();
  return state.year && state.month && state.day;
}

function birthdaySegmentState(): { year: boolean; month: boolean; day: boolean } {
  const segments = Array.from(document.querySelectorAll<HTMLElement>('[role="spinbutton"][data-type]')).filter(isVisible);
  return {
    year: segments.some((element) => element.dataset.type === 'year'),
    month: segments.some((element) => element.dataset.type === 'month'),
    day: segments.some((element) => element.dataset.type === 'day'),
  };
}

function findInputByText(keys: string[]): HTMLInputElement | null {
  const inputs = visibleProfileInputs();
  for (const input of inputs) {
    const haystack = [
      input.name,
      input.id,
      input.placeholder,
      input.ariaLabel,
      input.getAttribute('aria-labelledby') ? labelText(input.getAttribute('aria-labelledby') || '') : '',
      input.closest('label')?.textContent || '',
      input.parentElement?.textContent || '',
    ].join(' ').toLowerCase();
    if (keys.some((key) => haystack.includes(key.toLowerCase()))) {
      return input;
    }
  }
  return null;
}

function looksLikeAgeInput(input: HTMLInputElement): boolean {
  const text = [
    input.name,
    input.id,
    input.placeholder,
    input.ariaLabel,
    input.inputMode,
    input.type,
    input.parentElement?.textContent || '',
  ].join(' ').toLowerCase();
  return text.includes('age') || text.includes('年龄') || text.includes('numeric') || input.type === 'number';
}

function labelText(ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' ');
}

function findRetryableAboutYouError(): string {
  const title = textOf('[class*="_titleBlock_"] h1, h1, [data-testid="error-title"]');
  const subtitle = textOf('[class*="_subTitle_"], [data-testid="error-subtitle"], [role="alert"]');
  const body = normalizedText(document.body?.innerText || document.body?.textContent || '');
  const combined = normalizedText(`${title} ${subtitle}`);
  if (
    body.includes('operation timed out') ||
    combined.includes('operation timed out')
  ) {
    return compactText([title, subtitle].filter(Boolean).join('；')) || 'Operation timed out';
  }
  if (
    (body.includes('糟糕') || body.includes('oops')) &&
    (body.includes('timed out') || body.includes('timeout'))
  ) {
    return compactText([title, subtitle].filter(Boolean).join('；')) || 'Operation timed out';
  }
  return '';
}

function textOf(selector: string): string {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter(isVisible)
    .map((element) => element.textContent || '')
    .join(' ');
}

function isLoginPage(): boolean {
  return (
    location.hostname === 'chatgpt.com' &&
    location.pathname.startsWith('/auth/login')
  ) || (
    location.hostname === 'auth.openai.com' &&
    location.pathname.startsWith('/log-in')
  );
}

function findVisible(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisible);
    if (element) {
      return element;
    }
  }
  return null;
}

function findSubmitButton(labels: string[]): HTMLButtonElement | null {
  for (const selector of [
    '[data-testid="login-form"] button[type="submit"]',
    'button[name="intent"][value="email"]',
    'button[data-dd-action-name="Continue"]',
    'button[type="submit"]',
    'form button:not([type="button"])',
  ]) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button && isVisible(button)) {
      return button;
    }
  }

  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit && isVisible(submit)) {
    return submit;
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!isVisible(button)) {
      return false;
    }
    const text = (button.textContent || '').trim().toLowerCase();
    return labels.some((label) => text.includes(label.toLowerCase()));
  }) ?? null;
}

function isWritableInput(input: HTMLInputElement): boolean {
  return isVisible(input) && !input.disabled && !input.readOnly && input.isConnected;
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width > 0 &&
    rect.height > 0;
}

function ok(message: string, data?: unknown): ActionResult {
  return data === undefined ? { ok: true, message } : { ok: true, message, data };
}

function fail(message: string, data?: unknown): ActionResult {
  return data === undefined ? { ok: false, message } : { ok: false, message, data };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

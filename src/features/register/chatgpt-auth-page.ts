import type { ActionResult } from './types';

interface LocatedElement<T extends Element> {
  element: T;
  selector: string;
}

interface EmailDebugState {
  url: string;
  readyState: string;
  loginPage: boolean;
  inputFound: boolean;
  inputSelector: string;
  inputValueLength: number;
  expectedLength: number;
  inputMatchesExpected: boolean;
  inputPlaceholder: string;
  inputName: string;
  inputId: string;
  buttonFound: boolean;
  buttonSelector: string;
  buttonText: string;
  buttonDisabled: boolean;
  validationText: string;
  activeElement: string;
  inputDisabled: boolean;
  inputReadOnly: boolean;
  inputConnected: boolean;
  urlEmailParamLength: number;
  urlEmailMatchesExpected: boolean;
  fillMethod: string;
  fillMethodOk: boolean;
  fillImmediateLength: number;
  fillAfterEventLength: number;
  fillMessage: string;
}

interface EmailFillAttempt {
  method: string;
  ok: boolean;
  immediateLength: number;
  afterEventLength: number;
  message: string;
}

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

const SUBMIT_SELECTORS = [
  '[data-testid="login-form"] button[type="submit"]',
  'button[name="intent"][value="email"]',
  'button[data-dd-action-name="Continue"]',
  'button[type="submit"]',
  'form button:not([type="button"])',
];

const VALIDATION_KEYWORDS = [
  '请输入邮箱',
  '请输入电子邮件',
  '电子邮件地址',
  '无效',
  'invalid',
  'required',
  'enter an email',
  'email address',
];

let lastEmailFillAttempt: EmailFillAttempt | null = null;

export function isChatGptLoginPage(): boolean {
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

export function getEmailDebugState(expectedEmail = ''): ActionResult {
  return ok('注册邮箱页诊断已生成', collectEmailDebugState(expectedEmail));
}

export async function fillEmailAndContinue(email: string): Promise<ActionResult> {
  lastEmailFillAttempt = null;
  const inputHit = findFirst<HTMLInputElement>(EMAIL_SELECTORS);
  if (!inputHit) {
    if (urlEmailMatchesExpected(email)) {
      return clickContinueForExistingEmail(email, 'url-param-no-input', 'URL 已带邮箱参数并点击继续');
    }
    return fail('没有找到邮箱输入框', collectEmailDebugState(email));
  }

  const input = inputHit.element;
  const inputAlreadyMatches = sameEmail(input.value, email);
  if (!isWritableInput(input)) {
    await waitForWritableInput(input, 3500);
  }
  if (!isWritableInput(input)) {
    if (inputAlreadyMatches || urlEmailMatchesExpected(email)) {
      return clickContinueForExistingEmail(email, inputAlreadyMatches ? 'prefilled-readonly-input' : 'url-param-readonly-input', '邮箱已预填并点击继续');
    }
    return fail('邮箱输入框仍然不可写', collectEmailDebugState(email));
  }

  const fillAttempt = inputAlreadyMatches
    ? {
        method: 'prefilled-input',
        ok: true,
        immediateLength: input.value.length,
        afterEventLength: input.value.length,
        message: '邮箱输入框已预填目标邮箱',
      }
    : await fillEmailInput(input, email);
  lastEmailFillAttempt = fillAttempt;
  if (!fillAttempt.ok || !sameEmail(input.value, email)) {
    return fail('邮箱输入框没有接受输入值', collectEmailDebugState(email));
  }

  const buttonHit = findSubmitButton();
  if (!buttonHit) {
    return fail('没有找到继续按钮', collectEmailDebugState(email));
  }

  const button = buttonHit.element;
  if (!isClickableButton(button)) {
    await waitForClickableButton(button, 3500);
  }

  if (!isClickableButton(button)) {
    return fail('继续按钮仍然不可点击', collectEmailDebugState(email));
  }

  clickElement(button);
  await waitForUiTick(120);

  const debug = collectEmailDebugState(email);
  if (debug.loginPage && debug.inputFound && !debug.inputMatchesExpected) {
    return fail('点击继续后邮箱输入值丢失，页面没有接收本次输入', debug);
  }

  return ok(inputAlreadyMatches ? '邮箱已预填并点击继续' : '已填入邮箱并点击继续', debug);
}

async function clickContinueForExistingEmail(email: string, method: string, message: string): Promise<ActionResult> {
  const urlEmail = getUrlEmailParam();
  const input = findFirst<HTMLInputElement>(EMAIL_SELECTORS)?.element || null;
  const currentLength = input?.value.length || urlEmail.length;
  lastEmailFillAttempt = {
    method,
    ok: true,
    immediateLength: currentLength,
    afterEventLength: currentLength,
    message: input ? '邮箱输入框已预填目标邮箱' : 'URL 参数已包含目标邮箱',
  };

  const buttonHit = findSubmitButton();
  if (!buttonHit) {
    return fail('没有找到继续按钮', collectEmailDebugState(email));
  }

  const button = buttonHit.element;
  if (!isClickableButton(button)) {
    await waitForClickableButton(button, 3500);
  }
  if (!isClickableButton(button)) {
    return fail('继续按钮仍然不可点击', collectEmailDebugState(email));
  }

  clickElement(button);
  await waitForUiTick(120);
  return ok(message, collectEmailDebugState(email));
}

function findSubmitButton(): LocatedElement<HTMLButtonElement> | null {
  for (const selector of SUBMIT_SELECTORS) {
    const button = findVisible<HTMLButtonElement>(selector);
    if (button) {
      return { element: button, selector };
    }
  }

  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!isVisible(button)) {
      return false;
    }
    const text = (button.textContent || '').trim();
    return text === '继续' || text.toLowerCase() === 'continue';
  }) ?? null;

  return button ? { element: button, selector: 'button:text(继续|continue)' } : null;
}

function findFirst<T extends Element>(selectors: string[]): LocatedElement<T> | null {
  for (const selector of selectors) {
    const element = findVisible<T>(selector);
    if (element) {
      return { element, selector };
    }
  }
  return null;
}

function findVisible<T extends Element>(selector: string): T | null {
  return Array.from(document.querySelectorAll<T>(selector)).find(isVisible) ?? null;
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

function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  const style = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();
  return style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width > 0 &&
    rect.height > 0;
}

function focusInput(input: HTMLInputElement): void {
  input.scrollIntoView({ block: 'center', inline: 'center' });
  clickElement(input);
  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(0, input.value.length);
  } catch {
    // Some input types do not support selection ranges.
  }
}

async function fillEmailInput(input: HTMLInputElement, email: string): Promise<EmailFillAttempt> {
  for (const method of [fillWithNativeSetter, fillWithSetRangeText, fillWithExecCommand]) {
    focusInput(input);
    clearInput(input);
    const attempt = await method(input, email);
    if (attempt.ok) {
      return attempt;
    }
  }
  return {
    method: 'all',
    ok: false,
    immediateLength: input.value.length,
    afterEventLength: input.value.length,
    message: '所有输入策略都失败',
  };
}

async function fillWithNativeSetter(input: HTMLInputElement, email: string): Promise<EmailFillAttempt> {
  setNativeValue(input, email);
  const immediateLength = input.value.length;
  dispatchInputEvent(input, email, 'insertText');
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUiTick(220);
  return {
    method: 'native-setter',
    ok: sameEmail(input.value, email),
    immediateLength,
    afterEventLength: input.value.length,
    message: sameEmail(input.value, email) ? '原生 setter 写入成功' : '原生 setter 写入后被页面清空',
  };
}

async function fillWithSetRangeText(input: HTMLInputElement, email: string): Promise<EmailFillAttempt> {
  try {
    input.setSelectionRange(0, input.value.length);
    input.setRangeText(email, 0, input.value.length, 'end');
  } catch {
    setNativeValue(input, email);
  }
  const immediateLength = input.value.length;
  dispatchInputEvent(input, email, 'insertReplacementText');
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUiTick(220);
  return {
    method: 'set-range-text',
    ok: sameEmail(input.value, email),
    immediateLength,
    afterEventLength: input.value.length,
    message: sameEmail(input.value, email) ? 'setRangeText 写入成功' : 'setRangeText 写入后被页面清空',
  };
}

async function fillWithExecCommand(input: HTMLInputElement, email: string): Promise<EmailFillAttempt> {
  try {
    input.setSelectionRange(0, input.value.length);
  } catch {
    // Ignore selection failures and still try insertText.
  }
  const inserted = document.execCommand('insertText', false, email);
  const immediateLength = input.value.length;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUiTick(220);
  return {
    method: 'exec-command',
    ok: sameEmail(input.value, email),
    immediateLength,
    afterEventLength: input.value.length,
    message: inserted
      ? (sameEmail(input.value, email) ? 'execCommand 写入成功' : 'execCommand 写入后被页面清空')
      : 'execCommand insertText 被浏览器拒绝',
  };
}

function clearInput(input: HTMLInputElement): void {
  setNativeValue(input, '');
  dispatchInputEvent(input, '', 'deleteContentBackward');
  input.dispatchEvent(new Event('change', { bubbles: true }));
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

function dispatchInputEvent(input: HTMLInputElement, data: string, inputType: string): void {
  try {
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      composed: true,
      data,
      inputType,
    }));
  } catch {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function clickElement(element: HTMLElement): void {
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
}

function waitForUiTick(ms = 160): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForWritableInput(input: HTMLInputElement, timeoutMs: number): Promise<void> {
  const started = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (isWritableInput(input) || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

function waitForClickableButton(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
  const started = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (isClickableButton(button) || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

function collectEmailDebugState(expectedEmail = ''): EmailDebugState {
  const inputHit = findFirst<HTMLInputElement>(EMAIL_SELECTORS);
  const buttonHit = findSubmitButton();
  const input = inputHit?.element || null;
  const button = buttonHit?.element || null;
  const fillAttempt = lastEmailFillAttempt;
  return {
    url: location.href,
    readyState: document.readyState,
    loginPage: isChatGptLoginPage(),
    inputFound: Boolean(input),
    inputSelector: inputHit?.selector || '',
    inputValueLength: input?.value?.length || 0,
    expectedLength: expectedEmail.length,
    inputMatchesExpected: input ? sameEmail(input.value, expectedEmail) : false,
    inputPlaceholder: input?.placeholder || '',
    inputName: input?.name || '',
    inputId: input?.id || '',
    buttonFound: Boolean(button),
    buttonSelector: buttonHit?.selector || '',
    buttonText: (button?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    buttonDisabled: Boolean(button?.disabled),
    validationText: findValidationText(),
    activeElement: describeElement(document.activeElement),
    inputDisabled: Boolean(input?.disabled),
    inputReadOnly: Boolean(input?.readOnly),
    inputConnected: Boolean(input?.isConnected),
    urlEmailParamLength: getUrlEmailParam().length,
    urlEmailMatchesExpected: urlEmailMatchesExpected(expectedEmail),
    fillMethod: fillAttempt?.method || '',
    fillMethodOk: Boolean(fillAttempt?.ok),
    fillImmediateLength: fillAttempt?.immediateLength || 0,
    fillAfterEventLength: fillAttempt?.afterEventLength || 0,
    fillMessage: fillAttempt?.message || '',
  };
}

function findValidationText(): string {
  const selectors = [
    '[role="alert"]',
    '[aria-live]',
    '[data-testid*="error"]',
    '[class*="error"]',
    'p',
    'span',
    'div',
  ];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const element of elements) {
      if (!isVisible(element)) {
        continue;
      }
      const text = (element.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 180) {
        continue;
      }
      const normalized = text.toLowerCase();
      if (VALIDATION_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
        return text;
      }
    }
  }
  return '';
}

function describeElement(element: Element | null): string {
  if (!element) {
    return '';
  }
  const htmlElement = element as HTMLElement;
  return [
    element.tagName.toLowerCase(),
    htmlElement.id ? `#${htmlElement.id}` : '',
    htmlElement.getAttribute('name') ? `[name="${htmlElement.getAttribute('name')}"]` : '',
    htmlElement.getAttribute('type') ? `[type="${htmlElement.getAttribute('type')}"]` : '',
  ].join('');
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function getUrlEmailParam(): string {
  try {
    return new URL(location.href).searchParams.get('email') || '';
  } catch {
    return '';
  }
}

function urlEmailMatchesExpected(expectedEmail: string): boolean {
  const urlEmail = getUrlEmailParam();
  return Boolean(urlEmail.trim()) && sameEmail(urlEmail, expectedEmail);
}

function ok(message: string, data?: unknown): ActionResult {
  return { ok: true, message, data };
}

function fail(message: string, data?: unknown): ActionResult {
  return { ok: false, message, data };
}

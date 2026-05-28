import type { ActionResult } from './types';

const NAME_SELECTORS = [
  'input[name="name"]',
  'input[name="fullName"]',
  'input[autocomplete="name"]',
  'input[type="text"]',
];

const AGE_SELECTORS = [
  'input[name="age"]',
  'input[inputmode="numeric"]',
  'input[type="number"]',
  'input[type="text"]',
];

const BIRTHDAY_HIDDEN_SELECTORS = [
  'input[name="birthday"]',
  'input.react-aria-Input[name="birthday"]',
];

const BIRTHDAY_SEGMENT_SELECTOR = '[role="spinbutton"][contenteditable="true"][data-type], [role="spinbutton"][data-type]';

const FIRST_NAMES = [
  'Arlen',
  'Brennan',
  'Calvin',
  'Darian',
  'Elliot',
  'Finley',
  'Gavin',
  'Harlan',
  'Jasper',
  'Kieran',
  'Landon',
  'Morgan',
  'Nolan',
  'Parker',
  'Rowan',
  'Sawyer',
  'Tristan',
  'Warren',
];

type AboutYouFormMode = 'age' | 'birthday' | 'unknown';

interface BirthdaySegments {
  year: HTMLElement | null;
  month: HTMLElement | null;
  day: HTMLElement | null;
}

interface AboutYouFormReady {
  mode: AboutYouFormMode;
  nameInput: HTMLInputElement | null;
  ageInput: HTMLInputElement | null;
  birthdayInput: HTMLInputElement | null;
  birthdaySegments: BirthdaySegments;
  button: HTMLButtonElement | null;
}

export function isAboutYouPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/about-you');
}

export async function fillAboutYouAndCreate(): Promise<ActionResult> {
  const form = await waitForAboutYouFormReady(8_000);
  const nameInput = form.nameInput;

  if (!nameInput) {
    return fail('没有找到全名输入框');
  }

  const name = randomName();
  const age = randomInt(25, 55);

  setNativeValue(nameInput, name);
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  nameInput.dispatchEvent(new Event('change', { bubbles: true }));

  let filledLabel = `${name} / ${age}`;
  if (form.mode === 'birthday') {
    const birthday = randomBirthdayForAge(age);
    const birthdayResult = fillBirthdayField(form, birthday);
    if (!birthdayResult.ok) {
      return birthdayResult;
    }
    filledLabel = `${name} / ${birthday.value}`;
  } else {
    const ageInput = form.ageInput;
    if (!ageInput) {
      return fail('没有找到年龄输入框');
    }
    setNativeValue(ageInput, String(age));
    ageInput.dispatchEvent(new Event('input', { bubbles: true }));
    ageInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  await waitForUiTick();
  const checkboxResult = await checkVisibleCheckboxes();
  if (!checkboxResult.ok) {
    return fail(checkboxResult.message);
  }
  if (checkboxResult.checked > 0) {
    await waitForUiTick();
  }

  const button = form.button || findCreateButton();
  if (!button) {
    return fail('没有找到完成账户创建按钮');
  }

  if (!isClickableButton(button)) {
    await waitForClickable(button, 3500);
  }

  if (!isClickableButton(button)) {
    return fail('完成账户创建按钮仍然不可点击');
  }

  clickElement(button);
  return ok(checkboxResult.checked > 0
    ? `已填写 ${filledLabel}，已勾选 ${checkboxResult.checked} 个选项并点击创建`
    : `已填写 ${filledLabel} 并点击创建`);
}

async function waitForAboutYouFormReady(timeoutMs: number): Promise<AboutYouFormReady> {
  const started = Date.now();
  let last: AboutYouFormReady = emptyAboutYouForm();

  while (Date.now() - started <= timeoutMs) {
    const nameInput = findNameInput();
    const ageInput = findAgeInput(nameInput);
    const birthdayInput = findBirthdayInput();
    const birthdaySegments = findBirthdaySegments();
    const button = findCreateButton();
    const mode = detectAboutYouFormMode(ageInput, birthdayInput, birthdaySegments);
    last = { mode, nameInput, ageInput, birthdayInput, birthdaySegments, button };

    if (nameInput && button && mode !== 'unknown') {
      return last;
    }
    await waitForUiTick();
  }

  return last;
}

function emptyAboutYouForm(): AboutYouFormReady {
  return {
    mode: 'unknown',
    nameInput: null,
    ageInput: null,
    birthdayInput: null,
    birthdaySegments: { year: null, month: null, day: null },
    button: null,
  };
}

function detectAboutYouFormMode(
  ageInput: HTMLInputElement | null,
  birthdayInput: HTMLInputElement | null,
  birthdaySegments: BirthdaySegments,
): AboutYouFormMode {
  if (ageInput) {
    return 'age';
  }
  if (isVisibleBirthdayInput(birthdayInput) || hasAllBirthdaySegments(birthdaySegments)) {
    return 'birthday';
  }
  return 'unknown';
}

function findNameInput(): HTMLInputElement | null {
  const byLabel = findInputByText(['全名', '名字', 'name', 'full name']);
  if (byLabel) {
    return byLabel;
  }

  for (const selector of NAME_SELECTORS) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input && !looksLikeAgeInput(input)) {
      return input;
    }
  }

  return textInputs().find((input) => !looksLikeAgeInput(input)) ?? null;
}

function findAgeInput(nameInput: HTMLInputElement | null): HTMLInputElement | null {
  const byLabel = findInputByText(['年龄', 'age']);
  if (byLabel && byLabel !== nameInput) {
    return byLabel;
  }

  for (const selector of AGE_SELECTORS) {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(selector));
    const input = inputs.find((item) => item !== nameInput && looksLikeAgeInput(item));
    if (input) {
      return input;
    }
  }

  if (hasAnyBirthdaySegment(findBirthdaySegments())) {
    return null;
  }

  return textInputs().find((input) => input !== nameInput) ?? null;
}

function findBirthdayInput(): HTMLInputElement | null {
  for (const selector of BIRTHDAY_HIDDEN_SELECTORS) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input) {
      return input;
    }
  }
  return null;
}

function findBirthdaySegments(): BirthdaySegments {
  const segments = Array.from(document.querySelectorAll<HTMLElement>(BIRTHDAY_SEGMENT_SELECTOR));
  return {
    year: segments.find((element) => element.dataset.type === 'year') || null,
    month: segments.find((element) => element.dataset.type === 'month') || null,
    day: segments.find((element) => element.dataset.type === 'day') || null,
  };
}

function hasAllBirthdaySegments(segments: BirthdaySegments): boolean {
  return Boolean(segments.year && segments.month && segments.day);
}

function hasAnyBirthdaySegment(segments: BirthdaySegments): boolean {
  return Boolean(segments.year || segments.month || segments.day);
}

function fillBirthdayField(form: AboutYouFormReady, birthday: BirthdayValue): ActionResult {
  if (!isVisibleBirthdayInput(form.birthdayInput) && !hasAllBirthdaySegments(form.birthdaySegments)) {
    return fail('没有找到生日输入控件');
  }

  if (form.birthdayInput) {
    setNativeValue(form.birthdayInput, birthday.value);
    form.birthdayInput.dispatchEvent(new Event('input', { bubbles: true }));
    form.birthdayInput.dispatchEvent(new Event('change', { bubbles: true }));
    clearInvalidState(form.birthdayInput);
  }

  if (hasAllBirthdaySegments(form.birthdaySegments)) {
    setEditableSegmentValue(form.birthdaySegments.year as HTMLElement, String(birthday.year));
    setEditableSegmentValue(form.birthdaySegments.month as HTMLElement, pad2(birthday.month));
    setEditableSegmentValue(form.birthdaySegments.day as HTMLElement, pad2(birthday.day));
    clearInvalidState(form.birthdaySegments.year as HTMLElement);
    clearInvalidState(form.birthdaySegments.month as HTMLElement);
    clearInvalidState(form.birthdaySegments.day as HTMLElement);
    const group = (form.birthdaySegments.year as HTMLElement).closest<HTMLElement>('[role="group"], .react-aria-DateField');
    if (group) {
      clearInvalidState(group);
    }
  }

  return ok('生日已填写');
}

function isVisibleBirthdayInput(input: HTMLInputElement | null): boolean {
  if (!input) {
    return false;
  }
  return input.type !== 'hidden' && isVisible(input);
}

function findInputByText(keys: string[]): HTMLInputElement | null {
  const inputs = textInputs();
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

function labelText(ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' ');
}

function textInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input) => {
    const type = (input.type || 'text').toLowerCase();
    return ['text', 'number', 'tel', ''].includes(type);
  });
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

function findCreateButton(): HTMLButtonElement | null {
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit && isVisible(submit)) {
    return submit;
  }

  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    if (!isVisible(button)) {
      return false;
    }
    const text = (button.textContent || '').trim().toLowerCase();
    return (
      text.includes('完成帐户创建') ||
      text.includes('完成账户创建') ||
      text.includes('create account') ||
      text.includes('continue')
    );
  }) ?? null;
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
}

function setEditableSegmentValue(element: HTMLElement, value: string): void {
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  element.focus();
  selectElementContents(element);
  const inserted = document.execCommand?.('insertText', false, value) === true;
  if (!inserted || element.textContent?.trim() !== value) {
    element.textContent = value;
  }
  element.setAttribute('aria-valuenow', String(Number(value)));
  element.setAttribute('aria-valuetext', value);
  element.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: value,
    inputType: 'insertReplacementText',
  }));
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: value,
    inputType: 'insertReplacementText',
  }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
}

function selectElementContents(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearInvalidState(element: HTMLElement): void {
  element.removeAttribute('data-invalid');
  element.setAttribute('aria-invalid', 'false');
}

async function checkVisibleCheckboxes(): Promise<{ ok: boolean; checked: number; message: string }> {
  let checked = 0;
  const checkboxes = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="allCheckboxes"]'),
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([name="allCheckboxes"])'),
  ]
    .filter((checkbox) => !checkbox.checked && !checkbox.disabled && isCheckboxReachable(checkbox));

  for (const checkbox of checkboxes) {
    if (await checkCheckbox(checkbox)) {
      checked += 1;
      continue;
    }
    if (checkbox.name === 'allCheckboxes') {
      return { ok: false, checked, message: '没有成功勾选“我同意以下所有各项”' };
    }
  }

  return { ok: true, checked, message: '' };
}

async function checkCheckbox(checkbox: HTMLInputElement): Promise<boolean> {
  const label = findCheckboxLabel(checkbox);
  const targets = [
    label,
    checkbox,
    label?.querySelector<HTMLElement>('span, div'),
  ].filter((target): target is HTMLElement => Boolean(target));

  for (const target of targets) {
    clickElement(target);
    await waitForChecked(checkbox, 350);
    if (checkbox.checked) {
      return true;
    }
  }

  if (!checkbox.checked) {
    setNativeChecked(checkbox, true);
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForChecked(checkbox, 350);
  }

  return checkbox.checked;
}

function setNativeChecked(input: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  if (descriptor?.set) {
    descriptor.set.call(input, checked);
  } else {
    input.checked = checked;
  }
}

function findCheckboxLabel(checkbox: HTMLInputElement): HTMLLabelElement | null {
  const closestLabel = checkbox.closest<HTMLLabelElement>('label');
  if (closestLabel) {
    return closestLabel;
  }
  if (!checkbox.id) {
    return null;
  }
  return document.querySelector<HTMLLabelElement>(`label[for="${cssEscape(checkbox.id)}"]`);
}

function isCheckboxReachable(checkbox: HTMLInputElement): boolean {
  return isVisible(checkbox) || Boolean(findCheckboxLabel(checkbox) && isVisible(findCheckboxLabel(checkbox) as HTMLElement));
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0;
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

function waitForChecked(checkbox: HTMLInputElement, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (checkbox.checked || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(check, 40);
    };
    check();
  });
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

function waitForUiTick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 80));
}

function waitForClickable(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
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

function isClickableButton(button: HTMLButtonElement): boolean {
  return isVisible(button) &&
    !button.disabled &&
    button.getAttribute('aria-disabled') !== 'true' &&
    button.dataset.disabled !== 'true';
}

function randomName(): string {
  return FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
}

interface BirthdayValue {
  year: number;
  month: number;
  day: number;
  value: string;
}

function randomBirthdayForAge(age: number): BirthdayValue {
  const currentYear = new Date().getFullYear();
  const year = currentYear - age - 1;
  const month = randomInt(1, 12);
  const day = randomInt(1, daysInMonth(year, month));
  return {
    year,
    month,
    day,
    value: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ok(message: string): ActionResult {
  return { ok: true, message };
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

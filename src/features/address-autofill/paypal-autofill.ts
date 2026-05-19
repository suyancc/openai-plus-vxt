import { loadRegisterState } from '../../app/state';
import { parseAccountInput } from '../register/account-input';
import { loadAddressAutofillSettings, saveAddressAutofillSettings } from '../settings/state';
import type { AddressAutofillSettings } from '../settings/types';
import type { AddressProfile, RandomAddressResponse } from './types';

const LOG_PREFIX = '[OPX PayPal Autofill]';
const PAYPAL_ADDRESS_SESSION_KEY = 'opx.paypal.autofill.address';
const PAYPAL_PENDING_MANUAL_KEY = 'opx.paypal.autofill.pendingManual';
const PAYPAL_FILLED_ATTR = 'data-opx-paypal-filled';
const PAYPAL_RANDOM_BUTTON_ID = 'opx-paypal-random-fill';
const MAX_AUTOFILL_ATTEMPTS_PER_PAGE = 3;
const PAYPAL_COUNTRY_LABELS: Record<string, string> = {
  AR: 'Argentina',
  AU: 'Australia',
  CA: 'Canada',
  CN: 'China',
  DE: 'Germany',
  ES: 'Spain',
  FR: 'France',
  GB: 'United Kingdom',
  HK: 'Hong Kong',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  MY: 'Malaysia',
  NL: 'Netherlands',
  PH: 'Philippines',
  RU: 'Russia',
  SG: 'Singapore',
  TH: 'Thailand',
  TR: 'Turkey',
  TW: 'Taiwan',
  US: 'United States',
  VN: 'Vietnam',
};

let initialized = false;
let running = false;
let scheduledTimer: number | null = null;
let pageAddress: AddressProfile | null = null;
let observer: MutationObserver | null = null;
let attemptKey = '';
let attemptCount = 0;
let manualFillKey = '';

export function initPaypalAutofill(): void {
  if (initialized || !isPaypalSignupPage()) {
    return;
  }

  initialized = true;
  installRandomFillButton();
  installStorageListener();
  installObserver();
  if (consumePendingManualFill()) {
    scheduleManualSessionAutofill(900);
  } else {
    scheduleAutofill(800);
  }
}

export async function fillPaypalAddressNow(
  address?: AddressProfile,
  force = false,
  allowRetry = true,
): Promise<{ ok: boolean; filled: number; message: string; countryChanged: boolean }> {
  if (!isPaypalSignupPage()) {
    return { ok: false, filled: 0, message: '当前不是 PayPal 注册支付页', countryChanged: false };
  }

  const settings = await loadAddressAutofillSettings();
  const targetAddress = address || await getPageAddress(settings);
  if (!targetAddress) {
    return { ok: false, filled: 0, message: '没有可用地址资料', countryChanged: false };
  }

  rememberSessionAddress(targetAddress);
  if (force && !allowRetry) {
    cancelScheduledAutofill();
  }
  if (force) {
    resetFilledMarks();
    resetAttempts();
  }
  const result = await fillPaypalSignupFields(targetAddress, allowRetry);
  noteAttempt(targetAddress, result.countryChanged, allowRetry);
  if (force && !allowRetry) {
    manualFillKey = pageAttemptKey(targetAddress);
    if (result.countryChanged) {
      markPendingManualFill();
      scheduleManualSessionAutofill(1600);
    } else {
      clearPendingManualFill();
    }
  }
  return {
    ok: result.filled > 0 || result.countryChanged,
    filled: result.filled,
    countryChanged: result.countryChanged,
    message: result.countryChanged
      ? `已选择 PayPal 国家：${targetAddress.countryCode}，等待页面重新加载`
      : result.filled > 0
        ? `已填写 PayPal ${result.filled} 项`
        : '未找到可填写的 PayPal 字段',
  };
}

async function runAutofill(): Promise<void> {
  if (running) {
    return;
  }
  if (manualFillKey && attemptKey === manualFillKey) {
    return;
  }

  running = true;
  try {
    const settings = await loadAddressAutofillSettings();
    if (!settings.payPalSignupEnabled) {
      console.info(`${LOG_PREFIX} disabled`);
      return;
    }

    const result = await fillPaypalAddressNow();
    console.info(`${LOG_PREFIX} ${result.message}`);
    if (!result.ok || reachedAttemptLimit()) {
      observer?.disconnect();
      observer = null;
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed`, error);
  } finally {
    running = false;
  }
}

async function getPageAddress(settings: AddressAutofillSettings): Promise<AddressProfile | null> {
  if (pageAddress && addressMatchesSettings(pageAddress, settings)) {
    return pageAddress;
  }

  const sessionAddress = loadSessionAddress();
  if (sessionAddress && addressMatchesSettings(sessionAddress, settings)) {
    pageAddress = sessionAddress;
    return pageAddress;
  }

  const response = await browser.runtime.sendMessage({
    type: 'opx:fetch-random-address',
    countryCode: settings.countryCode,
    city: settings.city,
  });

  if (!isRandomAddressResponse(response) || !response.ok || !response.address) {
    console.warn(`${LOG_PREFIX} address fetch failed`, response);
    return null;
  }

  pageAddress = response.address;
  rememberSessionAddress(response.address);
  await saveAddressAutofillSettings({ lastAddress: response.address });
  return pageAddress;
}

async function fillPaypalSignupFields(address: AddressProfile, allowRetry: boolean): Promise<{ filled: number; countryChanged: boolean }> {
  let filled = 0;
  const countryChanged = selectCountry(address);
  if (countryChanged) {
    if (allowRetry) {
      scheduleAutofill(1500);
    }
    return { filled: 1, countryChanged: true };
  }

  const email = await resolveEmail(address);
  const name = splitName(address.fullName);
  const expiry = parseExpiry(address.creditCard.expires);

  filled += fillText(PAYPAL_FIELDS.email, email, true);
  filled += fillPasswordField(email);
  renderPasswordEmailNote(email);
  filled += fillText(PAYPAL_FIELDS.phone, address.phone, true);
  filled += fillText(PAYPAL_FIELDS.cardNumber, address.creditCard.number, true);
  filled += fillText(PAYPAL_FIELDS.expiry, expiry.short, true);
  filled += fillText(PAYPAL_FIELDS.csc, address.creditCard.cvv, true);
  filled += fillText(PAYPAL_FIELDS.fullName, address.fullName, true);
  filled += fillText(PAYPAL_FIELDS.firstName, name.first, true);
  filled += fillText(PAYPAL_FIELDS.lastName, name.last, true);
  filled += fillText(PAYPAL_FIELDS.address1, address.line1, true);
  filled += fillText(PAYPAL_FIELDS.address2, address.line2, true);
  filled += fillText(PAYPAL_FIELDS.city, address.city, true);
  filled += fillSelectOrInput(PAYPAL_FIELDS.state, address.state, [address.stateFull, address.state]);
  filled += fillText(PAYPAL_FIELDS.postalCode, address.postalCode, true);
  filled += fillBillingAddressGroup(address, name);
  filled += fillSelectOrInput(PAYPAL_FIELDS.expiryMonth, expiry.month, [expiry.month]);
  filled += fillSelectOrInput(PAYPAL_FIELDS.expiryYear, expiry.year4, [expiry.year4, expiry.year2]);

  return { filled, countryChanged: false };
}

function selectCountry(address: AddressProfile): boolean {
  const select = findSelect(PAYPAL_FIELDS.country);
  if (!select || !isVisible(select)) {
    return false;
  }

  return setSelectOption(select, address.countryCode, [
    address.countryCode,
    PAYPAL_COUNTRY_LABELS[address.countryCode] || '',
    address.countryLabel,
  ]);
}

async function resolveEmail(address: AddressProfile): Promise<string> {
  const register = await loadRegisterState();
  const parsed = parseAccountInput(register.rawInput);
  if (parsed.ok && isEmail(parsed.email)) {
    return parsed.email;
  }
  if (isEmail(register.email)) {
    return register.email;
  }
  if (isEmail(address.identity.temporaryMail)) {
    return address.identity.temporaryMail;
  }
  return createOutlookEmail(address);
}

function fillText(selectors: string[], value: string, overwrite: boolean): number {
  if (!value) {
    return 0;
  }

  const input = findTextControl(selectors);
  if (!input || !isVisible(input)) {
    return 0;
  }

  return fillTextControl(input, value, overwrite);
}

function fillTextControl(input: HTMLInputElement | HTMLTextAreaElement, value: string, overwrite: boolean): number {
  if (!value || !isVisible(input)) {
    return 0;
  }

  const currentValue = input.value.trim();
  if (input.getAttribute(PAYPAL_FILLED_ATTR) === '1' || equivalentValue(currentValue, value)) {
    input.setAttribute(PAYPAL_FILLED_ATTR, '1');
    return 0;
  }
  if (!overwrite && currentValue) {
    return 0;
  }

  setNativeValue(input, value);
  input.setAttribute(PAYPAL_FILLED_ATTR, '1');
  return 1;
}

function fillPasswordField(value: string): number {
  if (!value) {
    return 0;
  }

  const input = document.querySelector<HTMLInputElement>('input#password') ||
    findTextControl(PAYPAL_FIELDS.password);
  if (!input || !isVisible(input)) {
    return 0;
  }

  const currentValue = input.value.trim();
  if (equivalentValue(currentValue, value)) {
    return 0;
  }

  setNativeValue(input, value);
  return 1;
}

function renderPasswordEmailNote(email: string): void {
  const anchor = findPasswordDisclaimerAnchor();
  if (!anchor) {
    return;
  }

  fillPasswordField(email);

  const noteId = 'opx-paypal-password-note';
  const text = `当前密码和邮箱一致（${email}）`;
  let note = document.getElementById(noteId);
  if (!note) {
    note = document.createElement('div');
    note.id = noteId;
    Object.assign(note.style, {
      color: '#93e4bd',
      fontSize: '12px',
      lineHeight: '18px',
      margin: '4px 0 10px',
      padding: '6px 10px',
      border: '1px solid rgba(47, 209, 124, 0.36)',
      borderRadius: '6px',
      background: 'rgba(15, 23, 42, 0.82)',
      display: 'block',
    });
  }
  const parent = anchor.parentElement;
  if (!parent) {
    return;
  }
  parent.insertBefore(note, anchor);
  note.textContent = text;
}

function fillSelectOrInput(selectors: string[], preferredValue: string, preferredLabels: string[]): number {
  if (!preferredValue && !preferredLabels.some(Boolean)) {
    return 0;
  }

  const select = findSelect(selectors);
  if (select && isVisible(select)) {
    return setSelectOption(select, preferredValue, preferredLabels) ? 1 : 0;
  }

  return fillText(selectors, preferredValue || preferredLabels.find(Boolean) || '', true);
}

function fillBillingAddressGroup(address: AddressProfile, name: { first: string; last: string }): number {
  const group = findBillingAddressGroup();
  if (!group) {
    return 0;
  }

  const fallbackControls = Array.from(group.querySelectorAll('input, textarea, select'))
    .filter((control): control is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      (isTextControl(control) || isSelectControl(control)) &&
      isVisible(control) &&
      !isIgnoredInput(control) &&
      !isLikelyEmailPhoneOrCard(control),
    );

  let filled = 0;
  filled += fillGroupText(group, ['first name', 'given name'], name.first, fallbackControls[0]);
  filled += fillGroupText(group, ['last name', 'family name', 'surname'], name.last, fallbackControls[1]);
  filled += fillGroupText(group, ['street address', 'address line 1', 'address 1'], address.line1, fallbackControls[2]);
  filled += fillGroupText(group, ['apt', 'ste', 'bldg', 'address line 2', 'address 2'], address.line2, fallbackControls[3]);
  filled += fillGroupText(group, ['city', 'locality'], address.city, fallbackControls[4]);
  filled += fillGroupSelectOrInput(group, ['state', 'province', 'region'], address.state, [address.stateFull, address.state], fallbackControls[5]);
  filled += fillGroupText(group, ['zip', 'postal code', 'postcode'], address.postalCode, fallbackControls[6]);
  return filled;
}

function fillGroupText(
  group: Element,
  needles: string[],
  value: string,
  fallback?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): number {
  const fallbackText: HTMLInputElement | HTMLTextAreaElement | null = fallback && isTextControl(fallback) ? fallback : null;
  const control = findControlInGroup(group, needles, isTextControl) ||
    fallbackText;
  return control ? fillTextControl(control, value, true) : 0;
}

function fillGroupSelectOrInput(
  group: Element,
  needles: string[],
  preferredValue: string,
  preferredLabels: string[],
  fallback?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): number {
  const fallbackSelect: HTMLSelectElement | null = fallback && isSelectControl(fallback) ? fallback : null;
  const select = findControlInGroup(group, needles, isSelectControl) ||
    fallbackSelect;
  if (select) {
    return setSelectOption(select, preferredValue, preferredLabels) ? 1 : 0;
  }

  const fallbackText: HTMLInputElement | HTMLTextAreaElement | null = fallback && isTextControl(fallback) ? fallback : null;
  const input = findControlInGroup(group, needles, isTextControl) ||
    fallbackText;
  return input ? fillTextControl(input, preferredValue || preferredLabels.find(Boolean) || '', true) : 0;
}

function findBillingAddressGroup(): Element | null {
  return Array.from(document.querySelectorAll('fieldset, [role="group"], section, form > div'))
    .find((element) => {
      const text = normalizedText(element.textContent || '');
      return text.includes('billing address') &&
        (text.includes('street address') || text.includes('address')) &&
        (text.includes('first name') || text.includes('last name'));
    }) || null;
}

function findControlInGroup<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  group: Element,
  needles: string[],
  guard: (element: Element | null) => element is T,
): T | null {
  const normalizedNeedles = needles.map(normalizedText).filter(Boolean);
  const controls = Array.from(group.querySelectorAll('input, textarea, select')).filter(guard);
  const candidates = controls
    .map((control) => ({
      control,
      score: scoreControlMatch(control, normalizedNeedles),
    }))
    .filter((item) => item.score > 0 && isVisible(item.control) && !isIgnoredInput(item.control))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.control || null;
}

function findTextControl(selectors: string[]): HTMLInputElement | HTMLTextAreaElement | null {
  for (const selector of selectors) {
    const element = querySelectorCandidate(selector);
    if (isTextControl(element)) {
      return element;
    }
  }

  return findControlByNeedles(selectors, isTextControl);
}

function findSelect(selectors: string[]): HTMLSelectElement | null {
  for (const selector of selectors) {
    const element = querySelectorCandidate(selector);
    if (isSelectControl(element)) {
      return element;
    }
  }

  return findControlByNeedles(selectors, isSelectControl);
}

function querySelectorCandidate(selector: string): Element | null {
  if (!isCssSelectorCandidate(selector)) {
    return null;
  }
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function isCssSelectorCandidate(value: string): boolean {
  const selector = value.trim();
  return /^[.#[]/.test(selector) ||
    /^(input|select|textarea|button|label|form|fieldset|section|div)([#.[\s:]|$)/i.test(selector);
}

function findControlByNeedles<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  needles: string[],
  guard: (element: Element | null) => element is T,
): T | null {
  const normalizedNeedles = needles
    .filter((item) => !item.includes('[') && !item.includes('#') && !item.includes('.'))
    .map(normalizedText)
    .filter(Boolean);

  if (!normalizedNeedles.length) {
    return null;
  }

  const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(guard);
  const candidates = controls
    .map((control) => ({
      control,
      score: scoreControlMatch(control, normalizedNeedles),
    }))
    .filter((item) => item.score > 0 && isVisible(item.control) && !isIgnoredInput(item.control))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.control || null;
}

function scoreControlMatch(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  normalizedNeedles: string[],
): number {
  if (!isVisible(control) || isIgnoredInput(control)) {
    return 0;
  }

  const directText = normalizedText([
    control.id,
    control.name,
    'placeholder' in control ? control.placeholder : '',
    'autocomplete' in control ? control.autocomplete : '',
    control.getAttribute('aria-label'),
    labelledText(control),
    closestLabelText(control),
  ].join(' '));

  const nearbyText = normalizedText([
    control.previousElementSibling?.textContent,
    control.nextElementSibling?.textContent,
    compactContainerText(control),
  ].join(' '));

  const broadText = normalizedText(control.parentElement?.textContent || '');

  if (normalizedNeedles.some((needle) => directText.includes(needle))) {
    return 30;
  }
  if (normalizedNeedles.some((needle) => nearbyText.includes(needle))) {
    return 20;
  }
  if (broadText.length <= 120 && normalizedNeedles.some((needle) => broadText.includes(needle))) {
    return 5;
  }
  return 0;
}

function labelledText(control: HTMLElement): string {
  const labels: string[] = [];
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const element = document.getElementById(id);
      if (element?.textContent) {
        labels.push(element.textContent);
      }
    }
  }

  const id = control.id;
  if (id) {
    for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>(`label[for="${cssEscape(id)}"]`))) {
      labels.push(label.textContent || '');
    }
  }

  return labels.join(' ');
}

function closestLabelText(control: HTMLElement): string {
  return control.closest('label')?.textContent || '';
}

function compactContainerText(control: HTMLElement): string {
  const container = control.closest('div, label, section');
  const text = container?.textContent || '';
  return text.length <= 160 ? text : '';
}

function resetFilledMarks(): void {
  for (const element of Array.from(document.querySelectorAll(`[${PAYPAL_FILLED_ATTR}]`))) {
    element.removeAttribute(PAYPAL_FILLED_ATTR);
  }
}

function noteAttempt(address: AddressProfile, countryChanged: boolean, allowRetry: boolean): void {
  const key = pageAttemptKey(address);
  if (attemptKey !== key) {
    attemptKey = key;
    attemptCount = 0;
  }
  attemptCount += 1;
  if (allowRetry && !countryChanged && attemptCount < MAX_AUTOFILL_ATTEMPTS_PER_PAGE) {
    scheduleAutofill(1200);
  }
}

function reachedAttemptLimit(): boolean {
  return Boolean(attemptKey && attemptCount >= MAX_AUTOFILL_ATTEMPTS_PER_PAGE);
}

function resetAttempts(): void {
  attemptKey = '';
  attemptCount = 0;
  manualFillKey = '';
}

function pageAttemptKey(address: AddressProfile): string {
  return [
    location.origin,
    location.pathname,
    new URLSearchParams(location.search).get('token') || '',
    address.id,
  ].join('|');
}

function equivalentValue(currentValue: string, targetValue: string): boolean {
  if (!currentValue || !targetValue) {
    return false;
  }
  if (currentValue === targetValue) {
    return true;
  }
  return comparableValue(currentValue) === comparableValue(targetValue);
}

function comparableValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

function setSelectOption(select: HTMLSelectElement, preferredValue: string, preferredLabels: string[]): boolean {
  const normalizedPreferred = normalizedText(preferredValue);
  const labelNeedles = preferredLabels.map(normalizedText).filter(Boolean);
  const options = Array.from(select.options).filter((option) => !option.disabled && option.value);
  const option = options.find((item) => normalizedText(item.value) === normalizedPreferred) ||
    options.find((item) => labelNeedles.some((needle) => normalizedText(`${item.text} ${item.value}`).includes(needle)));

  if (!option || select.value === option.value) {
    return false;
  }

  select.value = option.value;
  emitChange(select);
  return true;
}

function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.focus();
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  emitChange(input);
}

function emitChange(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function installObserver(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    installRandomFillButton();
    if (manualFillKey && attemptKey === manualFillKey) {
      return;
    }
    if (!reachedAttemptLimit()) {
      scheduleAutofill(350);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function installRandomFillButton(): void {
  if (!isPaypalSignupPage() || document.getElementById(PAYPAL_RANDOM_BUTTON_ID)) {
    return;
  }

  const cardBrandAnchor = findPayPalHintAnchor();
  const cardFieldAnchor = findCardFieldAnchor();
  const widget = createRandomFillWidget();
  if (cardBrandAnchor?.parentElement) {
    widget.style.marginTop = '8px';
    widget.style.marginBottom = '12px';
    cardBrandAnchor.parentElement.insertBefore(widget, cardBrandAnchor.nextSibling);
    return;
  }
  if (cardFieldAnchor?.parentElement) {
    cardFieldAnchor.parentElement.insertBefore(widget, cardFieldAnchor);
  }
}

function createRandomFillWidget(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.id = PAYPAL_RANDOM_BUTTON_ID;
  wrapper.setAttribute('data-opx-paypal-random-fill', '1');
  Object.assign(wrapper.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    margin: '10px 0 14px',
    minHeight: '32px',
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '随机输入';
  Object.assign(button.style, {
    appearance: 'none',
    border: '0',
    borderRadius: '6px',
    background: '#10b981',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '700',
    lineHeight: '1',
    minHeight: '32px',
    padding: '0 14px',
    whiteSpace: 'nowrap',
  });

  const status = document.createElement('span');
  Object.assign(status.style, {
    color: '#64748b',
    fontSize: '12px',
    lineHeight: '16px',
    minWidth: '0',
  });

  button.addEventListener('click', () => {
    void fetchFreshAddressAndFill(button, status);
  });
  wrapper.append(button, status);
  return wrapper;
}

async function fetchFreshAddressAndFill(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
  button.disabled = true;
  button.textContent = '获取中...';
  Object.assign(button.style, {
    cursor: 'wait',
    opacity: '0.72',
  });
  status.textContent = '正在获取新资料';

  try {
    const settings = await loadAddressAutofillSettings();
    const response = await browser.runtime.sendMessage({
      type: 'opx:fetch-random-address',
      countryCode: settings.countryCode,
      city: settings.city,
    });

    if (!isRandomAddressResponse(response) || !response.ok || !response.address) {
      status.textContent = response?.message || '获取失败';
      return;
    }

    pageAddress = response.address;
    rememberSessionAddress(response.address);
    await saveAddressAutofillSettings({ lastAddress: response.address });
    const result = await fillPaypalAddressNow(response.address, true, false);
    status.textContent = result.countryChanged
      ? '已切换国家，刷新后继续填写'
      : result.ok
        ? `已随机输入 ${result.filled} 项`
        : result.message;
  } catch (error) {
    status.textContent = `失败：${errorMessage(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = '随机输入';
    Object.assign(button.style, {
      cursor: 'pointer',
      opacity: '1',
    });
  }
}

function findCardBrandAnchor(): Element | null {
  const exact = document.querySelector('div.css-ltr-cssveg > form > section.css-ltr-1hukb6e:nth-of-type(2) > div.css-ltr-cqmk4p:nth-of-type(1)');
  if (exact && isVisible(exact)) {
    return exact;
  }

  const candidates = Array.from(document.querySelectorAll('form section div, form div'))
    .map((element) => ({
      element,
      score: scoreCardBrandAnchor(element),
    }))
    .filter((item) => item.score > 0 && isVisible(item.element))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

function scoreCardBrandAnchor(element: Element): number {
  const text = cardBrandText(element);
  if (!text || text.length > 260) {
    return 0;
  }

  const brandCount = ['mastercard', 'discover', 'visa', 'american express', 'diners']
    .filter((brand) => text.includes(brand))
    .length;
  if (brandCount < 2) {
    return 0;
  }

  const cardInput = findTextControl(PAYPAL_FIELDS.cardNumber);
  const isBeforeCardInput = cardInput
    ? Boolean(element.compareDocumentPosition(cardInput) & Node.DOCUMENT_POSITION_FOLLOWING)
    : true;
  return brandCount * 10 + (isBeforeCardInput ? 5 : 0);
}

function cardBrandText(element: Element): string {
  const imageText = Array.from(element.querySelectorAll('img'))
    .map((image) => [image.alt, image.title, image.getAttribute('aria-label')].join(' '))
    .join(' ');
  const svgText = Array.from(element.querySelectorAll('svg title'))
    .map((title) => title.textContent || '')
    .join(' ');
  return normalizedText([element.textContent, imageText, svgText].join(' '));
}

function findCardFieldAnchor(): Element | null {
  const cardInput = findTextControl(PAYPAL_FIELDS.cardNumber);
  return cardInput?.closest('div, label, section') || cardInput;
}

function findPayPalHintAnchor(): Element | null {
  const exact = document.querySelector('div.css-ltr-cssveg > form > section.css-ltr-4jicje:nth-of-type(1) > p.css-ltr-6pd54h.css-ltr-16jt5za-text_body');
  if (exact && isVisible(exact)) {
    return exact;
  }

  const candidates = Array.from(document.querySelectorAll('form section p, form p'))
    .filter((element) => isVisible(element))
    .map((element) => ({
      element,
      score: scoreHintAnchor(element),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

function findPasswordDisclaimerAnchor(): Element | null {
  const exact = document.querySelector('section.css-ltr-h5yxuz:nth-of-type(3) > div.css-ltr-h5yxuz:nth-of-type(2) > div.css-ltr-1lvkl1r:nth-of-type(2) > p.css-ltr-abbmt5:nth-of-type(1)');
  if (exact && isVisible(exact)) {
    return exact;
  }

  const passwordInput = document.querySelector<HTMLInputElement>('input#password') ||
    findTextControl(PAYPAL_FIELDS.password);
  const passwordSection = passwordInput?.closest('section');
  const scope = passwordSection || document;
  const candidates = Array.from(scope.querySelectorAll('p'))
    .filter((element) => isVisible(element))
    .map((element) => ({
      element,
      score: scorePasswordDisclaimerAnchor(element, passwordInput),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

function scorePasswordDisclaimerAnchor(element: Element, passwordInput?: HTMLInputElement | HTMLTextAreaElement | null): number {
  const text = normalizedText(element.textContent || '');
  if (!text) {
    return 0;
  }
  const keywords = [
    'by creating an account',
    'confirm you’re at least 18 years old',
    "confirm you're at least 18 years old",
    'agree to the',
    'privacy statement',
  ];
  const hasDisclaimerText = keywords.some((keyword) => text.includes(normalizedText(keyword)));
  if (!hasDisclaimerText) {
    return 0;
  }
  const afterPassword = passwordInput
    ? Boolean(passwordInput.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    : false;
  return afterPassword ? 20 : 10;
}

function scoreHintAnchor(element: Element): number {
  const text = normalizedText(element.textContent || '');
  if (!text) {
    return 0;
  }
  const keywords = [
    'we don’t share your financial details with the merchant',
    "we don't share your financial details with the merchant",
    'financial details',
    'merchant',
  ];
  return keywords.some((keyword) => text.includes(normalizedText(keyword))) ? 10 : 0;
}

function installStorageListener(): void {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (Object.keys(changes).some((key) => key.includes('settings'))) {
      pageAddress = null;
      resetAttempts();
      scheduleAutofill(100);
    }
  });
}

function scheduleAutofill(delayMs: number): void {
  cancelScheduledAutofill();
  scheduledTimer = window.setTimeout(() => {
    scheduledTimer = null;
    void runAutofill();
  }, delayMs);
}

function cancelScheduledAutofill(): void {
  if (scheduledTimer) {
    window.clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

function scheduleManualSessionAutofill(delayMs: number): void {
  window.setTimeout(() => {
    const address = loadSessionAddress();
    if (!address) {
      clearPendingManualFill();
      return;
    }
    void fillPaypalAddressNow(address, true, false);
  }, delayMs);
}

function loadSessionAddress(): AddressProfile | null {
  try {
    const raw = sessionStorage.getItem(PAYPAL_ADDRESS_SESSION_KEY);
    return raw ? JSON.parse(raw) as AddressProfile : null;
  } catch {
    return null;
  }
}

function markPendingManualFill(): void {
  try {
    sessionStorage.setItem(PAYPAL_PENDING_MANUAL_KEY, '1');
  } catch {
    // Ignore storage failures on restricted pages.
  }
}

function consumePendingManualFill(): boolean {
  try {
    const pending = sessionStorage.getItem(PAYPAL_PENDING_MANUAL_KEY) === '1';
    if (pending) {
      sessionStorage.removeItem(PAYPAL_PENDING_MANUAL_KEY);
    }
    return pending;
  } catch {
    return false;
  }
}

function clearPendingManualFill(): void {
  try {
    sessionStorage.removeItem(PAYPAL_PENDING_MANUAL_KEY);
  } catch {
    // Ignore storage failures on restricted pages.
  }
}

function rememberSessionAddress(address: AddressProfile): void {
  try {
    sessionStorage.setItem(PAYPAL_ADDRESS_SESSION_KEY, JSON.stringify(address));
  } catch {
    // Ignore storage failures on restricted pages.
  }
}

function addressMatchesSettings(address: AddressProfile, settings: AddressAutofillSettings): boolean {
  const countryMatches = settings.countryCode === 'RANDOM' || address.countryCode === settings.countryCode;
  const cityMatches = !settings.city.trim() || normalizedText(address.city) === normalizedText(settings.city);
  return countryMatches && cityMatches;
}

function parseExpiry(value: string): { month: string; year2: string; year4: string; short: string } {
  const parts = value.match(/\d+/g) || [];
  const month = (parts[0] || '').padStart(2, '0').slice(0, 2);
  const rawYear = parts[1] || '';
  const year4 = rawYear.length === 2 ? `20${rawYear}` : rawYear.slice(0, 4);
  const year2 = year4.slice(-2);
  return {
    month,
    year2,
    year4,
    short: month && year2 ? `${month}/${year2}` : value,
  };
}

function splitName(fullName: string): { first: string; last: string } {
  const compact = fullName.replace(/[^a-zA-Z]/g, '');
  if (compact && !fullName.includes(' ')) {
    return { first: compact.slice(0, Math.max(1, Math.floor(compact.length / 2))), last: compact.slice(Math.max(1, Math.floor(compact.length / 2))) || compact };
  }

  const parts = fullName.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return {
    first: parts[0] || compact || 'Alex',
    last: parts.slice(1).join(' ') || 'Walker',
  };
}

function createOutlookEmail(address: AddressProfile): string {
  const base = (address.identity.username || address.fullName || 'outlookuser')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 18) || 'outlookuser';
  const suffix = (address.id + address.fetchedAt).replace(/\D/g, '').slice(-6) || String(Date.now()).slice(-6);
  return `${base}${suffix}@outlook.com`;
}

function isPaypalSignupPage(): boolean {
  return location.hostname.endsWith('paypal.com') && location.pathname.startsWith('/checkoutweb/signup');
}

function isIgnoredInput(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if (input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
    return false;
  }
  return ['hidden', 'radio', 'checkbox', 'submit', 'button'].includes((input.type || '').toLowerCase());
}

function isLikelyEmailPhoneOrCard(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  const text = normalizedText([
    input.id,
    input.name,
    'placeholder' in input ? input.placeholder : '',
    'autocomplete' in input ? input.autocomplete : '',
    input.getAttribute('aria-label'),
    labelledText(input),
  ].join(' '));
  return [
    'email',
    'phone',
    'mobile',
    'card',
    'credit',
    'expiry',
    'expiration',
    'cvv',
    'csc',
    'security code',
  ].some((needle) => text.includes(needle));
}

function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if ('disabled' in htmlElement && Boolean((htmlElement as HTMLInputElement).disabled)) {
    return false;
  }
  const style = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();
  return style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width > 0 &&
    rect.height > 0;
}

function isTextControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  return Boolean(element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement));
}

function isSelectControl(element: Element | null): element is HTMLSelectElement {
  return Boolean(element && element instanceof HTMLSelectElement);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizedText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRandomAddressResponse(value: unknown): value is RandomAddressResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as RandomAddressResponse).ok === 'boolean' &&
      typeof (value as RandomAddressResponse).message === 'string',
  );
}

const PAYPAL_FIELDS = {
  country: [
    'select#country',
    'select[name="country"]',
    'select[name="country.x"]',
    'country',
    'country or region',
  ],
  email: [
    'input#email',
    'input[name="email"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
    'email',
  ],
  password: [
    'input#password',
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="new-password"]',
    'create password',
    'password',
  ],
  phone: [
    'input#phone',
    'input#phoneNumber',
    'input[name="phone"]',
    'input[name="phoneNumber"]',
    'input[type="tel"]',
    'phone number',
    'mobile',
  ],
  cardNumber: [
    'input#cardNumber',
    'input#card_number',
    'input[name="cardNumber"]',
    'input[name="card_number"]',
    'input[autocomplete="cc-number"]',
    'card number',
    'credit card number',
  ],
  expiry: [
    'input#expiryDate',
    'input#expirationDate',
    'input#cardExpiry',
    'input[name="expiryDate"]',
    'input[name="expirationDate"]',
    'input[name="cardExpiry"]',
    'input[autocomplete="cc-exp"]',
    'expiration',
    'expiry',
    '有效期限',
  ],
  expiryMonth: [
    'select#expMonth',
    'select#expiryMonth',
    'select[name="expMonth"]',
    'select[name="expiryMonth"]',
    'expiration month',
    'expiry month',
  ],
  expiryYear: [
    'select#expYear',
    'select#expiryYear',
    'select[name="expYear"]',
    'select[name="expiryYear"]',
    'expiration year',
    'expiry year',
  ],
  csc: [
    'input#cvv',
    'input#csc',
    'input#securityCode',
    'input[name="cvv"]',
    'input[name="csc"]',
    'input[name="securityCode"]',
    'input[autocomplete="cc-csc"]',
    'csc',
    'cvv',
    'security code',
  ],
  fullName: [
    'input#cardholderName',
    'input#nameOnCard',
    'input#fullName',
    'input[name="cardholderName"]',
    'input[name="nameOnCard"]',
    'input[name="fullName"]',
    'input[autocomplete="cc-name"]',
    'name on card',
    'full name',
  ],
  firstName: [
    'input#firstName',
    'input#billingFirstName',
    'input[name="firstName"]',
    'input[name="billingFirstName"]',
    'input[autocomplete="given-name"]',
    'first name',
  ],
  lastName: [
    'input#lastName',
    'input#billingLastName',
    'input[name="lastName"]',
    'input[name="billingLastName"]',
    'input[autocomplete="family-name"]',
    'last name',
  ],
  address1: [
    'input#address1',
    'input#addressLine1',
    'input#billingAddressLine1',
    'input#billingLine1',
    'input[name="address1"]',
    'input[name="addressLine1"]',
    'input[name="billingLine1"]',
    'input[autocomplete="address-line1"]',
    'address line 1',
    'street address',
  ],
  address2: [
    'input#address2',
    'input#addressLine2',
    'input#billingAddressLine2',
    'input#billingLine2',
    'input[name="address2"]',
    'input[name="addressLine2"]',
    'input[name="billingLine2"]',
    'input[autocomplete="address-line2"]',
    'address line 2',
  ],
  city: [
    'input#city',
    'input#billingLocality',
    'input#billingCity',
    'input[name="city"]',
    'input[name="billingCity"]',
    'input[autocomplete="address-level2"]',
    'city',
  ],
  state: [
    'select#state',
    'input#state',
    'select#billingAdministrativeArea',
    'input#billingAdministrativeArea',
    'select#billingState',
    'input#billingState',
    'select[name="state"]',
    'input[name="state"]',
    'select[name="billingState"]',
    'input[name="billingState"]',
    'select[autocomplete="address-level1"]',
    'input[autocomplete="address-level1"]',
    'state',
    'province',
  ],
  postalCode: [
    'input#zip',
    'input#postalCode',
    'input#billingPostalCode',
    'input#billingZip',
    'input[name="zip"]',
    'input[name="postalCode"]',
    'input[name="billingPostalCode"]',
    'input[name="billingZip"]',
    'input[autocomplete="postal-code"]',
    'zip code',
    'postal code',
  ],
};

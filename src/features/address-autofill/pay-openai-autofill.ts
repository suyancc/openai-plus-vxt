import { loadAutomationState } from '../../app/state';
import { loadAddressAutofillSettings, saveAddressAutofillSettings } from '../settings/state';
import type { AddressAutofillSettings } from '../settings/types';
import type { AddressProfile, RandomAddressResponse } from './types';

const LOG_PREFIX = '[OPX Pay Autofill]';
const PAYPAL_SELECTORS = [
  '[data-testid="paypal-accordion-item"]',
  '#payment-method-accordion-item-title-paypal',
  'button[data-testid="paypal-accordion-item-button"]',
  'button[aria-label*="PayPal"]',
  'button[aria-label*="paypal" i]',
];
const OPENAI_RANDOM_BUTTON_ID = 'opx-openai-pay-random-fill';
const AUTOCOMPLETE_DROPDOWN_SELECTOR = '.AutocompleteInput-dropdown-container';
const AUTOCOMPLETE_HIDE_STYLE_ID = 'opx-openai-pay-autocomplete-hide-style';
const MAX_AUTO_AUTOFILL_ATTEMPTS = 4;
const ZERO_AMOUNT_SUBMIT_BUTTON_SELECTOR = 'button[data-testid="hosted-payment-submit-button"]';

interface StorageChangeValue {
  oldValue?: unknown;
  newValue?: unknown;
}

interface PayOpenAiFillResult {
  ok: boolean;
  filled: number;
  message: string;
  canRetry?: boolean;
  submitted?: boolean;
  requiresSubmit?: boolean;
  paymentError?: string;
}

interface PaymentSubmitResult {
  message: string;
  canRetry: boolean;
  submitted: boolean;
  requiresSubmit: boolean;
  paymentError?: string;
}

type CheckoutAmountRole = 'due' | 'plan' | 'unknown';

interface CheckoutAmountCandidate {
  element: HTMLElement;
  text: string;
  minorUnits: number;
  priority: number;
  role: CheckoutAmountRole;
}

let initialized = false;
let running = false;
let scheduledTimer: number | null = null;
let pageAddress: AddressProfile | null = null;
let pageAddressScope = '';
let fillInFlight = false;
let filledAddressKey = '';
let autoAttemptCount = 0;
let autoAutofillFinished = false;
let paypalClickAttempts = 0;
let zeroAmountSubmitKey = '';

export function checkPayOpenAiCheckoutReady(): { ok: boolean; message: string; data?: unknown } {
  if (location.hostname !== 'pay.openai.com') {
    return { ok: false, message: '当前不是 OpenAI 支付页', data: currentPaymentPageData('not-openai-pay') };
  }
  if (!isLiveCheckoutSessionPage()) {
    return { ok: false, message: '当前不是 OpenAI 订阅 checkout 页面', data: currentPaymentPageData('not-live-checkout') };
  }
  const amount = findCheckoutAmount();
  const paypalButton = findPaypalAccordionButton();
  const submitButton = findZeroAmountSubmitButton();
  if (!amount.found && !paypalButton && !submitButton) {
    return { ok: false, message: 'OpenAI 订阅页订单信息尚未渲染', data: currentPaymentPageData('loading') };
  }
  if (amount.found && !paypalButton) {
    return {
      ok: false,
      message: 'OpenAI 订阅页没有 PayPal 支付选项，当前邮箱不可用',
      data: {
        ...currentPaymentPageData('openai-checkout-no-paypal'),
        paypalUnavailable: true,
      },
    };
  }
  return {
    ok: true,
    message: amount.found ? `OpenAI 订阅页已就绪，应付金额 ${amount.text}` : 'OpenAI 订阅页已就绪',
    data: currentPaymentPageData('openai-checkout'),
  };
}

export async function submitOpenAiCheckoutNow(address: AddressProfile): Promise<PayOpenAiFillResult> {
  if (location.hostname !== 'pay.openai.com') {
    return { ok: false, filled: 0, message: '当前不是 OpenAI 支付页' };
  }
  if (!isLiveCheckoutSessionPage()) {
    return { ok: false, filled: 0, message: '当前不是 OpenAI 订阅 checkout 页面' };
  }
  autoAutofillFinished = true;
  cancelScheduledAutofill();
  return fillPayOpenAiAddressNow(address, { force: true });
}

export function initPayOpenAiAddressAutofill(): void {
  if (initialized || location.hostname !== 'pay.openai.com') {
    return;
  }

  initialized = true;
  installStorageListener();
  installObserver();
  installAutocompleteHideStyle();
  installRandomFillButton();
  hideAutocompleteDropdowns();
  scheduleAutofill(800);
}

async function runAutofill(): Promise<void> {
  if (running || autoAutofillFinished || autoAttemptCount >= MAX_AUTO_AUTOFILL_ATTEMPTS) {
    return;
  }

  running = true;
  autoAttemptCount += 1;
  try {
    if (await isAutomationRunActive()) {
      autoAutofillFinished = true;
      cancelScheduledAutofill();
      console.info(`${LOG_PREFIX} automation running, skip standalone autofill`);
      return;
    }

    const settings = await loadAddressAutofillSettings();
    if (!settings.payOpenAiEnabled) {
      console.info(`${LOG_PREFIX} disabled`);
      return;
    }

    const address = await getPageAddress(settings);
    if (!address) {
      console.info(`${LOG_PREFIX} no address available`);
      return;
    }

    const result = await fillPayOpenAiAddressNow(address, { force: false });
    if (!result.canRetry && (result.ok || filledAddressKey === createAddressKey(address))) {
      autoAutofillFinished = true;
      cancelScheduledAutofill();
    } else if (result.canRetry && autoAttemptCount < MAX_AUTO_AUTOFILL_ATTEMPTS) {
      scheduleAutofill(900);
    } else if (autoAttemptCount >= MAX_AUTO_AUTOFILL_ATTEMPTS) {
      autoAutofillFinished = true;
    }

    console.info(`${LOG_PREFIX} ${result.message}`, {
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.countryCode,
      source: address.source,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed`, error);
  } finally {
    running = false;
  }
}

export async function fillPayOpenAiAddressNow(
  address: AddressProfile,
  options: { force?: boolean } = { force: true },
): Promise<PayOpenAiFillResult> {
  if (location.hostname !== 'pay.openai.com') {
    return { ok: false, filled: 0, message: '当前不是 pay.openai.com 页面' };
  }

  const addressKey = createAddressKey(address);
  if (!options.force && filledAddressKey === addressKey) {
    const submitResult = await trySubmitZeroAmountCheckout(addressKey);
    const submitOk = isPaymentSubmitComplete(submitResult);
    return {
      ok: submitOk,
      filled: 0,
      canRetry: submitResult.canRetry,
      submitted: submitResult.submitted,
      requiresSubmit: submitResult.requiresSubmit,
      paymentError: submitResult.paymentError,
      message: appendMessage('OpenAI 支付页已填写过当前地址', submitResult.message),
    };
  }

  if (fillInFlight) {
    if (options.force) {
      const idle = await waitForPayOpenAiFillIdle(8_000);
      if (idle) {
        return fillPayOpenAiAddressNow(address, options);
      }
      return {
        ok: false,
        filled: 0,
        canRetry: true,
        message: 'OpenAI 支付页正在填写，等待结束超时，请稍后重试',
      };
    }
    return { ok: false, filled: 0, message: 'OpenAI 支付页正在填写，已跳过重复触发' };
  }

  fillInFlight = true;
  try {
    const paypal = await ensurePaypalReadyForAutofill();
    if (paypal.required && !paypal.ready) {
      if (paypal.canRetry) {
        scheduleAutofill(900);
      } else {
        autoAutofillFinished = true;
        cancelScheduledAutofill();
      }
      return {
        ok: false,
        filled: 0,
        canRetry: paypal.canRetry,
        message: paypal.message,
      };
    }

    if (!hasVisibleBillingFields() && !checkoutContainsAddressValues(address)) {
      return {
        ok: false,
        filled: 0,
        canRetry: true,
        submitted: false,
        requiresSubmit: true,
        message: 'OpenAI 支付表单尚未渲染完成，等待后重试',
      };
    }

    const filled = await fillCheckoutFields(address);
    if (filled > 0 || checkoutContainsAddressValues(address)) {
      filledAddressKey = addressKey;
    }
    hideAutocompleteDropdowns();
    const filledOk = filled > 0 || filledAddressKey === addressKey;
    const submitResult: PaymentSubmitResult = filledOk
      ? await trySubmitZeroAmountCheckout(addressKey)
      : { message: '', canRetry: false, submitted: false, requiresSubmit: false };
    const submitOk = isPaymentSubmitComplete(submitResult);
    return {
      ok: filledOk && submitOk,
      filled,
      canRetry: submitResult.canRetry,
      submitted: submitResult.submitted,
      requiresSubmit: submitResult.requiresSubmit,
      paymentError: submitResult.paymentError,
      message: appendMessage(filled > 0
        ? `已填写 OpenAI 支付页 ${filled} 项`
        : filledAddressKey === addressKey
          ? 'OpenAI 支付页已存在当前地址'
          : '未找到可填写的 OpenAI 支付字段', submitResult.message),
    };
  } finally {
    fillInFlight = false;
  }
}

async function getPageAddress(settings: AddressAutofillSettings): Promise<AddressProfile | null> {
  const scope = `${settings.countryCode}|${settings.city}`;
  if (pageAddress && pageAddressScope === scope) {
    return pageAddress;
  }

  if (settings.lastAddress && addressMatchesScope(settings.lastAddress, settings)) {
    pageAddress = settings.lastAddress;
    pageAddressScope = scope;
    return pageAddress;
  }

  pageAddress = await fetchAndStoreAddress(settings);
  pageAddressScope = scope;
  return pageAddress;
}

async function fetchAndStoreAddress(settings: AddressAutofillSettings): Promise<AddressProfile | null> {
  const response = await browser.runtime.sendMessage({
    type: 'opx:fetch-random-address',
    countryCode: settings.countryCode,
    city: settings.city,
  });

  if (!isRandomAddressResponse(response) || !response.ok || !response.address) {
    console.warn(`${LOG_PREFIX} address fetch failed`, response);
    return null;
  }

  await saveAddressAutofillSettings({ lastAddress: response.address });
  return response.address;
}

async function fetchFreshAddressAndFill(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
  cancelScheduledAutofill();
  autoAutofillFinished = true;
  button.disabled = true;
  button.textContent = '获取中...';
  Object.assign(button.style, {
    cursor: 'wait',
    opacity: '0.72',
  });
  status.textContent = '正在获取随机地址';

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
    pageAddressScope = `${settings.countryCode}|${settings.city}`;
    await saveAddressAutofillSettings({ lastAddress: response.address });
    paypalClickAttempts = 0;
    const result = await fillPayOpenAiAddressNow(response.address, { force: true });
    status.textContent = result.ok ? `已输入 ${result.filled} 项` : result.message;
  } catch (error) {
    status.textContent = `失败：${errorMessage(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = '随机地址';
    Object.assign(button.style, {
      cursor: 'pointer',
      opacity: '1',
    });
  }
}

async function fillCheckoutFields(address: AddressProfile): Promise<number> {
  let filled = 0;

  filled += fillInput('#billingName', address.fullName, true);
  filled += fillSelect('#billingCountry', address.countryCode, [address.countryLabel, address.countryCode]);

  if (document.querySelector('#billingCountry')) {
    await delay(550);
  }

  filled += fillInput('#billingAddressLine1', address.line1, true);
  filled += fillInput('#billingAddressLine2', address.line2, true);
  filled += fillInput('#billingLocality', address.city, true);
  filled += fillSelectOrInput('#billingAdministrativeArea', address.state, [address.stateFull, address.state]);
  filled += fillInput('#billingPostalCode', address.postalCode, true);
  filled += fillInput('#phoneNumber', address.phone, false);

  filled += fillByAutocomplete('billing address-line1', address.line1);
  filled += fillByAutocomplete('billing address-line2', address.line2);
  filled += fillByAutocomplete('billing address-level2', address.city);
  filled += fillByAutocomplete('billing postal-code', address.postalCode);
  filled += fillSelectOrInputByAutocomplete('billing address-level1', address.state, [address.stateFull, address.state]);
  filled += fillSelectByAutocomplete('billing country', address.countryCode, [address.countryLabel, address.countryCode]);
  filled += checkVisibleTermsCheckboxes();
  hideAutocompleteDropdowns();

  return filled;
}

async function ensurePaypalReadyForAutofill(): Promise<{ required: boolean; ready: boolean; canRetry: boolean; message: string }> {
  const paypalButton = findPaypalAccordionButton();
  if (!paypalButton) {
    const amount = findCheckoutAmount();
    if (amount.found) {
      return { required: true, ready: false, canRetry: false, message: 'OpenAI 订阅页没有 PayPal 支付选项，当前邮箱不可用' };
    }
    return { required: false, ready: true, canRetry: false, message: '未发现 PayPal 支付方式按钮，继续按当前表单填写' };
  }

  if (isPaypalPaymentMethodReady()) {
    return { required: true, ready: true, canRetry: false, message: 'PayPal 支付方式已展开' };
  }

  if (paypalClickAttempts < MAX_AUTO_AUTOFILL_ATTEMPTS) {
    paypalClickAttempts += 1;
    clickPaypalPaymentMethod(paypalButton);
  }

  const ready = await waitForPaypalPaymentMethodReady(2500);
  const canRetry = !ready && paypalClickAttempts < MAX_AUTO_AUTOFILL_ATTEMPTS;
  return {
    required: true,
    ready,
    canRetry,
    message: ready
      ? '已点击 PayPal，支付表单已展开'
      : canRetry
        ? '已点击 PayPal，等待支付表单展开后再填写'
        : '无法自动展开 PayPal，请手动点击 PayPal 后再点随机地址',
  };
}

function findPaypalAccordionButton(): HTMLElement | null {
  const exact = document.querySelector<HTMLElement>('button[data-testid="paypal-accordion-item-button"]');
  if (exact) {
    return exact;
  }

  const paypalRadio = document.querySelector<HTMLInputElement>('#payment-method-accordion-item-title-paypal');
  if (paypalRadio) {
    const target = findPaypalRadioClickTarget(paypalRadio);
    if (target) {
      return target;
    }
  }

  for (const selector of PAYPAL_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || !isVisible(element)) {
      continue;
    }
    return element;
  }

  const textMatch = Array.from(document.querySelectorAll<HTMLElement>('button, label, [role="button"], [role="radio"], [data-testid], div'))
    .filter(isVisible)
    .find((element) => normalizedText(element.innerText || element.textContent).includes('paypal'));

  return textMatch || null;
}

function findPaypalRadioClickTarget(radio: HTMLInputElement): HTMLElement | null {
  const explicitLabel = document.querySelector<HTMLElement>('label[for="payment-method-accordion-item-title-paypal"]');
  if (explicitLabel && isVisible(explicitLabel)) {
    return explicitLabel;
  }

  const candidates = [
    radio.closest<HTMLElement>('label'),
    radio.closest<HTMLElement>('button'),
    radio.closest<HTMLElement>('[role="button"]'),
    radio.closest<HTMLElement>('[role="radio"]'),
    radio.closest<HTMLElement>('[data-testid]'),
    radio.closest<HTMLElement>('.AccordionButton'),
    radio.closest<HTMLElement>('.paypal-accordion-item-cover'),
    radio.closest<HTMLElement>('.AccordionItemHeader--clickable'),
    radio.closest<HTMLElement>('.AccordionItemCover'),
    radio.closest<HTMLElement>('.AccordionItemHeader-content'),
    radio.closest<HTMLElement>('.PaymentMethodFormAccordionItemTitle'),
    radio.closest<HTMLElement>('.PaymentMethodFormAccordionItem'),
    radio.parentElement,
    radio,
  ];

  return candidates.find((element): element is HTMLElement => Boolean(element && isVisible(element))) || null;
}

function isPaypalPaymentMethodReady(): boolean {
  const paypalRadio = document.querySelector<HTMLInputElement>('#payment-method-accordion-item-title-paypal');
  const selectedByRadio = Boolean(paypalRadio?.checked || paypalRadio?.getAttribute('aria-checked') === 'true');
  const selectedByClass = Boolean(document.querySelector('.paypal-accordion-item.PaymentMethodFormAccordionItem--selected'));
  return selectedByRadio || selectedByClass;
}

function clickPaypalPaymentMethod(primaryTarget: HTMLElement): void {
  const target = getPaypalClickTargets(primaryTarget)[0];
  if (target) {
    clickElement(target);
  }
}

function getPaypalClickTargets(primaryTarget: HTMLElement): HTMLElement[] {
  const radio = document.querySelector<HTMLInputElement>('#payment-method-accordion-item-title-paypal');
  const exact = document.querySelector<HTMLElement>('button[data-testid="paypal-accordion-item-button"]');
  return [
    exact,
    primaryTarget,
    radio,
    radio ? findPaypalRadioClickTarget(radio) : null,
    document.querySelector<HTMLElement>('.paypal-accordion-item-cover'),
    document.querySelector<HTMLElement>('.paypal-accordion-item .AccordionItemHeader--clickable'),
    document.querySelector<HTMLElement>('.paypal-accordion-item .AccordionItemCover'),
  ].filter((element, index, list): element is HTMLElement => Boolean(element && list.indexOf(element) === index));
}

async function waitForPaypalPaymentMethodReady(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (isPaypalPaymentMethodReady()) {
      await delay(350);
      return true;
    }
    await delay(120);
  }
  return false;
}

function hasVisibleBillingFields(): boolean {
  const selectors = [
    '#billingName',
    '#billingCountry',
    '#billingAddressLine1',
    '#billingLocality',
    '#billingPostalCode',
    'input[autocomplete="billing address-line1"]',
    'input[autocomplete="billing postal-code"]',
  ];
  return selectors.some((selector) => {
    const element = document.querySelector(selector);
    return Boolean(element && isVisible(element));
  });
}

function fillInput(selector: string, value: string, overwrite: boolean): number {
  if (!value) {
    return 0;
  }
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!isTextControl(input) || !isVisible(input) || isSensitivePaymentField(input)) {
    return 0;
  }
  if (!overwrite && input.value.trim()) {
    return 0;
  }
  if (input.value === value) {
    return 0;
  }
  setNativeValue(input, value);
  return 1;
}

function fillByAutocomplete(autocomplete: string, value: string): number {
  const selector = `input[autocomplete="${cssEscape(autocomplete)}"], textarea[autocomplete="${cssEscape(autocomplete)}"]`;
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!isTextControl(input) || !isVisible(input) || input.value === value || isSensitivePaymentField(input)) {
    return 0;
  }
  setNativeValue(input, value);
  return 1;
}

function fillSelect(selector: string, preferredValue: string, preferredLabels: string[]): number {
  const select = document.querySelector<HTMLSelectElement>(selector);
  if (!isSelectControl(select) || !isVisible(select)) {
    return 0;
  }
  return setSelectOption(select, preferredValue, preferredLabels);
}

function fillSelectByAutocomplete(autocomplete: string, preferredValue: string, preferredLabels: string[]): number {
  const select = document.querySelector<HTMLSelectElement>(`select[autocomplete="${cssEscape(autocomplete)}"]`);
  if (!isSelectControl(select) || !isVisible(select)) {
    return 0;
  }
  return setSelectOption(select, preferredValue, preferredLabels);
}

function fillSelectOrInput(selector: string, preferredValue: string, preferredLabels: string[]): number {
  const element = document.querySelector(selector);
  if (isSelectControl(element)) {
    return isVisible(element) ? setSelectOption(element, preferredValue, preferredLabels) : 0;
  }
  if (isTextControl(element)) {
    return fillInput(selector, preferredValue, true);
  }
  return 0;
}

function fillSelectOrInputByAutocomplete(autocomplete: string, preferredValue: string, preferredLabels: string[]): number {
  const select = document.querySelector(`select[autocomplete="${cssEscape(autocomplete)}"]`);
  if (isSelectControl(select)) {
    return isVisible(select) ? setSelectOption(select, preferredValue, preferredLabels) : 0;
  }
  return fillByAutocomplete(autocomplete, preferredValue || preferredLabels[0] || '');
}

function setSelectOption(select: HTMLSelectElement, preferredValue: string, preferredLabels: string[]): number {
  const options = Array.from(select.options).filter((option) => !option.disabled && option.value);
  const normalizedPreferred = normalizedText(preferredValue);
  const labelNeedles = preferredLabels.map((label) => normalizedText(label)).filter(Boolean);
  const option = options.find((item) => normalizedText(item.value) === normalizedPreferred) ||
    options.find((item) => labelNeedles.some((needle) => normalizedText(`${item.text} ${item.value}`).includes(needle)));

  if (!option || select.value === option.value) {
    return 0;
  }

  select.value = option.value;
  emitChange(select);
  return 1;
}

function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  emitChange(input);
}

function checkoutContainsAddressValues(address: AddressProfile): boolean {
  const expectedValues = [
    address.fullName,
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
  ].filter(Boolean);
  if (expectedValues.length === 0) {
    return false;
  }

  const values = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .filter(isTextControl)
    .map((input) => normalizedText(input.value))
    .filter(Boolean);
  const matched = expectedValues.filter((value) => values.includes(normalizedText(value))).length;
  return matched >= Math.min(3, expectedValues.length);
}

async function trySubmitZeroAmountCheckout(addressKey: string): Promise<PaymentSubmitResult> {
  if (!isLiveCheckoutSessionPage()) {
    return { message: '', canRetry: false, submitted: false, requiresSubmit: false };
  }

  const amount = await waitForCheckoutAmountReady(6_000);
  if (!amount.found) {
    return { message: '未找到可识别的应付金额，等待金额区域重新渲染后重试', canRetry: true, submitted: false, requiresSubmit: true };
  }
  if (!amount.isZero) {
    return { message: `当前应付金额不是 0（${amount.text}），未点击订阅`, canRetry: false, submitted: false, requiresSubmit: true };
  }

  const key = `${location.href}|${addressKey}|${amount.text}`;
  if (zeroAmountSubmitKey === key) {
    return { message: '0 元订单已点击过订阅，跳过重复点击', canRetry: false, submitted: true, requiresSubmit: true };
  }

  const submitButton = await waitForZeroAmountSubmitButton(10_000);
  if (!submitButton) {
    return { message: `检测到 ${amount.text}，但订阅按钮尚未完全可点击`, canRetry: true, submitted: false, requiresSubmit: true };
  }

  zeroAmountSubmitKey = key;
  clickElement(submitButton);
  const paymentError = await waitForPaymentError(3500);
  if (paymentError) {
    zeroAmountSubmitKey = '';
    return {
      message: `检测到 ${amount.text}，已点击订阅，但支付页返回错误：${paymentError}`,
      canRetry: isRetryablePaymentError(paymentError),
      submitted: false,
      requiresSubmit: true,
      paymentError,
    };
  }
  return { message: `检测到 ${amount.text}，已点击订阅`, canRetry: false, submitted: true, requiresSubmit: true };
}

function isPaymentSubmitComplete(result: PaymentSubmitResult): boolean {
  if (result.canRetry) {
    return false;
  }
  if (result.requiresSubmit && !result.submitted) {
    return false;
  }
  return true;
}

function isLiveCheckoutSessionPage(): boolean {
  return location.hostname === 'pay.openai.com' && location.pathname.startsWith('/c/pay/cs_live_');
}

function currentPaymentPageData(pageKind: string): Record<string, unknown> {
  const amount = findCheckoutAmount();
  return {
    pageKind,
    url: location.href,
    readyState: document.readyState,
    amountFound: amount.found,
    amountText: amount.text,
    paypalReady: isPaypalPaymentMethodReady(),
    paypalButtonFound: Boolean(findPaypalAccordionButton()),
    submitButtonFound: Boolean(findZeroAmountSubmitButton()),
  };
}

function findCheckoutAmount(): { found: boolean; isZero: boolean; text: string } {
  const amounts = findVisibleCurrencyAmounts();
  if (amounts.length === 0) {
    return { found: false, isZero: false, text: '' };
  }

  const preferred = findUsableCheckoutAmountCandidate(amounts);
  if (!preferred) {
    return { found: false, isZero: false, text: '' };
  }

  return {
    found: true,
    isZero: preferred.minorUnits === 0,
    text: preferred.text,
  };
}

async function waitForCheckoutAmountReady(timeoutMs: number): Promise<{ found: boolean; isZero: boolean; text: string }> {
  const startedAt = Date.now();
  let last = findCheckoutAmount();
  while (Date.now() - startedAt <= timeoutMs) {
    if (last.found) {
      return last;
    }
    await delay(180);
    last = findCheckoutAmount();
  }
  return last;
}

function findVisibleCurrencyAmounts(): CheckoutAmountCandidate[] {
  const elements = uniqueElements([
    ...Array.from(document.querySelectorAll<HTMLElement>('.CurrencyAmount')),
    ...Array.from(document.querySelectorAll<HTMLElement>('#OrderDetails-TotalAmount span')),
    ...Array.from(document.querySelectorAll<HTMLElement>('[id*="OrderDetails-TotalAmount"] span')),
  ]).filter(isVisible);
  const parsed = elements
    .map((element) => {
      const text = (element.textContent || '').trim();
      const minorUnits = parseCurrencyMinorUnits(text);
      const role = checkoutAmountRole(element);
      return minorUnits === null
        ? null
        : {
          element,
          text,
          minorUnits,
          priority: currencyAmountPriority(element, role),
          role,
        };
    })
    .filter((item): item is CheckoutAmountCandidate => Boolean(item));
  return parsed;
}

function findUsableCheckoutAmountCandidate(amounts: CheckoutAmountCandidate[]): CheckoutAmountCandidate | null {
  const sorted = [...amounts].sort(compareCheckoutAmountCandidates);
  const due = sorted.find((item) => item.role === 'due');
  if (due) {
    return due;
  }

  const zeroNonPlan = sorted.find((item) => item.role !== 'plan' && item.minorUnits === 0);
  if (zeroNonPlan) {
    return zeroNonPlan;
  }

  const strongUnknown = sorted.find((item) => item.role === 'unknown' && item.priority >= 20);
  return strongUnknown || null;
}

function compareCheckoutAmountCandidates(a: CheckoutAmountCandidate, b: CheckoutAmountCandidate): number {
  const roleWeight: Record<CheckoutAmountRole, number> = {
    due: 3,
    unknown: 2,
    plan: 1,
  };
  return roleWeight[b.role] - roleWeight[a.role] ||
    b.priority - a.priority ||
    Number(b.minorUnits === 0) - Number(a.minorUnits === 0);
}

function checkoutAmountRole(element: HTMLElement): CheckoutAmountRole {
  if (element.closest('#OrderDetails-TotalAmount, [id*="OrderDetails-TotalAmount"], [id*="TotalAmount"]')) {
    return 'due';
  }

  const structuralMarker = collectAncestorStructuralMarkers(element, 7);
  if (hasDueAmountMarker(structuralMarker)) {
    return 'due';
  }

  const context = amountNearbyText(element);
  if (hasDueAmountMarker(context)) {
    return 'due';
  }
  if (hasPlanAmountMarker(context)) {
    return 'plan';
  }
  return 'unknown';
}

function currencyAmountPriority(element: HTMLElement, role: CheckoutAmountRole): number {
  let priority = role === 'due' ? 80 : role === 'plan' ? -40 : 0;
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const marker = normalizedText([
      current.id,
      current.className,
      current.getAttribute('data-testid'),
      current.getAttribute('aria-label'),
    ].join(' '));
    if (
      marker.includes('ordertotal') ||
      marker.includes('totalamount') ||
      marker.includes('orderdetails-totalamount') ||
      marker.includes('total due') ||
      marker.includes('due today') ||
      marker.includes('合计') ||
      marker.includes('总计') ||
      marker.includes('今天')
    ) {
      priority = Math.max(priority, 100);
    } else if (marker.includes('total') || marker.includes('amount') || marker.includes('应付')) {
      priority = Math.max(priority, 40);
    }
    current = current.parentElement;
  }

  const nearbyText = amountNearbyText(element);
  if (hasDueAmountMarker(nearbyText)) {
    priority = Math.max(priority, 90);
  }
  if (hasPlanAmountMarker(nearbyText)) {
    priority -= 60;
  }

  return priority;
}

function amountNearbyText(element: HTMLElement): string {
  const parent = element.parentElement;
  const row = element.closest<HTMLElement>(
    'tr, li, [role="row"], [id*="Total"], [id*="Amount"], [data-testid*="total"], [data-testid*="amount"], [class*="Total"], [class*="Amount"], .LineItem',
  );
  return normalizedText([
    element.getAttribute('aria-label'),
    parent?.previousElementSibling?.textContent,
    parent?.nextElementSibling?.textContent,
    compactElementText(parent),
    compactElementText(parent?.parentElement || null),
    row && row !== parent ? compactElementText(row) : '',
  ].join(' '));
}

function compactElementText(element: Element | null): string {
  const text = element?.textContent || '';
  return text.length <= 220 ? text : '';
}

function collectAncestorStructuralMarkers(element: HTMLElement, maxDepth: number): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    parts.push([
      current.id,
      current.className,
      current.getAttribute('data-testid'),
      current.getAttribute('aria-label'),
    ].join(' '));
    current = current.parentElement;
  }
  return normalizedText(parts.join(' '));
}

function hasDueAmountMarker(text: string): boolean {
  return [
    'ordertotal',
    'totalamount',
    'orderdetails-totalamount',
    'total due',
    'due today',
    'amount due',
    'today',
    '合计',
    '总计',
    '应付',
    '今天',
  ].some((needle) => text.includes(needle));
}

function hasPlanAmountMarker(text: string): boolean {
  return [
    'plus',
    'team',
    'workspace',
    'plan',
    'monthly',
    'per month',
    '/month',
    'billed',
    'seat',
    'subscription',
    '套餐',
    '每月',
    '/月',
    '月费',
    '席位',
    '订阅计划',
  ].some((needle) => text.includes(needle));
}

function uniqueElements<T extends Element>(elements: T[]): T[] {
  return elements.filter((element, index, list) => list.indexOf(element) === index);
}

function parseCurrencyMinorUnits(text: string): number | null {
  const match = text.replace(/\s+/g, '').match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const amount = Number(match[0].replace(/,/g, ''));
  if (!Number.isFinite(amount)) {
    return null;
  }
  return Math.round(amount * 100);
}

async function waitForZeroAmountSubmitButton(timeoutMs: number): Promise<HTMLButtonElement | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findZeroAmountSubmitButton();
    if (button) {
      return button;
    }
    await delay(120);
  }
  return null;
}

function findZeroAmountSubmitButton(): HTMLButtonElement | null {
  const exact = document.querySelector<HTMLButtonElement>(ZERO_AMOUNT_SUBMIT_BUTTON_SELECTOR);
  if (isClickableButton(exact)) {
    return exact;
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"], button.SubmitButton'))
    .filter(isClickableButton)
    .find((button) => {
      const text = normalizedText(button.textContent);
      return text.includes('订阅') || text.includes('subscribe');
    }) || null;
}

async function waitForPaymentError(timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const message = findPaymentErrorMessage();
    if (message) {
      return message;
    }
    await delay(180);
  }
  return '';
}

function findPaymentErrorMessage(): string {
  const selectors = [
    '.ConfirmPaymentButton-Error',
    '.Notice--red',
    '[role="alert"]',
    '[data-testid*="error"]',
    '.PaymentForm-confirmPaymentContainer .Notice',
  ];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
    for (const element of elements) {
      const text = normalizedText(element.textContent);
      if (text) {
        return text;
      }
    }
  }
  return '';
}

function isRetryablePaymentError(message: string): boolean {
  const normalized = normalizedText(message);
  return [
    'could not calculate tax',
    'calculate tax',
    'invalid zip',
    'invalid postal',
    'zip code',
    'postal code',
    'address',
    'billing',
  ].some((needle) => normalized.includes(needle));
}

function isClickableButton(button: HTMLButtonElement | null): button is HTMLButtonElement {
  return Boolean(button &&
    isVisible(button) &&
    !button.disabled &&
    button.getAttribute('aria-disabled') !== 'true' &&
    button.dataset.disabled !== 'true' &&
    !button.classList.contains('SubmitButton--incomplete') &&
    !button.classList.contains('SubmitButton--processing') &&
    window.getComputedStyle(button).pointerEvents !== 'none');
}

function checkVisibleTermsCheckboxes(): number {
  let checked = 0;
  const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter(isVisible)
    .filter((checkbox) => !checkbox.checked)
    .filter((checkbox) => {
      const text = normalizedText([
        checkbox.id,
        checkbox.name,
        checkbox.getAttribute('aria-label'),
        checkbox.closest('label')?.textContent,
        checkbox.parentElement?.textContent,
      ].join(' '));
      return text.includes('terms') ||
        text.includes('consent') ||
        text.includes('使用条款') ||
        text.includes('隐私政策') ||
        text.includes('取消') ||
        checkbox.id === 'termsOfServiceConsentCheckbox';
    });

  for (const checkbox of checkboxes) {
    checkbox.click();
    checked += 1;
  }

  return checked;
}

function emitChange(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function clickElement(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + Math.max(1, rect.width / 2);
  const clientY = rect.top + Math.max(1, rect.height / 2);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: type.endsWith('down') ? 1 : 0,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
      view: window,
    }));
  }
  element.click();
}

function installObserver(): void {
  const observer = new MutationObserver(() => {
    installRandomFillButton();
    hideAutocompleteDropdowns();
    if (!autoAutofillFinished && autoAttemptCount < MAX_AUTO_AUTOFILL_ATTEMPTS) {
      scheduleAutofill(250);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function installAutocompleteHideStyle(): void {
  if (document.getElementById(AUTOCOMPLETE_HIDE_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = AUTOCOMPLETE_HIDE_STYLE_ID;
  style.textContent = `
${AUTOCOMPLETE_DROPDOWN_SELECTOR} {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;
  document.documentElement.append(style);
}

function hideAutocompleteDropdowns(): void {
  for (const element of document.querySelectorAll<HTMLElement>(AUTOCOMPLETE_DROPDOWN_SELECTOR)) {
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
  }
}

function installRandomFillButton(): void {
  if (document.getElementById(OPENAI_RANDOM_BUTTON_ID)) {
    return;
  }

  const heading = findPaymentMethodHeading();
  if (!heading?.parentElement) {
    return;
  }

  const target = findPaymentMethodButtonTarget(heading);
  const wrapper = document.createElement('span');
  wrapper.id = OPENAI_RANDOM_BUTTON_ID;
  wrapper.setAttribute('data-opx-openai-random-fill', '1');
  Object.assign(wrapper.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    marginLeft: '10px',
    verticalAlign: 'middle',
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '随机地址';
  Object.assign(button.style, {
    appearance: 'none',
    border: '0',
    borderRadius: '6px',
    background: '#10b981',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1',
    minHeight: '28px',
    padding: '0 12px',
    whiteSpace: 'nowrap',
  });

  const status = document.createElement('span');
  Object.assign(status.style, {
    color: '#64748b',
    fontSize: '12px',
    lineHeight: '16px',
    minWidth: '0',
    whiteSpace: 'nowrap',
  });

  button.addEventListener('click', () => {
    void fetchFreshAddressAndFill(button, status);
  });

  wrapper.append(button, status);
  target.append(wrapper);
}

function findPaymentMethodHeading(): HTMLElement | null {
  const exact = document.querySelector<HTMLElement>('.PaymentMethod-Heading');
  if (exact && isVisible(exact)) {
    return exact;
  }

  return Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, div, span'))
    .filter(isVisible)
    .find((element) => {
      const text = normalizedText(element.textContent);
      return text === '支付方式' || text === 'payment method' || text === 'payment methods';
    }) || null;
}

function findPaymentMethodButtonTarget(heading: HTMLElement): HTMLElement {
  const container = heading.closest<HTMLElement>('.flex-item.width-12') ||
    heading.parentElement ||
    heading;
  Object.assign(container.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    flexWrap: 'wrap',
  });
  Object.assign(heading.style, {
    marginRight: '0',
  });
  return container;
}

function createAddressKey(address: AddressProfile): string {
  return [
    address.id,
    address.fullName,
    address.countryCode,
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.phone,
  ].join('|');
}

function installStorageListener(): void {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (hasAddressScopeChange(changes)) {
      resetAutofillStateForScopeChange();
      scheduleAutofill(100);
    }
  });
}

function hasAddressScopeChange(changes: Record<string, StorageChangeValue>): boolean {
  for (const change of Object.values(changes)) {
    const oldSettings = normalizeAddressSettingsChangeValue(change.oldValue);
    const newSettings = normalizeAddressSettingsChangeValue(change.newValue);
    if (!oldSettings || !newSettings) {
      continue;
    }

    if (
      oldSettings.payOpenAiEnabled !== newSettings.payOpenAiEnabled ||
      oldSettings.countryCode !== newSettings.countryCode ||
      oldSettings.city !== newSettings.city
    ) {
      return true;
    }
  }
  return false;
}

function resetAutofillStateForScopeChange(): void {
  pageAddress = null;
  pageAddressScope = '';
  filledAddressKey = '';
  autoAttemptCount = 0;
  paypalClickAttempts = 0;
  zeroAmountSubmitKey = '';
  autoAutofillFinished = false;
}

function normalizeAddressSettingsChangeValue(value: unknown): Pick<AddressAutofillSettings, 'payOpenAiEnabled' | 'countryCode' | 'city'> | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = isRecord(value.addressAutofill) ? value.addressAutofill : value;
  if (!('payOpenAiEnabled' in source) && !('countryCode' in source) && !('city' in source)) {
    return null;
  }
  return {
    payOpenAiEnabled: Boolean(source.payOpenAiEnabled),
    countryCode: String(source.countryCode || '').trim(),
    city: String(source.city || '').trim(),
  };
}

function addressMatchesScope(address: AddressProfile, settings: AddressAutofillSettings): boolean {
  const countryMatches = settings.countryCode === 'RANDOM' || address.countryCode === settings.countryCode;
  const city = settings.city.trim().toLowerCase();
  const cityMatches = !city || address.city.toLowerCase() === city;
  return countryMatches && cityMatches;
}

function scheduleAutofill(delayMs: number): void {
  if (scheduledTimer) {
    window.clearTimeout(scheduledTimer);
  }
  scheduledTimer = window.setTimeout(() => {
    scheduledTimer = null;
    void runAutofill();
  }, delayMs);
}

async function isAutomationRunActive(): Promise<boolean> {
  try {
    const state = await loadAutomationState();
    return Boolean(state.run.running);
  } catch {
    return false;
  }
}

async function waitForPayOpenAiFillIdle(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (fillInFlight && Date.now() - startedAt <= timeoutMs) {
    await delay(120);
  }
  return !fillInFlight;
}

function cancelScheduledAutofill(): void {
  if (scheduledTimer) {
    window.clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
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

function isSensitivePaymentField(element: Element): boolean {
  const haystack = normalizedText([
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.getAttribute('autocomplete'),
    element.getAttribute('name'),
    element.getAttribute('id'),
  ].join(' '));

  return [
    'cc-number',
    'card number',
    'credit card',
    'security code',
    'cvc',
    'cvv',
    'expiry',
    'expiration',
  ].some((needle) => haystack.includes(needle));
}

function isTextControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  return Boolean(element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement));
}

function isSelectControl(element: Element | null): element is HTMLSelectElement {
  return Boolean(element && element instanceof HTMLSelectElement);
}

function normalizedText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendMessage(message: string, extra: string): string {
  return extra ? `${message}；${extra}` : message;
}

function isRandomAddressResponse(value: unknown): value is RandomAddressResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as RandomAddressResponse).ok === 'boolean' &&
      typeof (value as RandomAddressResponse).message === 'string',
  );
}

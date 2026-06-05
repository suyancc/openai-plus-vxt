import { loadAutomationState, loadSmsRelayState, saveSmsRelayState } from '../../app/state';
import { canUseExtensionApi, isExtensionContextInvalidated } from '../../app/extension-context';
import { loadAddressAutofillSettings, saveAddressAutofillSettings } from '../settings/state';
import { parseSmsRelayTargets } from '../sms/parser';
import { fetchSmsRelayCode } from '../sms/poller';
import type { AddressAutofillSettings } from '../settings/types';
import type { AddressProfile, RandomAddressResponse } from './types';

const LOG_PREFIX = '[OPX PayPal Autofill]';
const PAYPAL_ADDRESS_SESSION_KEY = 'opx.paypal.autofill.address';
const PAYPAL_EMAIL_SESSION_KEY = 'opx.paypal.autofill.email';
const PAYPAL_PENDING_MANUAL_KEY = 'opx.paypal.autofill.pendingManual';
const PAYPAL_FILLED_ATTR = 'data-opx-paypal-filled';
const PAYPAL_RANDOM_BUTTON_ID = 'opx-paypal-random-fill';
const PAYPAL_SCA_FILLED_ATTR = 'data-opx-paypal-sca-filled';
const PAYPAL_BILLING_CONSENT_ATTR = 'data-opx-paypal-billing-consent-clicked';
const PAYPAL_CAPTCHA_COMPONENT_ID = 'captchaComponent';
const MAX_AUTOFILL_ATTEMPTS_PER_PAGE = 3;
const MAX_BILLING_CONSENT_ATTEMPTS = 8;
const PAYPAL_CREATE_ACCOUNT_ENTRY_CLICK_COOLDOWN_MS = 1_200;
const SCA_SMS_TIME_TOLERANCE_MS = 10_000;
const PAYPAL_FIRST_NAMES = ['Alex', 'Blake', 'Casey', 'Drew', 'Evan', 'Jamie', 'Jordan', 'Morgan', 'Riley', 'Taylor'];
const PAYPAL_LAST_NAMES = ['Adams', 'Baker', 'Carter', 'Davis', 'Evans', 'Miller', 'Parker', 'Reed', 'Turner', 'Walker'];
const PAYPAL_PASSWORD_MIN_LENGTH = 8;
const PAYPAL_PASSWORD_MAX_LENGTH = 20;
const PAYPAL_PASSWORD_SAFE_CHARS = 'Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Jj9Kk';
const PAYPAL_JP_NAME = {
  first: '太郎',
  last: '山田',
  kanaFirst: 'タロウ',
  kanaLast: 'ヤマダ',
};
const PAYPAL_JP_DEFAULT_BIRTHDAY = '1988/04/12';
const JAPAN_PREFECTURE_LABELS: Record<string, string> = {
  hokkaido: '北海道',
  aomori: '青森県',
  iwate: '岩手県',
  miyagi: '宮城県',
  akita: '秋田県',
  yamagata: '山形県',
  fukushima: '福島県',
  ibaraki: '茨城県',
  tochigi: '栃木県',
  gunma: '群馬県',
  saitama: '埼玉県',
  chiba: '千葉県',
  tokyo: '東京都',
  kanagawa: '神奈川県',
  niigata: '新潟県',
  toyama: '富山県',
  ishikawa: '石川県',
  fukui: '福井県',
  yamanashi: '山梨県',
  nagano: '長野県',
  gifu: '岐阜県',
  shizuoka: '静岡県',
  aichi: '愛知県',
  mie: '三重県',
  shiga: '滋賀県',
  kyoto: '京都府',
  osaka: '大阪府',
  hyogo: '兵庫県',
  nara: '奈良県',
  wakayama: '和歌山県',
  tottori: '鳥取県',
  shimane: '島根県',
  okayama: '岡山県',
  hiroshima: '広島県',
  yamaguchi: '山口県',
  tokushima: '徳島県',
  kagawa: '香川県',
  ehime: '愛媛県',
  kochi: '高知県',
  fukuoka: '福岡県',
  saga: '佐賀県',
  nagasaki: '長崎県',
  kumamoto: '熊本県',
  oita: '大分県',
  miyazaki: '宮崎県',
  kagoshima: '鹿児島県',
  okinawa: '沖縄県',
};
const JAPAN_CITY_PREFECTURE_LABELS: Record<string, string> = {
  sapporo: '北海道',
  sendai: '宮城県',
  saitama: '埼玉県',
  chiba: '千葉県',
  tokyo: '東京都',
  yokohama: '神奈川県',
  kawasaki: '神奈川県',
  niigata: '新潟県',
  shizuoka: '静岡県',
  nagoya: '愛知県',
  kyoto: '京都府',
  osaka: '大阪府',
  kobe: '兵庫県',
  hiroshima: '広島県',
  fukuoka: '福岡県',
  kumamoto: '熊本県',
  naha: '沖縄県',
};
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

interface StorageChangeValue {
  oldValue?: unknown;
  newValue?: unknown;
}

interface PaypalCreateAccountSubmitResult {
  submitted: boolean;
  canRetry: boolean;
  message: string;
  paymentError?: string;
  phoneNumberRejected?: boolean;
}

interface PaypalSignupFillResult {
  filled: number;
  countryChanged: boolean;
  phoneFilled: boolean;
  phoneRequired: boolean;
  phoneMessage: string;
}

let initialized = false;
let running = false;
let scheduledTimer: number | null = null;
let pageAddress: AddressProfile | null = null;
let observer: MutationObserver | null = null;
let attemptKey = '';
let attemptCount = 0;
let manualFillKey = '';
let paypalCheckoutEmailSubmitted = false;
let paypalCreateAccountClicked = false;
let paypalCreateAccountClickedAt = 0;
let paypalBillingConsentClicked = false;
let paypalBillingConsentAttempts = 0;
let scaFilledKey = '';
let scaPromptKey = '';
let scaPromptOpenedAt = 0;
let lastScaLogMessage = '';
let extensionContextStopped = false;

export function initPaypalAutofill(): void {
  if (initialized || extensionContextStopped || !isPaypalSupportedPage() || !canUseExtensionApi()) {
    return;
  }

  initialized = true;
  removePaypalCaptchaComponent();
  installRandomFillButton();
  installStorageListener();
  installObserver();
  if (isPaypalCheckoutEmailPage() || isPaypalBillingConsentPage()) {
    scheduleAutofill(500);
  } else if (consumePendingManualFill()) {
    scheduleManualSessionAutofill(900);
  } else {
    scheduleAutofill(800);
  }
}

export async function fillPaypalAddressNow(
  address?: AddressProfile,
  force = false,
  allowRetry = true,
): Promise<{
  ok: boolean;
  filled: number;
  message: string;
  countryChanged: boolean;
  submitted?: boolean;
  canRetry?: boolean;
  paymentError?: string;
  phoneNumberRejected?: boolean;
}> {
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
  const submitResult: PaypalCreateAccountSubmitResult = result.countryChanged || result.filled <= 0
    ? { submitted: false, canRetry: result.countryChanged, message: '' }
    : result.phoneRequired && !result.phoneFilled
      ? { submitted: false, canRetry: false, message: result.phoneMessage || '没有可用接码池手机号，已跳过提交' }
    : await clickPaypalCreateAccountSubmit();
  return {
    ok: result.countryChanged || (result.filled > 0 && submitResult.submitted),
    filled: result.filled,
    countryChanged: result.countryChanged,
    submitted: submitResult.submitted,
    canRetry: submitResult.canRetry,
    paymentError: submitResult.paymentError,
    phoneNumberRejected: submitResult.phoneNumberRejected,
    message: result.countryChanged
      ? `已选择 PayPal 国家：${targetAddress.countryCode}，等待页面重新加载`
      : result.filled > 0
        ? appendMessage(`已填写 PayPal ${result.filled} 项`, submitResult.message)
        : '未找到可填写的 PayPal 字段',
  };
}

export function checkPaypalCheckoutReady(kind: 'paypal-account-entry' | 'paypal-email' | 'paypal-profile' | 'paypal-page-error'): { ok: boolean; message: string; data?: unknown } {
  const pageKind = detectPaypalCheckoutPageKind();
  if (kind === 'paypal-page-error') {
    const paymentError = findPaypalPageLevelError();
    const fieldError = findPaypalFieldError();
    const phoneNumberError = findPaypalPhoneNumberRejectedError();
    const smsCodeError = findPaypalSmsCodeInvalidError();
    const hasError = Boolean(paymentError || fieldError || phoneNumberError || smsCodeError);
    const profileError = paymentError || fieldError;
    return {
      ok: hasError,
      message: phoneNumberError
        ? `PayPal 手机号不可用：${phoneNumberError}`
        : smsCodeError
          ? `PayPal 手机验证码不可用：${smsCodeError}`
          : profileError
            ? `PayPal 页面错误：${profileError}`
            : '未发现 PayPal 页面错误',
      data: {
        ...paypalCheckoutPageData(pageKind),
        paymentError,
        fieldError,
        phoneNumberRejected: Boolean(phoneNumberError),
        smsCodeInvalid: Boolean(smsCodeError),
        canResendSmsCode: Boolean(smsCodeError && findPaypalSmsResendButton()),
        canRetry: profileError ? isRetryablePaypalProfileError(profileError) : false,
      },
    };
  }
  if (kind === 'paypal-profile') {
    return {
      ok: pageKind === 'signup',
      message: pageKind === 'signup' ? 'PayPal 支付资料页已就绪' : `PayPal 支付资料页尚未出现，当前页面：${pageKind}`,
      data: paypalCheckoutPageData(pageKind),
    };
  }
  if (kind === 'paypal-email') {
    const hasEmailForm = Boolean(findPaypalCheckoutEmailInput() && findPaypalCheckoutContinueButton());
    const ok = pageKind === 'signup' || (pageKind === 'checkout-email' && hasEmailForm);
    return {
      ok,
      message: ok ? 'PayPal 邮箱创建页面已就绪' : `PayPal 邮箱创建页面尚未出现，当前页面：${pageKind}`,
      data: paypalCheckoutPageData(pageKind),
    };
  }
  const hasEmailForm = Boolean(findPaypalCheckoutEmailInput() && findPaypalCheckoutContinueButton());
  const createAccountButton = findPaypalCreateAccountButton();
  const hasCreateAccountButton = Boolean(createAccountButton);
  const createAccountButtonReady = Boolean(
    createAccountButton &&
      isClickableButton(createAccountButton) &&
      isElementTopClickable(createAccountButton, true),
  );
  const ok = pageKind === 'signup' ||
    (pageKind === 'account-entry' && createAccountButtonReady) ||
    (pageKind === 'checkout-email' && hasEmailForm);
  return {
    ok,
    message: ok ? 'PayPal 创建账户入口已就绪' : `PayPal 创建账户入口尚未出现，当前页面：${pageKind}`,
    data: paypalCheckoutPageData(pageKind),
  };
}

export async function openPaypalAccountEntryNow(): Promise<{ ok: boolean; message: string; data?: unknown }> {
  cancelScheduledAutofill();
  removePaypalCaptchaComponent();
  const pageKind = detectPaypalCheckoutPageKind();
  if (pageKind === 'signup') {
    return { ok: true, message: '已进入 PayPal 支付资料页', data: paypalCheckoutPageData(pageKind) };
  }
  if (pageKind === 'checkout-email') {
    return { ok: true, message: 'PayPal 创建账户邮箱页已打开', data: paypalCheckoutPageData(pageKind) };
  }
  if (pageKind !== 'account-entry') {
    return { ok: false, message: `当前不是 PayPal 创建账户入口页：${pageKind}`, data: paypalCheckoutPageData(pageKind) };
  }

  const result = await fillPaypalCheckoutEmailAndContinue();
  const nextKind = detectPaypalCheckoutPageKind();
  return {
    ok: result.ok || nextKind === 'checkout-email' || result.message.includes('已点击创建账户入口'),
    message: result.message,
    data: paypalCheckoutPageData(nextKind),
  };
}

export async function fillPaypalCheckoutEmailNow(): Promise<{ ok: boolean; message: string; data?: unknown }> {
  cancelScheduledAutofill();
  removePaypalCaptchaComponent();
  const pageKind = detectPaypalCheckoutPageKind();
  if (pageKind === 'signup') {
    return { ok: true, message: '已进入 PayPal 支付资料页，跳过邮箱填写', data: paypalCheckoutPageData(pageKind) };
  }
  if (pageKind === 'billing-consent') {
    const result = clickPaypalBillingConsentAndContinue();
    return {
      ok: result.ok,
      message: result.message,
      data: paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
    };
  }
  if (pageKind !== 'checkout-email' && pageKind !== 'account-entry') {
    return { ok: false, message: `当前不是 PayPal 邮箱创建页面：${pageKind}`, data: paypalCheckoutPageData(pageKind) };
  }

  const result = await fillPaypalCheckoutEmailAndContinue();
  return {
    ok: result.ok || paypalCheckoutEmailSubmitted,
    message: result.message,
    data: paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
  };
}

export function clickPaypalBillingConsentNow(): { ok: boolean; message: string; data?: unknown } {
  removePaypalCaptchaComponent();
  const pageKind = detectPaypalCheckoutPageKind();
  if (pageKind !== 'billing-consent') {
    return {
      ok: false,
      message: `当前不是 PayPal billing 同意页面：${pageKind}`,
      data: paypalCheckoutPageData(pageKind),
    };
  }
  const result = clickPaypalBillingConsentAndContinue();
  return {
    ok: result.ok,
    message: result.message,
    data: paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
  };
}

export async function fillPaypalSmsCodeNow(): Promise<{ ok: boolean; message: string; data?: unknown }> {
  removePaypalCaptchaComponent();
  const result = await fillPaypalScaCodeIfReady();
  return {
    ok: result.present && result.filled,
    message: result.present ? result.message : '未发现 PayPal 手机验证码输入框',
    data: paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
  };
}

export async function resendPaypalSmsCodeIfNeededNow(): Promise<{ ok: boolean; message: string; data?: unknown }> {
  removePaypalCaptchaComponent();
  const error = findPaypalSmsCodeInvalidError();
  if (!error) {
    return {
      ok: false,
      message: '未发现 PayPal 手机验证码不可用提示',
      data: {
        ...paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
        smsCodeInvalid: false,
        resent: false,
      },
    };
  }

  const button = findPaypalSmsResendButton();
  if (!button) {
    return {
      ok: false,
      message: `PayPal 手机验证码不可用，但未找到 Resend 按钮：${error}`,
      data: {
        ...paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
        smsCodeInvalid: true,
        resent: false,
        smsCodeError: error,
      },
    };
  }

  clickButton(button);
  scaFilledKey = '';
  scaPromptOpenedAt = Date.now();
  lastScaLogMessage = '';
  return {
    ok: true,
    message: `PayPal 手机验证码不可用，已点击 Resend 重新发送：${error}`,
    data: {
      ...paypalCheckoutPageData(detectPaypalCheckoutPageKind()),
      smsCodeInvalid: true,
      resent: true,
      smsCodeError: error,
    },
  };
}

async function runAutofill(): Promise<void> {
  if (running || extensionContextStopped) {
    return;
  }
  if (!canUseExtensionApi()) {
    stopForExtensionContextInvalidated();
    return;
  }

  running = true;
  try {
    if (await isAutomationRunActive()) {
      cancelScheduledAutofill();
      console.info(`${LOG_PREFIX} automation running, skip standalone autofill`);
      return;
    }

    removePaypalCaptchaComponent();
    const scaResult = await fillPaypalScaCodeIfReady();
    if (scaResult.present) {
      if (!scaResult.filled) {
        scheduleAutofill(1500);
      }
      logScaStatus(scaResult.message);
      return;
    }

    if (manualFillKey && attemptKey === manualFillKey) {
      return;
    }

    const settings = await loadAddressAutofillSettings();
    if (!settings.payPalSignupEnabled) {
      console.info(`${LOG_PREFIX} disabled`);
      return;
    }

    if (isPaypalCheckoutEmailPage()) {
      const result = await fillPaypalCheckoutEmailAndContinue();
      console.info(`${LOG_PREFIX} ${result.message}`);
      if (result.ok || paypalCheckoutEmailSubmitted) {
        observer?.disconnect();
        observer = null;
      }
      return;
    }

    if (isPaypalBillingConsentPage()) {
      const result = clickPaypalBillingConsentAndContinue();
      console.info(`${LOG_PREFIX} ${result.message}`);
      if (result.ok || paypalBillingConsentAttempts >= MAX_BILLING_CONSENT_ATTEMPTS) {
        observer?.disconnect();
        observer = null;
        return;
      }
      scheduleAutofill(900);
      return;
    }

    const result = await fillPaypalAddressNow();
    console.info(`${LOG_PREFIX} ${result.message}`);
    if (!result.ok || reachedAttemptLimit()) {
      observer?.disconnect();
      observer = null;
    }
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      stopForExtensionContextInvalidated();
      return;
    }
    console.warn(`${LOG_PREFIX} failed`, error);
  } finally {
    running = false;
  }
}

function stopForExtensionContextInvalidated(): void {
  if (extensionContextStopped) {
    return;
  }
  extensionContextStopped = true;
  cancelScheduledAutofill();
  observer?.disconnect();
  observer = null;
  console.info(`${LOG_PREFIX} 插件已重新加载，请刷新当前页面后继续使用自动填写`);
}

function logScaStatus(message: string): void {
  if (message === lastScaLogMessage) {
    return;
  }
  lastScaLogMessage = message;
  console.info(`${LOG_PREFIX} ${message}`);
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

async function fillPaypalSignupFields(address: AddressProfile, allowRetry: boolean): Promise<PaypalSignupFillResult> {
  let filled = 0;
  const countryChanged = selectCountry(address);
  if (countryChanged) {
    if (allowRetry) {
      scheduleAutofill(1500);
    }
    return {
      filled: 1,
      countryChanged: true,
      phoneFilled: false,
      phoneRequired: false,
      phoneMessage: '',
    };
  }

  const email = await resolveEmail(address);
  const password = createPaypalPassword(email);
  const phoneFieldVisible = Boolean(hasVisibleField(PAYPAL_FIELDS.phone));
  const smsPhone = await resolveSmsPhone();
  const genericName = splitName(address.fullName);
  const name = shouldFillPaypalJapanFields(address) ? { first: PAYPAL_JP_NAME.first, last: PAYPAL_JP_NAME.last } : genericName;
  const expiry = parseExpiry(address.creditCard.expires);
  const state = resolvePaypalState(address);

  filled += fillText(PAYPAL_FIELDS.email, email, true);
  filled += fillPasswordField(password);
  renderPasswordEmailNote(email, password);
  const phoneFilledCount = smsPhone ? fillText(PAYPAL_FIELDS.phone, smsPhone, true) : 0;
  filled += phoneFilledCount;
  filled += fillText(PAYPAL_FIELDS.cardNumber, address.creditCard.number, true);
  filled += fillText(PAYPAL_FIELDS.expiry, expiry.short, true);
  filled += fillText(PAYPAL_FIELDS.csc, address.creditCard.cvv, true);
  filled += fillText(PAYPAL_FIELDS.fullName, address.fullName, true);
  filled += fillText(PAYPAL_FIELDS.firstName, name.first, true);
  filled += fillText(PAYPAL_FIELDS.lastName, name.last, true);
  filled += fillText(PAYPAL_FIELDS.address1, address.line1, true);
  filled += fillText(PAYPAL_FIELDS.address2, address.line2, true);
  filled += fillText(PAYPAL_FIELDS.city, address.city, true);
  filled += fillSelectOrInput(PAYPAL_FIELDS.state, state.value, state.labels);
  filled += fillText(PAYPAL_FIELDS.postalCode, address.postalCode, true);
  filled += fillBillingAddressGroup(address, name);
  filled += fillPaypalJapanFields(address);
  filled += fillSelectOrInput(PAYPAL_FIELDS.expiryMonth, expiry.month, [expiry.month]);
  filled += fillSelectOrInput(PAYPAL_FIELDS.expiryYear, expiry.year4, [expiry.year4, expiry.year2]);

  const phoneFilled = phoneFilledCount > 0;
  return {
    filled,
    countryChanged: false,
    phoneFilled,
    phoneRequired: phoneFieldVisible,
    phoneMessage: phoneFilled
      ? `已使用接码池手机号 ${maskPhoneForLog(smsPhone)}`
      : phoneFieldVisible
        ? '没有可用接码池手机号，已跳过手机号并停止提交'
        : '',
  };
}

function shouldFillPaypalJapanFields(address: AddressProfile): boolean {
  return address.countryCode === 'JP' ||
    Boolean(
      document.querySelector(
        'input#dateOfBirth, input#countrySpecificFirstName, input#countrySpecificLastName, [data-testid="kana-names"]',
      ),
    );
}

function fillPaypalJapanFields(address: AddressProfile): number {
  if (!shouldFillPaypalJapanFields(address)) {
    return 0;
  }

  let filled = 0;
  const birthday = formatPaypalJapanBirthday(address.identity.birthday);
  const prefecture = resolveJapanPrefecture(address);
  filled += fillText(PAYPAL_FIELDS.dateOfBirth, birthday, true);
  filled += fillText(PAYPAL_FIELDS.kanaFirstName, PAYPAL_JP_NAME.kanaFirst, true);
  filled += fillText(PAYPAL_FIELDS.kanaLastName, PAYPAL_JP_NAME.kanaLast, true);
  filled += fillText(PAYPAL_FIELDS.firstName, PAYPAL_JP_NAME.first, true);
  filled += fillText(PAYPAL_FIELDS.lastName, PAYPAL_JP_NAME.last, true);
  if (prefecture) {
    filled += fillSelectOrInput(PAYPAL_FIELDS.state, prefecture, [prefecture, address.stateFull, address.state]);
  }
  return filled;
}

function resolvePaypalState(address: AddressProfile): { value: string; labels: string[] } {
  const japanPrefecture = shouldFillPaypalJapanFields(address) ? resolveJapanPrefecture(address) : '';
  if (japanPrefecture) {
    return {
      value: japanPrefecture,
      labels: [japanPrefecture, address.stateFull, address.state],
    };
  }
  return {
    value: address.state,
    labels: [address.stateFull, address.state],
  };
}

function resolveJapanPrefecture(address: AddressProfile): string {
  const direct = [address.state, address.stateFull]
    .map((value) => value.trim())
    .find((value) => /[都道府県]$/.test(value));
  if (direct) {
    return direct;
  }

  const keys = [
    address.state,
    address.stateFull,
    address.city,
  ]
    .map(normalizeJapanLookupKey)
    .filter(Boolean);
  for (const key of keys) {
    const prefecture = JAPAN_PREFECTURE_LABELS[key] || JAPAN_CITY_PREFECTURE_LABELS[key];
    if (prefecture) {
      return prefecture;
    }
  }

  return '東京都';
}

function normalizeJapanLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function formatPaypalJapanBirthday(value: string): string {
  const parts = value.match(/\d+/g) || [];
  let year = '';
  let month = '';
  let day = '';

  if (parts.length >= 3) {
    const first = parts[0] || '';
    const second = parts[1] || '';
    const third = parts[2] || '';
    if (first.length === 4) {
      year = first;
      month = second;
      day = third;
    } else if (third.length === 4) {
      year = third;
      month = first;
      day = second;
    }
  } else {
    const only = parts[0] || '';
    if (parts.length === 1 && only.length === 8) {
      year = only.slice(0, 4);
      month = only.slice(4, 6);
      day = only.slice(6, 8);
    }
  }

  if (!isReasonableBirthday(year, month, day)) {
    return PAYPAL_JP_DEFAULT_BIRTHDAY;
  }

  return `${year.padStart(4, '0')}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
}

function isReasonableBirthday(yearValue: string, monthValue: string, dayValue: string): boolean {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1940 || year > 2004 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

async function fillPaypalScaCodeIfReady(): Promise<{ present: boolean; filled: boolean; message: string }> {
  const container = findScaCodeContainer();
  if (!container) {
    scaPromptKey = '';
    scaPromptOpenedAt = 0;
    lastScaLogMessage = '';
    return { present: false, filled: false, message: '' };
  }
  const prompt = noteScaPrompt(container);

  const inputs = findScaCodeInputs(container);
  if (!inputs.length) {
    return { present: true, filled: false, message: 'PayPal 验证码弹窗已出现，但没有找到验证码输入框' };
  }

  const sms = await resolveLatestSmsCodeForSca(container, prompt.openedAt);
  if (!sms.code) {
    return { present: true, filled: false, message: 'PayPal 验证码弹窗已出现，等待弹窗出现后收到的新手机验证码' };
  }

  const key = `${sms.phone}|${sms.code}|${inputs.length}`;
  const alreadyFilled = scaFilledKey === key || inputs.every((input, index) => input.value === sms.code[index]);
  if (alreadyFilled) {
    scaFilledKey = key;
    return { present: true, filled: true, message: `PayPal 手机验证码已填写：${sms.code}` };
  }

  fillScaCodeInputs(inputs, sms.code);
  scaFilledKey = key;
  return { present: true, filled: true, message: `已填写 PayPal 手机验证码：${sms.code}` };
}

function noteScaPrompt(container: HTMLElement): { key: string; openedAt: number } {
  const key = createScaPromptKey(container);
  if (key !== scaPromptKey) {
    scaPromptKey = key;
    scaPromptOpenedAt = Date.now();
    scaFilledKey = '';
    lastScaLogMessage = '';
  }
  return { key, openedAt: scaPromptOpenedAt || Date.now() };
}

function createScaPromptKey(container: HTMLElement): string {
  const phone = extractScaTargetPhone(container);
  const text = normalizedText(container.textContent || '').slice(0, 120);
  return `${phone}|${text}`;
}

function findScaCodeContainer(): HTMLElement | null {
  const exact = document.querySelector<HTMLElement>('[data-testid="sca-confirm-multi-field"]');
  if (exact && isVisible(exact) && !isPaypalPhoneNumberRejectedContainer(exact)) {
    return exact;
  }

  return Array.from(document.querySelectorAll<HTMLElement>('div, section, form'))
    .filter(isVisible)
    .find((element) => {
      if (isPaypalPhoneNumberRejectedContainer(element)) {
        return false;
      }
      const text = normalizedText(element.textContent || '');
      return text.includes('输入您的验证码') ||
        text.includes('输入验证码') ||
        text.includes('enter your code') ||
        text.includes('verification code');
    }) || null;
}

function findScaCodeInputs(container: HTMLElement): HTMLInputElement[] {
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>(
    'input[id^="ci-ciBasic-"], input[name^="ciBasic-"], input[aria-label$="-6"], input[type="tel"]',
  ))
    .filter((input) => isVisible(input) && !input.disabled)
    .filter((input) => {
      const text = normalizedText([
        input.id,
        input.name,
        input.type,
        input.inputMode,
        input.getAttribute('aria-label'),
        input.autocomplete,
      ].join(' '));
      return text.includes('cibasic') ||
        /\b[1-6]-6\b/.test(text) ||
        input.maxLength === 1 ||
        input.type === 'tel';
    })
    .sort((left, right) => scaInputIndex(left) - scaInputIndex(right));

  return inputs.slice(0, 6);
}

async function resolveLatestSmsCodeForSca(container: HTMLElement, promptOpenedAt: number): Promise<{ code: string; phone: string }> {
  const state = await loadSmsRelayState();
  const targetPhone = extractScaTargetPhone(container);
  const liveCode = await fetchLiveSmsCodeForSca(state.rawInput, targetPhone);
  if (liveCode.code) {
    return liveCode;
  }

  const earliestAcceptedAt = Math.max(0, promptOpenedAt - SCA_SMS_TIME_TOLERANCE_MS);
  const history = state.history
    .filter((item) => /^\d{6}$/.test(item.code))
    .filter((item) => item.receivedAt >= earliestAcceptedAt)
    .sort((left, right) => right.receivedAt - left.receivedAt);
  if (!history.length) {
    return { code: '', phone: '' };
  }

  const selected = targetPhone
    ? history.find((item) => phonesMatch(item.phone, targetPhone))
    : history[0];
  if (!selected) {
    return { code: '', phone: '' };
  }
  return { code: selected.code, phone: selected.phone };
}

async function fetchLiveSmsCodeForSca(rawInput: string, targetPhone: string): Promise<{ code: string; phone: string }> {
  const parsed = parseSmsRelayTargets(rawInput);
  if (!parsed.targets.length || parsed.errors.length) {
    return { code: '', phone: '' };
  }

  const targets = targetPhone
    ? parsed.targets.filter((target) => phonesMatch(target.phone, targetPhone))
    : parsed.targets;
  if (!targets.length) {
    return { code: '', phone: '' };
  }

  for (const target of targets) {
    const result = await fetchSmsRelayCode(target);
    if (result.kind !== 'code' || !/^\d{6}$/.test(result.code)) {
      continue;
    }
    await appendScaSmsHistory(target.phone, result.code, result.message);
    return { code: result.code, phone: target.phone };
  }

  return { code: '', phone: '' };
}

async function appendScaSmsHistory(phone: string, code: string, message: string): Promise<void> {
  const state = await loadSmsRelayState();
  const exists = state.history.some((item) => item.phone === phone && item.code === code);
  if (exists) {
    return;
  }
  await saveSmsRelayState({
    history: [{
      id: `${phone}-${code}-${Date.now()}`,
      phone,
      code,
      message,
      receivedAt: Date.now(),
    }, ...state.history].slice(0, 80),
  });
}

function extractScaTargetPhone(container: HTMLElement): string {
  const text = container.textContent || '';
  const bracketMatch = /[（(]([+\d\s-]{7,})[）)]/.exec(text);
  const raw = bracketMatch?.[1] || /(?:\+?\d[\d\s-]{7,}\d)/.exec(text)?.[0] || '';
  return normalizePhoneDigits(raw);
}

function phonesMatch(left: string, right: string): boolean {
  const leftDigits = normalizePhoneDigits(left);
  const rightDigits = normalizePhoneDigits(right);
  if (!leftDigits || !rightDigits) {
    return false;
  }
  const leftLast = leftDigits.slice(-10);
  const rightLast = rightDigits.slice(-10);
  return Boolean(leftLast && rightLast && leftLast === rightLast);
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function fillScaCodeInputs(inputs: HTMLInputElement[], code: string): void {
  const digits = code.replace(/\D/g, '').slice(0, inputs.length);
  for (const [index, input] of inputs.entries()) {
    const digit = digits[index] || '';
    setNativeValue(input, digit);
    input.setAttribute(PAYPAL_SCA_FILLED_ATTR, '1');
    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: digit,
      inputType: 'insertText',
    }));
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: digit,
      inputType: 'insertText',
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  inputs[Math.min(digits.length, inputs.length) - 1]?.dispatchEvent(new Event('blur', { bubbles: true }));
}

function scaInputIndex(input: HTMLInputElement): number {
  const text = [input.id, input.name, input.getAttribute('aria-label')].join(' ');
  const labelIndex = /([1-6])-6/.exec(text)?.[1];
  if (labelIndex) {
    return Number(labelIndex) - 1;
  }
  const suffixIndex = /(?:ciBasic-|ci-ciBasic-)(\d+)/.exec(text)?.[1];
  return suffixIndex ? Number(suffixIndex) : 999;
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

async function resolveEmail(_address?: AddressProfile): Promise<string> {
  const sessionEmail = loadSessionPaypalEmail();
  if (sessionEmail) {
    return sessionEmail;
  }

  const email = createRandomOutlookEmail();
  rememberSessionPaypalEmail(email);
  return email;
}

async function fillPaypalCheckoutEmailAndContinue(): Promise<{ ok: boolean; message: string }> {
  if (paypalCheckoutEmailSubmitted) {
    return { ok: true, message: 'PayPal checkout 邮箱已提交，跳过重复点击' };
  }

  const mode = detectPaypalCheckoutEmailMode();
  if (mode === 'login-with-create') {
    const button = findPaypalCreateAccountButton();
    const canClickAgain = !paypalCreateAccountClicked ||
      Date.now() - paypalCreateAccountClickedAt > PAYPAL_CREATE_ACCOUNT_ENTRY_CLICK_COOLDOWN_MS;
    if (button && canClickAgain) {
      const clickResult = await clickPaypalCreateAccountEntryButton(button);
      if (!clickResult.clicked) {
        return { ok: false, message: clickResult.message };
      }
      paypalCreateAccountClicked = true;
      paypalCreateAccountClickedAt = Date.now();
      scheduleAutofill(1200);
      return { ok: false, message: clickResult.message };
    }
    return { ok: false, message: `当前是 PayPal 登录页，等待创建账户表单：${paypalCreateAccountButtonDebug(button)}` };
  }
  if (mode === 'login') {
    return { ok: false, message: '当前是 PayPal 登录页，跳过邮箱填写' };
  }
  if (mode === 'unknown') {
    return { ok: false, message: '未确认 PayPal 页面是创建账户流程，跳过邮箱填写' };
  }

  const email = await resolveEmail();
  if (!email) {
    return { ok: false, message: '无法生成 PayPal checkout 邮箱' };
  }

  const input = findPaypalCheckoutEmailInput();
  if (!input || !isVisible(input)) {
    return { ok: false, message: '未找到 PayPal checkout 邮箱输入框' };
  }

  fillTextControl(input, email, true);
  await waitForPayPalUiTick();

  const button = findPaypalCheckoutContinueButton();
  if (!button || !isVisible(button)) {
    return { ok: false, message: `已填写 PayPal checkout 邮箱：${email}，但未找到继续按钮` };
  }
  if (button.disabled) {
    await waitForButtonEnabled(button, 2500);
  }
  if (button.disabled) {
    return { ok: false, message: `已填写 PayPal checkout 邮箱：${email}，继续按钮仍不可点击` };
  }

  paypalCheckoutEmailSubmitted = true;
  document.documentElement.setAttribute('data-opx-paypal-checkout-email-submitted', '1');
  clickButton(button);
  return { ok: true, message: `已填写 PayPal checkout 邮箱并点击继续：${email}` };
}

function clickPaypalBillingConsentAndContinue(): { ok: boolean; message: string } {
  if (paypalBillingConsentClicked || document.documentElement.getAttribute(PAYPAL_BILLING_CONSENT_ATTR) === '1') {
    return { ok: true, message: 'PayPal billing 已点击同意并继续，跳过重复点击' };
  }

  paypalBillingConsentAttempts += 1;
  const button = findPaypalBillingConsentButton();
  if (!button) {
    return { ok: false, message: '未找到 PayPal billing 同意并继续按钮' };
  }
  if (!isClickableButton(button)) {
    return { ok: false, message: 'PayPal billing 同意并继续按钮暂不可点击' };
  }

  paypalBillingConsentClicked = true;
  document.documentElement.setAttribute(PAYPAL_BILLING_CONSENT_ATTR, '1');
  clickButton(button);
  return { ok: true, message: '已点击 PayPal billing 同意并继续' };
}

async function resolveSmsPhone(): Promise<string> {
  try {
    const state = await loadAutomationState();
    const selected = state.run.selectedSmsId
      ? state.smsTargets.find((target) => target.id === state.run.selectedSmsId && target.source === 'api' && !target.disabled) || null
      : null;
    const target = selected || state.smsTargets.find((item) => item.source === 'api' && !item.disabled) || null;
    return sanitizePhone(target?.phone || '');
  } catch (error) {
    console.debug(`${LOG_PREFIX} sms phone unavailable`, error);
    return '';
  }
}

function sanitizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

function maskPhoneForLog(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 6) {
    return digits;
  }
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

function createPaypalPassword(email: string): string {
  const localPart = (email.split('@')[0] || 'paypaluser').replace(/[^a-zA-Z0-9]/g, '');
  const base = localPart.slice(0, 12) || 'paypaluser';
  let password = `${base}1A`;
  if (password.length > PAYPAL_PASSWORD_MAX_LENGTH) {
    password = password.slice(0, PAYPAL_PASSWORD_MAX_LENGTH);
  }
  password = padPaypalPassword(password);
  password = breakPaypalRepeatedPasswordChars(password);
  if (!/[0-9!@#$%^]/.test(password)) {
    password = replacePaypalPasswordChar(password, password.length - 2, '1');
  }
  if (!/[a-zA-Z]/.test(password)) {
    password = replacePaypalPasswordChar(password, password.length - 1, 'A');
  }
  return breakPaypalRepeatedPasswordChars(password).slice(0, PAYPAL_PASSWORD_MAX_LENGTH);
}

function padPaypalPassword(value: string): string {
  let password = value;
  let safeCharIndex = 0;
  while (password.length < PAYPAL_PASSWORD_MIN_LENGTH) {
    password += pickPaypalPasswordPadChar(password, safeCharIndex);
    safeCharIndex += 1;
  }
  return password;
}

function pickPaypalPasswordPadChar(password: string, offset: number): string {
  for (let index = 0; index < PAYPAL_PASSWORD_SAFE_CHARS.length; index += 1) {
    const candidate = PAYPAL_PASSWORD_SAFE_CHARS[(index + offset) % PAYPAL_PASSWORD_SAFE_CHARS.length] || 'A';
    if (!wouldCreatePaypalRepeatedRun(password, candidate)) {
      return candidate;
    }
  }
  return password.endsWith('A') ? '1' : 'A';
}

function wouldCreatePaypalRepeatedRun(prefix: string, candidate: string): boolean {
  return prefix.length >= 3 &&
    prefix[prefix.length - 1] === candidate &&
    prefix[prefix.length - 2] === candidate &&
    prefix[prefix.length - 3] === candidate;
}

function breakPaypalRepeatedPasswordChars(value: string): string {
  const chars = Array.from(value);
  for (let index = 3; index < chars.length; index += 1) {
    if (
      chars[index] === chars[index - 1] &&
      chars[index] === chars[index - 2] &&
      chars[index] === chars[index - 3]
    ) {
      chars[index] = pickPaypalPasswordReplacement(chars, index);
    }
  }
  return chars.join('');
}

function pickPaypalPasswordReplacement(chars: string[], index: number): string {
  const previous = chars[index - 1] || '';
  const next = chars[index + 1] || '';
  for (let offset = 0; offset < PAYPAL_PASSWORD_SAFE_CHARS.length; offset += 1) {
    const candidate = PAYPAL_PASSWORD_SAFE_CHARS[(index + offset) % PAYPAL_PASSWORD_SAFE_CHARS.length] || 'A';
    if (candidate !== previous && candidate !== next) {
      return candidate;
    }
  }
  return previous === 'A' || next === 'A' ? '1' : 'A';
}

function replacePaypalPasswordChar(value: string, index: number, preferred: string): string {
  const chars = Array.from(value.padEnd(PAYPAL_PASSWORD_MIN_LENGTH, 'A')).slice(0, PAYPAL_PASSWORD_MAX_LENGTH);
  const safeIndex = Math.max(0, Math.min(index, chars.length - 1));
  chars[safeIndex] = preferred;
  let password = breakPaypalRepeatedPasswordChars(chars.join(''));
  if (password.length < PAYPAL_PASSWORD_MIN_LENGTH) {
    password = padPaypalPassword(password);
  }
  if (!/[a-zA-Z]/.test(password)) {
    password = `${password.slice(0, PAYPAL_PASSWORD_MAX_LENGTH - 1)}A`;
  }
  return password;
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

function hasVisibleField(selectors: string[]): boolean {
  const input = findTextControl(selectors);
  if (input && isVisible(input)) {
    return true;
  }
  const select = findSelect(selectors);
  return Boolean(select && isVisible(select));
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

function findPaypalCheckoutEmailInput(): HTMLInputElement | null {
  const selectors = [
    'input#onboardingFlowEmail',
    'input#login_email',
    'input#email',
    'input[name="login_email"]',
    'input[name="email"]',
    'input[name="login"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
  ];
  for (const selector of selectors) {
    const input = querySelectorCandidate(selector);
    if (input instanceof HTMLInputElement) {
      return input;
    }
  }
  return Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    .find((input) => {
      if (!isVisible(input) || isIgnoredInput(input)) {
        return false;
      }
      const text = normalizedText([
        input.id,
        input.name,
        input.type,
        input.placeholder,
        input.autocomplete,
        input.getAttribute('aria-label'),
        labelledText(input),
        closestLabelText(input),
      ].join(' '));
      return text.includes('email') || text.includes('邮箱');
    }) || null;
}

function findPaypalCheckoutContinueButton(): HTMLButtonElement | null {
  const selectors = [
    'button[data-testid="continueButton"]',
    'button[data-atomic-wait-intent="Continue_To_Payment"]',
    'button[data-atomic-wait-viewname="guest_checkout_request"]',
    'button.actionContinue',
    'button#btnNext',
    'button#continue',
    'form.proceed button[type="submit"]',
    'button[type="submit"]',
  ];
  for (const selector of selectors) {
    const button = querySelectorCandidate(selector);
    if (button instanceof HTMLButtonElement && isVisible(button) && isPaypalCheckoutContinueButton(button)) {
      return button;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => isVisible(button) && isPaypalCheckoutContinueButton(button)) || null;
}

function isPaypalCheckoutContinueButton(button: HTMLButtonElement): boolean {
  if (isPaypalOnboardingEmailContinueButton(button)) {
    return true;
  }

  const marker = normalizedText([
    button.textContent,
    button.id,
    button.name,
    button.type,
    button.dataset.testid,
    button.getAttribute('data-atomic-wait-intent'),
    button.getAttribute('data-atomic-wait-task'),
    button.getAttribute('data-atomic-wait-viewname'),
    button.getAttribute('aria-label'),
  ].join(' '));
  if (marker.includes('pay_with_card') || marker.includes('create an account') || marker.includes('创建账户')) {
    return false;
  }
  return marker.includes('继续付款') ||
    marker.includes('同意并继续') ||
    marker.includes('下一步') ||
    marker.includes('continue_to_payment') ||
    marker.includes('guest_checkout_request') ||
    marker.includes('continue to payment') ||
    marker.includes('continue to checkout') ||
    marker.includes('continue payment') ||
    marker.includes('agree and continue') ||
    marker === 'continue' ||
    marker === 'next' ||
    marker === '继续';
}

function isPaypalOnboardingEmailContinueButton(button: HTMLButtonElement): boolean {
  if (!isVisible(button)) {
    return false;
  }
  const form = button.closest('form');
  if (!(form instanceof HTMLFormElement) || !isPaypalOnboardingEmailForm(form)) {
    return false;
  }
  const type = (button.type || button.getAttribute('type') || '').toLowerCase();
  return type === 'submit' || button.classList.contains('actionContinue');
}

function findPaypalBillingConsentButton(): HTMLButtonElement | null {
  const selectors = [
    'button#consentButton',
    'button[data-id="consentButton"]',
    'button[data-atomic-wait-task="select_agree_and_continue"]',
    'button[data-fpti="modxo_consent_submit_button_clicked"]',
  ];
  for (const selector of selectors) {
    const button = querySelectorCandidate(selector);
    if (button instanceof HTMLButtonElement && isVisible(button)) {
      return button;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => {
      if (!isVisible(button)) {
        return false;
      }
      const text = normalizedText(button.textContent || '');
      return text.includes('同意并继续') ||
        text.includes('agree and continue') ||
        text.includes('agree & continue');
    }) || null;
}

async function clickPaypalCreateAccountSubmit(): Promise<PaypalCreateAccountSubmitResult> {
  const button = findPaypalCreateAccountSubmitButton();
  if (!button) {
    return { submitted: false, canRetry: true, message: '未找到 PayPal Agree & Create Account 按钮' };
  }
  if (!isClickableButton(button)) {
    await waitForButtonEnabled(button, 2500);
  }
  if (!isClickableButton(button)) {
    return { submitted: false, canRetry: true, message: 'PayPal Agree & Create Account 按钮暂不可点击' };
  }
  clickButton(button);
  const feedback = await waitForPaypalCreateAccountFeedback(5000);
  if (feedback.phoneNumberError) {
    const dismissed = dismissPaypalPhoneNumberRejectedDialog();
    if (dismissed) {
      await wait(160);
    }
    return {
      submitted: false,
      canRetry: false,
      message: `已点击 Agree & Create Account，但 PayPal 要求更换手机号：${feedback.phoneNumberError}`,
      paymentError: feedback.phoneNumberError,
      phoneNumberRejected: true,
    };
  }
  if (feedback.paymentError) {
    return {
      submitted: false,
      canRetry: isRetryablePaypalProfileError(feedback.paymentError),
      message: `已点击 Agree & Create Account，但 PayPal 返回错误：${feedback.paymentError}`,
      paymentError: feedback.paymentError,
    };
  }
  if (feedback.fieldError) {
    return {
      submitted: false,
      canRetry: true,
      message: `已点击 Agree & Create Account，但 PayPal 表单字段错误：${feedback.fieldError}`,
      paymentError: feedback.fieldError,
    };
  }
  return { submitted: true, canRetry: false, message: '已点击 Agree & Create Account' };
}

function findPaypalCreateAccountSubmitButton(): HTMLButtonElement | null {
  const selectors = [
    'button[data-testid="submit-button"]',
    'button[data-atomic-wait-intent="click_select_create_account_and_continue"]',
    'button[data-atomic-wait-task="review_your_payment"]',
    'button[type="submit"]',
  ];
  for (const selector of selectors) {
    const button = querySelectorCandidate(selector);
    if (button instanceof HTMLButtonElement && isVisible(button) && isPaypalCreateAccountSubmitButton(button)) {
      return button;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => isVisible(button) && isPaypalCreateAccountSubmitButton(button)) || null;
}

function isPaypalCreateAccountSubmitButton(button: HTMLButtonElement): boolean {
  const marker = normalizedText([
    button.textContent,
    button.id,
    button.name,
    button.type,
    button.dataset.testid,
    button.getAttribute('data-atomic-wait-intent'),
    button.getAttribute('data-atomic-wait-task'),
    button.getAttribute('aria-label'),
  ].join(' '));
  return marker.includes('agree & create account') ||
    marker.includes('agree and create account') ||
    marker.includes('create account and continue') ||
    marker.includes('click_select_create_account_and_continue') ||
    marker.includes('review_your_payment') ||
    marker.includes('同意并创建账户') ||
    marker.includes('同意并继续');
}

async function waitForPaypalCreateAccountFeedback(timeoutMs: number): Promise<{
  paymentError?: string;
  phoneNumberError?: string;
  fieldError?: string;
}> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const phoneNumberError = findPaypalPhoneNumberRejectedError();
    if (phoneNumberError) {
      return { phoneNumberError };
    }
    const paymentError = findPaypalPageLevelError();
    if (paymentError) {
      return { paymentError };
    }
    const fieldError = findPaypalFieldError();
    if (fieldError) {
      return { fieldError };
    }
    if (findScaCodeContainer()) {
      return {};
    }
    await wait(180);
  }
  return {};
}

function findPaypalPageLevelError(): string {
  const restrictedError = findPaypalRestrictedAccountError();
  if (restrictedError) {
    return restrictedError;
  }

  const selectors = [
    '[data-error-key]',
    '[data-testid="page-level-error-message"]',
    '[role="alert"]',
    '.pageLevelError',
    '.error',
  ];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
    for (const element of elements) {
      const text = normalizedText(element.textContent || '');
      const key = normalizedText(element.getAttribute('data-error-key') || '');
      if (text || key) {
        return [key, text].filter(Boolean).join(' ');
      }
    }
  }
  return '';
}

function findPaypalFieldError(): string {
  const selectors = [
    '.ErrorText',
    '[class*="ErrorText"]',
    '[id$="-error"]',
    '[aria-live="polite"]',
    '[aria-live="assertive"]',
  ];
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
    for (const element of elements) {
      const text = compactText(element.textContent || '');
      if (!text) {
        continue;
      }
      const normalized = normalizedText(text);
      if (!isPaypalFieldErrorText(normalized) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      messages.push(text);
      if (messages.length >= 3) {
        break;
      }
    }
    if (messages.length >= 3) {
      break;
    }
  }
  return messages.join('；');
}

function isPaypalFieldErrorText(text: string): boolean {
  return Boolean(text) && (
    text.includes('required') ||
    text.includes('invalid') ||
    text.includes('valid card') ||
    text.includes('card number') ||
    text.includes('expiration') ||
    text.includes('security code') ||
    text.includes('cvv') ||
    text.includes('postal') ||
    text.includes('zip') ||
    text.includes('phone') ||
    text.includes('unsupported characters') ||
    text.includes('unsupported character') ||
    text.includes('first name') ||
    text.includes('last name') ||
    text.includes('请填写') ||
    text.includes('必填') ||
    text.includes('无效') ||
    text.includes('有效') ||
    text.includes('卡号') ||
    text.includes('安全码') ||
    text.includes('邮编') ||
    text.includes('电话号码')
  );
}

function findPaypalRestrictedAccountError(): string {
  if (!isPaypalGenericErrorPage()) {
    return '';
  }

  const message = Array.from(document.querySelectorAll<HTMLElement>('p.message, .message, [role="alert"], body'))
    .filter(isVisible)
    .map((element) => normalizedText(element.textContent || ''))
    .find((text) => isPaypalRestrictedAccountText(text)) || '';
  const body = normalizedText(document.body?.innerText || document.body?.textContent || '');
  if (!message && !isPaypalRestrictedAccountText(body)) {
    return '';
  }
  return message || 'Your account is limited. Please check your PayPal Account Overview page for information on how to resolve this problem.';
}

function isPaypalGenericErrorPage(): boolean {
  return location.hostname.endsWith('paypal.com') && location.pathname.startsWith('/checkoutweb/genericError');
}

function isPaypalRestrictedAccountText(text: string): boolean {
  const code = normalizedText(new URLSearchParams(location.search).get('code') || '');
  return text.includes('your account is limited') ||
    (text.includes('paypal account overview') && text.includes('resolve this problem')) ||
    code === 'ukvtvfjjq1rfrf9vu0vs';
}

function findPaypalSmsCodeInvalidError(): string {
  const alerts = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="alert"], [data-ppui-info^="alert"], .alert, .Notice, .error',
  )).filter(isVisible);
  for (const alert of alerts) {
    const text = normalizedText(alert.textContent || '');
    if (isPaypalSmsCodeInvalidText(text)) {
      return compactText(alert.textContent || '') || 'Sorry, something went wrong. Get a new code.';
    }
  }

  const body = normalizedText(document.body?.innerText || document.body?.textContent || '');
  if (isPaypalSmsCodeInvalidText(body)) {
    return 'Sorry, something went wrong. Get a new code.';
  }
  return '';
}

function isPaypalSmsCodeInvalidText(text: string): boolean {
  return (text.includes('sorry, something went wrong') && text.includes('get a new code')) ||
    text.includes('get a new code') ||
    text.includes('重新获取验证码') ||
    text.includes('获取新的验证码') ||
    text.includes('验证码不可用') ||
    text.includes('验证码无效');
}

function findPaypalSmsResendButton(): HTMLButtonElement | null {
  const selectors = [
    'button[data-testid="resend-link"]',
    'button[name="resend"]',
    'button[id*="resend" i]',
  ];
  for (const selector of selectors) {
    const button = querySelectorCandidate(selector);
    if (button instanceof HTMLButtonElement && isClickableButton(button)) {
      return button;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => {
      if (!isClickableButton(button)) {
        return false;
      }
      const text = normalizedText([
        button.textContent,
        button.dataset.testid,
        button.id,
        button.name,
        button.getAttribute('aria-label'),
      ].join(' '));
      return text === 'resend' ||
        text.includes('resend') ||
        text.includes('get a new code') ||
        text.includes('重新发送') ||
        text.includes('重新获取');
    }) || null;
}

function findPaypalPhoneNumberRejectedError(): string {
  const exact = document.querySelector<HTMLElement>('[data-testid="sca-confirm-multi-field"]');
  if (exact && isVisible(exact) && isPaypalPhoneNumberRejectedContainer(exact)) {
    return paypalPhoneNumberRejectedText(exact);
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-testid="exceed-main"], [data-testid="exceed-para"], [data-testid="primary-button-exceed"], div, section, form',
  )).filter(isVisible);
  for (const element of candidates) {
    const container = element.closest<HTMLElement>('[data-testid="sca-confirm-multi-field"]') || element;
    if (isVisible(container) && isPaypalPhoneNumberRejectedContainer(container)) {
      return paypalPhoneNumberRejectedText(container);
    }
  }
  return '';
}

function dismissPaypalPhoneNumberRejectedDialog(): boolean {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-testid="sca-confirm-multi-field"] button[data-testid="primary-button-exceed"]',
  );
  if (button && isClickableButton(button)) {
    clickButton(button);
    return true;
  }
  return false;
}

function isPaypalPhoneNumberRejectedContainer(element: HTMLElement): boolean {
  const text = normalizedText(element.textContent || '');
  const hasExceedMarker = Boolean(
    element.querySelector('[data-testid="exceed-main"]') ||
      element.querySelector('[data-testid="exceed-para"]') ||
      element.querySelector('[data-testid="primary-button-exceed"]'),
  );
  return hasExceedMarker &&
    text.includes('unable to complete your request') &&
    text.includes('different phone number');
}

function paypalPhoneNumberRejectedText(element: HTMLElement): string {
  const title = compactText(element.querySelector('[data-testid="exceed-main"]')?.textContent || '');
  const detail = compactText(element.querySelector('[data-testid="exceed-para"]')?.textContent || '');
  return [title, detail].filter(Boolean).join('；') || compactText(element.textContent || '');
}

function isRetryablePaypalProfileError(message: string): boolean {
  const text = normalizedText(message);
  if (isPaypalRestrictedAccountText(text)) {
    return false;
  }
  return text.includes('cclinked') ||
    text.includes('already been added') ||
    text.includes('another paypal account') ||
    text.includes('try a different') ||
    text.includes('different way to pay') ||
    text.includes('invalidaddress') ||
    text.includes('invalid address') ||
    text.includes('check the address you entered') ||
    text.includes('unsupported characters') ||
    text.includes('unsupported character') ||
    text.includes('first name') ||
    text.includes('last name') ||
    text.includes('card') ||
    text.includes('payment');
}

function findPaypalCreateAccountButton(): HTMLButtonElement | null {
  const selectors = [
    'button#startOnboardingFlow',
    'button[name="startOnboardingFlow"]',
    'button.onboardingFlowContentKey',
    'button[data-atomic-wait-intent="Pay_With_Card"]',
    'button[data-atomic-wait-viewname="email"][data-atomic-wait-task="login_create_account"]',
  ];
  for (const selector of selectors) {
    const button = querySelectorCandidate(selector);
    if (
      button instanceof HTMLButtonElement &&
      isDisplayedElement(button) &&
      (isPaypalCreateAccountButtonStrongSignal(button) || isPaypalCreateAccountButtonText(button))
    ) {
      return button;
    }
  }

  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => {
      if (!isDisplayedElement(button)) {
        return false;
      }
      return isPaypalCreateAccountButtonStrongSignal(button) || isPaypalCreateAccountButtonText(button);
    }) || null;
}

async function clickPaypalCreateAccountEntryButton(button: HTMLButtonElement): Promise<{ clicked: boolean; message: string }> {
  let target = button;
  if (!isClickableButton(target) || !isElementTopClickable(target, true)) {
    target = await waitForPaypalCreateAccountButtonClickable(4_000) || target;
  }
  if (!isClickableButton(target) || !isElementTopClickable(target, true)) {
    return {
      clicked: false,
      message: `PayPal 创建账户入口按钮暂不可点击：${paypalCreateAccountButtonDebug(target)}`,
    };
  }
  clickButton(target);
  await wait(220);
  return {
    clicked: true,
    message: `当前是 PayPal 登录页，已点击创建账户入口，等待创建表单：${paypalCreateAccountButtonDebug(target)}`,
  };
}

async function waitForPaypalCreateAccountButtonClickable(timeoutMs: number): Promise<HTMLButtonElement | null> {
  const started = Date.now();
  let button = findPaypalCreateAccountButton();
  while (Date.now() - started < timeoutMs) {
    if (button && isClickableButton(button) && isElementTopClickable(button, true)) {
      return button;
    }
    await wait(100);
    button = findPaypalCreateAccountButton();
  }
  return button;
}

function isPaypalCreateAccountButtonStrongSignal(button: HTMLButtonElement): boolean {
  return button.id === 'startOnboardingFlow' ||
    button.name === 'startOnboardingFlow' ||
    button.classList.contains('onboardingFlowContentKey');
}

function isPaypalCreateAccountButtonText(button: HTMLButtonElement): boolean {
  const marker = normalizedText([
    button.textContent,
    button.id,
    button.name,
    button.type,
    button.getAttribute('data-atomic-wait-intent'),
    button.getAttribute('data-atomic-wait-task'),
    button.getAttribute('data-atomic-wait-viewname'),
    button.getAttribute('aria-label'),
  ].join(' '));
  if (marker.includes('continue_to_payment') ||
      marker.includes('guest_checkout_request') ||
      marker.includes('continue to payment') ||
      marker.includes('continue to checkout') ||
      marker.includes('继续付款')) {
    return false;
  }
  return marker.includes('pay_with_card') ||
    marker === '创建账户' ||
    marker === 'create an account' ||
    marker === 'create account' ||
    marker.includes('アカウントを開設') ||
    marker.includes('アカウント開設') ||
    marker.includes('create paypal account') ||
    marker.includes('create a paypal account');
}

function detectPaypalCheckoutEmailMode(): 'create' | 'login-with-create' | 'login' | 'unknown' {
  const text = normalizedText(document.body?.innerText || document.body?.textContent || '');
  const hasOnboardingEmail = Boolean(document.querySelector('input#onboardingFlowEmail'));
  const emailInput = findPaypalCheckoutEmailInput();
  const hasVisibleEmailInput = Boolean(emailInput && isVisible(emailInput));
  const hasCheckoutEmailForm = hasPaypalCheckoutEmailForm();
  const createButton = findPaypalCreateAccountButton();
  if (createButton && isPaypalPayCreateAccountEntryPage()) {
    return 'login-with-create';
  }

  const hasPasswordInput = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    .some((input) => isVisible(input));
  const hasLoginHeading = text.includes('登录您的paypal账户') ||
    text.includes('登录您的 paypal 账户') ||
    text.includes('log in to your paypal account') ||
    text.includes('login to your paypal account');
  const hasLoginButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .some((button) => {
      if (!isVisible(button)) {
        return false;
      }
      const buttonText = normalizedText(button.textContent || '');
      return buttonText === '登录' || buttonText === 'log in' || buttonText === 'login';
    });

  const hasCreateCheckoutText = hasPaypalCreateCheckoutText(text);
  if (
    hasOnboardingEmail ||
    isPaypalOnboardingEmailPage() ||
    hasCreateCheckoutText ||
    hasCheckoutEmailForm ||
    (
      hasVisibleEmailInput &&
      isPaypalPayCreateAccountEntryPage() &&
      !hasPasswordInput &&
      !hasLoginHeading &&
      !hasLoginButton
    )
  ) {
    return 'create';
  }

  if (
    createButton &&
    (
      isPaypalAgreementApprovePage() ||
      isPaypalPayCreateAccountEntryPage() ||
      hasLoginHeading ||
      hasLoginButton ||
      text.includes('首先，请输入您的邮箱地址') ||
      text.includes('请先输入您的电子邮箱地址') ||
      text.includes('please enter your email address')
    )
  ) {
    return 'login-with-create';
  }
  if (hasPasswordInput || hasLoginHeading || hasLoginButton) {
    return 'login';
  }
  return 'unknown';
}

function waitForPayPalUiTick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 120));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForButtonEnabled(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
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

function renderPasswordEmailNote(email: string, password: string): void {
  const anchor = findPasswordDisclaimerAnchor();
  if (!anchor) {
    return;
  }

  fillPasswordField(password);

  const noteId = 'opx-paypal-password-note';
  const text = `当前密码由邮箱前缀生成（${email} -> ${password}）`;
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

function clickButton(button: HTMLButtonElement): void {
  button.scrollIntoView({ block: 'center', inline: 'center' });
  button.focus({ preventScroll: true });
  const rect = button.getBoundingClientRect();
  const clientX = rect.left + Math.max(1, rect.width / 2);
  const clientY = rect.top + Math.max(1, rect.height / 2);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    button.dispatchEvent(new EventCtor(type, {
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
  button.click();
}

function installObserver(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    removePaypalCaptchaComponent();
    primeScaPromptFromDom();
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

function removePaypalCaptchaComponent(): boolean {
  if (hasPaypalSliderChallenge()) {
    return false;
  }
  const captcha = document.getElementById(PAYPAL_CAPTCHA_COMPONENT_ID);
  if (!captcha) {
    return false;
  }
  if (captcha.querySelector('.sliderContainer, .slider')) {
    return false;
  }
  captcha.remove();
  console.info(`${LOG_PREFIX} removed #${PAYPAL_CAPTCHA_COMPONENT_ID}`);
  return true;
}

function hasPaypalSliderChallenge(): boolean {
  // PayPal 滑块 DOM 检测源头：第 11 步会读取 sliderChallengeFound。
  // 如果后续需要在检测到滑块时执行页面调试 JS 或人工辅助提示，入口在 runner-payment-ready.ts 的 paypal-slider-challenge 分支。
  if (hasPaypalDataDomeCaptchaChallenge()) {
    return true;
  }
  const sliderContainer = document.querySelector<HTMLElement>('.sliderContainer');
  const slider = document.querySelector<HTMLElement>('.slider');
  return Boolean(
    sliderContainer &&
      slider &&
      isVisible(sliderContainer) &&
      isVisible(slider),
  );
}

function hasPaypalDataDomeCaptchaChallenge(): boolean {
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[title*="DataDome" i], iframe[src*="geo.ddc.paypal.com/captcha"], iframe[src*="ct.ddc.paypal.com"]',
  );
  const form = document.querySelector<HTMLFormElement>('form#ads-dd-captcha, form input[name="adsddcaptcha"]');
  return Boolean(
    (iframe && isVisible(iframe)) ||
      form ||
      document.querySelector('script[src*="ct.ddc.paypal.com/c.js"], script[data-cfasync="false"]'),
  );
}

function primeScaPromptFromDom(): void {
  const container = findScaCodeContainer();
  if (container) {
    noteScaPrompt(container);
  }
}

function installRandomFillButton(): void {
  if (!isPaypalSignupPage() || document.getElementById(PAYPAL_RANDOM_BUTTON_ID)) {
    return;
  }

  const firstFieldAnchor = findPaypalSignupFirstFieldAnchor();
  const cardBrandAnchor = findPayPalHintAnchor();
  const cardFieldAnchor = findCardFieldAnchor();
  const widget = createRandomFillWidget();
  if (firstFieldAnchor?.parentElement) {
    firstFieldAnchor.parentElement.insertBefore(widget, firstFieldAnchor);
    return;
  }
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

function findPaypalSignupFirstFieldAnchor(): Element | null {
  const form = document.querySelector('form');
  const scope = form || document;
  const preferredControl = querySelectorCandidate('select[data-testid="countrySelector"]') ||
    querySelectorCandidate('select#country') ||
    querySelectorCandidate('select[name="country"]') ||
    querySelectorCandidate('select[name="country.x"]');
  const firstControl = isSupportedFormControl(preferredControl) && isVisible(preferredControl) && !isIgnoredInput(preferredControl)
    ? preferredControl
    : Array.from(scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
      .find((control) => isSupportedFormControl(control) && isVisible(control) && !isIgnoredInput(control));

  if (!firstControl) {
    return null;
  }

  return findFieldContainer(firstControl, form);
}

function findFieldContainer(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  form: HTMLFormElement | null,
): Element {
  let anchor: Element = control;
  let current: Element = control;
  const boundary = form || document.body;

  while (true) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent || parent === boundary) {
      break;
    }
    if (parent.matches('form, section, fieldset, main')) {
      break;
    }

    const controlCount = parent.querySelectorAll('input, textarea, select').length;
    if (controlCount > 1 && parent !== control.parentElement) {
      break;
    }

    anchor = parent;
    current = parent;
  }

  return anchor;
}

function isSupportedFormControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return Boolean(
    element &&
    (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ),
  );
}

async function fetchFreshAddressAndFill(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
  if (extensionContextStopped || !canUseExtensionApi()) {
    stopForExtensionContextInvalidated();
    status.textContent = '插件已重新加载，请刷新当前页面';
    return;
  }

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
    if (isExtensionContextInvalidated(error)) {
      stopForExtensionContextInvalidated();
      status.textContent = '插件已重新加载，请刷新当前页面';
      return;
    }
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
  if (!canUseExtensionApi()) {
    stopForExtensionContextInvalidated();
    return;
  }
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (extensionContextStopped || !canUseExtensionApi()) {
      stopForExtensionContextInvalidated();
      return;
    }
    if (areaName !== 'local') {
      return;
    }
    if (Object.keys(changes).some((key) => key.includes('settings'))) {
      pageAddress = null;
      resetAttempts();
      scheduleAutofill(100);
      return;
    }
    if (isPaypalSignupPage() && (hasSmsRelayHistoryChange(changes) || hasSmsRelayStateChange(changes) && Boolean(findScaCodeContainer()))) {
      scheduleAutofill(100);
      return;
    }
  });
}

function hasSmsRelayStateChange(changes: Record<string, StorageChangeValue>): boolean {
  return Object.keys(changes).some((key) => key.includes('registerAssist.state'));
}

function hasSmsRelayHistoryChange(changes: Record<string, StorageChangeValue>): boolean {
  for (const key of Object.keys(changes)) {
    if (!key.includes('registerAssist.state')) {
      continue;
    }
    const change = changes[key];
    const oldHistory = readSmsRelayHistoryLength(change.oldValue);
    const newHistory = readSmsRelayHistoryLength(change.newValue);
    if (newHistory > oldHistory) {
      return true;
    }
  }
  return false;
}

function readSmsRelayHistoryLength(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  const smsRelay = isRecord(value.smsRelay) ? value.smsRelay : null;
  return Array.isArray(smsRelay?.history) ? smsRelay.history.length : 0;
}

function scheduleAutofill(delayMs: number): void {
  if (extensionContextStopped || !canUseExtensionApi()) {
    stopForExtensionContextInvalidated();
    return;
  }
  cancelScheduledAutofill();
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

function cancelScheduledAutofill(): void {
  if (scheduledTimer) {
    window.clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

function scheduleManualSessionAutofill(delayMs: number): void {
  if (extensionContextStopped || !canUseExtensionApi()) {
    stopForExtensionContextInvalidated();
    return;
  }
  window.setTimeout(() => {
    if (extensionContextStopped || !canUseExtensionApi()) {
      stopForExtensionContextInvalidated();
      return;
    }
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

function loadSessionPaypalEmail(): string {
  try {
    const email = sessionStorage.getItem(PAYPAL_EMAIL_SESSION_KEY) || '';
    return isEmail(email) ? email : '';
  } catch {
    return '';
  }
}

function rememberSessionPaypalEmail(email: string): void {
  try {
    sessionStorage.setItem(PAYPAL_EMAIL_SESSION_KEY, email);
  } catch {
    // Ignore storage failures on restricted pages.
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
  const words = fullName
    .split(/[^a-zA-Z]+/)
    .map((item) => titleCaseNamePart(item))
    .filter((item) => isFriendlyPaypalNamePart(item));
  if (words.length >= 2) {
    return {
      first: words[0],
      last: words.slice(1).join(' '),
    };
  }
  if (words.length === 1) {
    return {
      first: words[0],
      last: fallbackLastName(words[0]),
    };
  }

  return {
    first: randomPaypalFirstName(),
    last: randomPaypalLastName(),
  };
}

function titleCaseNamePart(value: string): string {
  const letters = value.replace(/[^a-zA-Z]/g, '');
  if (!letters) {
    return '';
  }
  const lower = letters.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}

function isFriendlyPaypalNamePart(value: string): boolean {
  return /^[A-Za-z]{4,24}$/.test(value);
}

function fallbackLastName(first: string): string {
  const fallback = randomPaypalLastName();
  return fallback.toLowerCase() === first.toLowerCase() ? 'Walker' : fallback;
}

function randomPaypalFirstName(): string {
  return PAYPAL_FIRST_NAMES[randomInt(0, PAYPAL_FIRST_NAMES.length - 1)];
}

function randomPaypalLastName(): string {
  return PAYPAL_LAST_NAMES[randomInt(0, PAYPAL_LAST_NAMES.length - 1)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createRandomOutlookEmail(): string {
  return `${randomEmailLocalPart(16)}@outlook.com`;
}

function randomEmailLocalPart(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  if (!/[a-z]/.test(chars[0])) {
    chars[0] = 'p';
  }
  return chars.join('');
}

function isPaypalSignupPage(): boolean {
  return location.hostname.endsWith('paypal.com') && location.pathname.startsWith('/checkoutweb/signup');
}

function isPaypalCheckoutSigninPage(): boolean {
  if (!location.hostname.endsWith('paypal.com') || !location.pathname.startsWith('/signin')) {
    return false;
  }
  return new URLSearchParams(location.search).get('intent') === 'checkout';
}

function isPaypalAgreementApprovePage(): boolean {
  if (!location.hostname.endsWith('paypal.com') || !location.pathname.startsWith('/agreements/approve')) {
    return false;
  }
  return new URLSearchParams(location.search).has('ba_token');
}

function isPaypalBillingConsentPage(): boolean {
  if (!location.hostname.endsWith('paypal.com')) {
    return false;
  }
  if (isPaypalPayCreateAccountEntryPage()) {
    return false;
  }
  const params = new URLSearchParams(location.search);
  if (location.pathname.startsWith('/pay/billing')) {
    return params.has('token') || params.get('fromSignupLite') === 'true';
  }
  if (location.pathname.startsWith('/webapps/hermes')) {
    return params.has('token') ||
      params.has('ba_token') ||
      params.get('fromSignupLite') === 'true' ||
      location.hash.includes('/billingweb/review');
  }
  if (isPaypalPayPath()) {
    return params.has('token') || params.has('ba_token') || params.get('ul') === '1';
  }
  return false;
}

function isPaypalCheckoutEmailPage(): boolean {
  return isPaypalCheckoutSigninPage() ||
    isPaypalPayCreateAccountEntryPage() ||
    isPaypalOnboardingEmailPage() ||
    hasPaypalCheckoutEmailForm();
}

function isPaypalOnboardingEmailPage(): boolean {
  const form = findPaypalOnboardingEmailForm();
  return Boolean(form && isVisible(form));
}

function findPaypalOnboardingEmailForm(): HTMLFormElement | null {
  const selectors = [
    'form[name="beginOnboardingFlow"]',
    'form[action*="/signin/onboarding/continue"]',
  ];
  for (const selector of selectors) {
    const form = querySelectorCandidate(selector);
    if (form instanceof HTMLFormElement && isPaypalOnboardingEmailForm(form)) {
      return form;
    }
  }

  return Array.from(document.querySelectorAll<HTMLFormElement>('form'))
    .find((form) => isPaypalOnboardingEmailForm(form)) || null;
}

function isPaypalOnboardingEmailForm(form: HTMLFormElement): boolean {
  const hasEmailInput = Boolean(form.querySelector('input#onboardingFlowEmail, input[name="login_email"][type="email"]'));
  if (!hasEmailInput) {
    return false;
  }
  const formName = normalizedText(form.name);
  const action = normalizedText(form.getAttribute('action') || '');
  return formName === 'beginonboardingflow' ||
    action.includes('/signin/onboarding/continue') ||
    Boolean(form.querySelector('input[name="isForcedSignup"][value="true"]'));
}

function isPaypalPayCreateAccountEntryPage(): boolean {
  if (!location.hostname.endsWith('paypal.com') || !isPaypalPayPath()) {
    return false;
  }
  if (!isPaypalPayPageWithCheckoutToken()) {
    return false;
  }
  const text = normalizedText(document.body?.innerText || document.body?.textContent || '');
  return Boolean(findPaypalCreateAccountButton()) ||
    hasPaypalCreateCheckoutText(text) ||
    text.includes('请先输入您的电子邮箱地址') ||
    text.includes('please enter your email address') ||
    text.includes('email address or mobile number');
}

function isPaypalPayPageWithCheckoutToken(): boolean {
  if (!location.hostname.endsWith('paypal.com') || !isPaypalPayPath()) {
    return false;
  }
  const params = new URLSearchParams(location.search);
  return params.has('token') || params.has('ba_token') || params.get('ul') === '1';
}

function isPaypalPayPath(): boolean {
  return location.pathname.replace(/\/+$/, '') === '/pay';
}

function hasPaypalCreateCheckoutText(text: string): boolean {
  return (
    text.includes('创建paypal账户') ||
    text.includes('create an account') ||
    text.includes('create paypal account') ||
    text.includes('create a paypal account')
  ) && (
    text.includes('继续付款') ||
    text.includes('continue to payment') ||
    text.includes('continue to checkout') ||
    text.includes('continue payment')
  );
}

function hasPaypalCheckoutEmailForm(): boolean {
  const emailInput = findPaypalCheckoutEmailInput();
  const continueButton = findPaypalCheckoutContinueButton();
  return Boolean(
    emailInput &&
      isVisible(emailInput) &&
      continueButton &&
      isVisible(continueButton),
  );
}

function isPaypalSupportedPage(): boolean {
  return isPaypalSignupPage() ||
    isPaypalPayPageWithCheckoutToken() ||
    isPaypalCheckoutEmailPage() ||
    isPaypalBillingConsentPage() ||
    isPaypalAgreementApprovePage();
}

function detectPaypalCheckoutPageKind(): string {
  if (!location.hostname.endsWith('paypal.com')) {
    return 'not-paypal';
  }
  if (isPaypalGenericErrorPage()) {
    return 'generic-error';
  }
  if (isPaypalSignupPage()) {
    return 'signup';
  }
  if (isPaypalBillingConsentPage()) {
    return 'billing-consent';
  }
  if (findScaCodeContainer()) {
    return 'sca-code';
  }
  if (isPaypalAgreementApprovePage()) {
    if (findPaypalCreateAccountButton()) {
      return 'account-entry';
    }
    if (isPaypalOnboardingEmailPage() || hasPaypalCheckoutEmailForm()) {
      return 'checkout-email';
    }
    return 'agreement-approve';
  }
  const mode = detectPaypalCheckoutEmailMode();
  if (mode === 'create') {
    return 'checkout-email';
  }
  if (mode === 'login-with-create' || isPaypalPayCreateAccountEntryPage()) {
    return 'account-entry';
  }
  if (isPaypalCheckoutEmailPage()) {
    return 'checkout-email';
  }
  if (isPaypalPayPageWithCheckoutToken()) {
    return 'pay-token';
  }
  return 'unsupported-paypal';
}

function paypalCheckoutPageData(pageKind: string): Record<string, unknown> {
  const createAccountButton = findPaypalCreateAccountButton();
  return {
    pageKind,
    url: location.href,
    readyState: document.readyState,
    emailMode: location.hostname.endsWith('paypal.com') ? detectPaypalCheckoutEmailMode() : 'unknown',
    createAccountButtonFound: Boolean(createAccountButton),
    createAccountButtonClickable: Boolean(createAccountButton && isClickableButton(createAccountButton) && isElementTopClickable(createAccountButton)),
    createAccountButtonDisabled: createAccountButton ? createAccountButton.disabled : false,
    createAccountButtonAriaDisabled: createAccountButton ? createAccountButton.getAttribute('aria-disabled') === 'true' : false,
    createAccountButtonText: createAccountButton ? compactText(createAccountButton.textContent || '') : '',
    createAccountButtonBlockedBy: createAccountButton ? describeTopClickableBlocker(createAccountButton) : '',
    emailInputFound: Boolean(findPaypalCheckoutEmailInput()),
    continueButtonFound: Boolean(findPaypalCheckoutContinueButton()),
    billingConsentButtonFound: Boolean(findPaypalBillingConsentButton()),
    sliderChallengeFound: hasPaypalSliderChallenge(),
    captchaComponentFound: Boolean(document.getElementById(PAYPAL_CAPTCHA_COMPONENT_ID)),
  };
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
  return isDisplayedElement(element);
}

function isDisplayedElement(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  const style = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();
  return style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width > 0 &&
    rect.height > 0;
}

function isClickableButton(button: HTMLButtonElement): boolean {
  return isVisible(button) &&
    !button.disabled &&
    button.getAttribute('aria-disabled') !== 'true';
}

function isElementTopClickable(element: HTMLElement, scrollIntoView = false): boolean {
  if (!isVisible(element)) {
    return false;
  }
  if (scrollIntoView) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  }
  const rect = element.getBoundingClientRect();
  const points = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + Math.max(2, rect.width * 0.2), rect.top + rect.height / 2],
    [rect.right - Math.max(2, rect.width * 0.2), rect.top + rect.height / 2],
  ];
  return points.some(([x, y]) => {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return false;
    }
    const top = document.elementFromPoint(x, y);
    return Boolean(top && (top === element || element.contains(top)));
  });
}

function describeTopClickableBlocker(element: HTMLElement): string {
  if (!isVisible(element)) {
    return 'not-visible';
  }
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return 'outside-viewport';
  }
  const top = document.elementFromPoint(x, y);
  if (!top) {
    return 'no-top-element';
  }
  if (top === element || element.contains(top)) {
    return '';
  }
  return elementDebugName(top);
}

function paypalCreateAccountButtonDebug(button: HTMLButtonElement | null): string {
  if (!button) {
    return 'button=missing';
  }
  const text = compactText(button.textContent || '');
  const parts = [
    `id=${button.id || '-'}`,
    `text=${text || '-'}`,
    `disabled=${button.disabled ? '1' : '0'}`,
    `ariaDisabled=${button.getAttribute('aria-disabled') === 'true' ? '1' : '0'}`,
    `visible=${isVisible(button) ? '1' : '0'}`,
    `topClickable=${isElementTopClickable(button) ? '1' : '0'}`,
  ];
  const blocker = describeTopClickableBlocker(button);
  if (blocker) {
    parts.push(`blockedBy=${blocker}`);
  }
  return parts.join(', ');
}

function elementDebugName(element: Element): string {
  const htmlElement = element as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const id = htmlElement.id ? `#${htmlElement.id}` : '';
  const className = typeof htmlElement.className === 'string'
    ? htmlElement.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    : '';
  const classSuffix = className ? `.${className}` : '';
  return `${tag}${id}${classSuffix}`;
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

function compactText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
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
    'input#countrySpecificKanjiFirstName',
    'input#firstName',
    'input#billingFirstName',
    'input[name="firstName"]',
    'input[name="billingFirstName"]',
    'input[autocomplete="given-name"]',
    'first name',
  ],
  lastName: [
    'input#countrySpecificKanjiLastName',
    'input#lastName',
    'input#billingLastName',
    'input[name="lastName"]',
    'input[name="billingLastName"]',
    'input[autocomplete="family-name"]',
    'last name',
  ],
  kanaFirstName: [
    'input#countrySpecificFirstName',
    'input[name="countrySpecificFirstName"]',
    '[data-testid="kana-names"] input[autocomplete="given-name"]',
    '[data-testid="kana-names"] input[name="fname"]',
  ],
  kanaLastName: [
    'input#countrySpecificLastName',
    'input[name="countrySpecificLastName"]',
    '[data-testid="kana-names"] input[autocomplete="family-name"]',
    '[data-testid="kana-names"] input[name="lname"]',
  ],
  dateOfBirth: [
    'input#dateOfBirth',
    'input[name="dateOfBirth"]',
    'input[autocomplete="bday"]',
    'date of birth',
    'birthday',
    '生年月日',
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

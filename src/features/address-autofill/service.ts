import { getBrowserTab, isContentScriptUrl, sendActiveTabMessage, sendTabMessage } from '../../app/active-tab';
import { PAGE_ACTION } from '../../app/page-actions';
import type { ActionResult } from '../../app/types';
import { loadAddressAutofillSettings, saveAddressAutofillSettings } from '../settings/state';
import { fillPayOpenAiAddressNow } from './pay-openai-autofill';
import { fillPaypalAddressNow } from './paypal-autofill';
import type { AddressProfile, RandomAddressResponse } from './types';

interface StripeAddressFrameFillResult {
  ok: boolean;
  foundFrame: boolean;
  filled: number;
  message: string;
  canRetry?: boolean;
  frameUrl?: string;
}

interface StripePaypalFrameSelectResult {
  ok: boolean;
  foundFrame: boolean;
  foundPaypal: boolean;
  selected: boolean;
  message: string;
  canRetry?: boolean;
  frameUrl?: string;
}

const STRIPE_ADDRESS_FRAME_WAIT_MS = 6_000;
const STRIPE_ADDRESS_FRAME_WAIT_INTERVAL_MS = 300;

export async function fetchRandomAddressFromSettings(): Promise<RandomAddressResponse> {
  const settings = await loadAddressAutofillSettings();
  const response: RandomAddressResponse = await browser.runtime.sendMessage({
    type: 'opx:fetch-random-address',
    countryCode: settings.countryCode,
    city: settings.city,
  });
  if (response?.ok && response.address) {
    await saveAddressAutofillSettings({ lastAddress: response.address });
  }
  return response;
}

export async function fillCurrentPaymentPageWithAddress(address: AddressProfile, tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是支持填写的支付页' : '当前标签页不是支持填写的支付页' };
    }
    const message = {
      type: PAGE_ACTION.fillCurrentPaymentAddress,
      address,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  if (location.hostname === 'pay.openai.com') {
    return fillPayOpenAiAddressNow(address);
  }
  if (location.hostname.endsWith('paypal.com')) {
    return fillPaypalAddressNow(address, true, false);
  }
  return { ok: false, message: '当前页面不是支持填写的支付页' };
}

export async function checkCurrentPaymentPageReady(
  kind: 'openai-checkout' | 'paypal-account-entry' | 'paypal-email' | 'paypal-profile' | 'paypal-page-error',
  tabId?: number,
): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是支持检查的支付页' : '当前标签页不是支持检查的支付页' };
    }
    const message = {
      type: PAGE_ACTION.paymentCheckReady,
      kind,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  return { ok: false, message: '当前上下文不支持支付页面状态检查' };
}

export async function submitCurrentOpenAiCheckout(address: AddressProfile, tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是 OpenAI 支付页' : '当前标签页不是 OpenAI 支付页' };
    }
    if (typeof tab?.id !== 'number') {
      return { ok: false, message: tabId ? '自动化目标标签页不存在或已关闭' : '没有可操作的当前标签页' };
    }
    const paypalSelect = await selectStripePaypalFrameIfNeeded(tab.id);
    if (!paypalSelect.ok) {
      return {
        ok: false,
        message: paypalSelect.message,
        data: {
          ...paypalSelect,
          canRetry: paypalSelect.canRetry !== false,
        },
      };
    }
    const stripeFill = await fillStripeAddressFramesIfNeeded(tab.id, address, paypalSelect.foundPaypal);
    if (!stripeFill.ok) {
      return {
        ok: false,
        message: stripeFill.message,
        data: {
          ...stripeFill,
          canRetry: stripeFill.canRetry !== false,
        },
      };
    }
    const message = {
      type: PAGE_ACTION.openAiSubmitCheckout,
      address,
    };
    const result = tabId ? await sendTabMessage<ActionResult>(message, tabId) : await sendActiveTabMessage<ActionResult>(message);
    if ((paypalSelect.foundFrame && paypalSelect.foundPaypal) || (stripeFill.foundFrame && stripeFill.filled > 0)) {
      return {
        ...result,
        message: `${appendNonEmptyMessages([paypalSelect.message, stripeFill.message])}；${result.message}`,
        data: {
          stripePaypalFrame: paypalSelect,
          stripeAddressFrame: stripeFill,
          ...(isRecord(result.data) ? result.data : {}),
        },
      };
    }
    return result;
  }

  return { ok: false, message: '当前上下文不支持提交 OpenAI 支付页' };
}

export async function openCurrentPaypalAccountEntry(tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是 PayPal 页面' : '当前标签页不是 PayPal 页面' };
    }
    const message = {
      type: PAGE_ACTION.paypalOpenAccount,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  return { ok: false, message: '当前上下文不支持打开 PayPal 创建账户' };
}

export async function fillCurrentPaypalCheckoutEmail(tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是 PayPal 页面' : '当前标签页不是 PayPal 页面' };
    }
    const message = {
      type: PAGE_ACTION.paypalFillEmail,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  return { ok: false, message: '当前上下文不支持填写 PayPal 邮箱' };
}

export async function clickCurrentPaypalBillingConsent(tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是 PayPal 页面' : '当前标签页不是 PayPal 页面' };
    }
    const message = {
      type: PAGE_ACTION.paypalClickBillingConsent,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  return { ok: false, message: '当前上下文不支持点击 PayPal billing 同意按钮' };
}

export async function fillCurrentPaypalSmsCode(tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是 PayPal 页面' : '当前标签页不是 PayPal 页面' };
    }
    const message = {
      type: PAGE_ACTION.paypalFillSmsCode,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  return { ok: false, message: '当前上下文不支持填写 PayPal 手机验证码' };
}

export async function resendCurrentPaypalSmsCodeIfNeeded(tabId?: number): Promise<ActionResult> {
  if (isExtensionPage()) {
    const tab = await getBrowserTab(tabId);
    if (!isContentScriptUrl(tab?.url)) {
      return { ok: false, message: tabId ? '自动化目标标签页不是 PayPal 页面' : '当前标签页不是 PayPal 页面' };
    }
    const message = {
      type: PAGE_ACTION.paypalResendSmsCode,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
  }

  return { ok: false, message: '当前上下文不支持重发 PayPal 手机验证码' };
}

function isExtensionPage(): boolean {
  return location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function appendNonEmptyMessages(messages: string[]): string {
  return messages.filter(Boolean).join('；');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectStripePaypalFrameIfNeeded(tabId: number | undefined): Promise<StripePaypalFrameSelectResult> {
  if (typeof tabId !== 'number') {
    return { ok: true, foundFrame: false, foundPaypal: false, selected: false, message: '未指定标签页，跳过 Stripe PayPal 子框架选择' };
  }

  let results: Array<{ result?: StripePaypalFrameSelectResult }>;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: selectStripePaypalFrame,
    });
  } catch (error) {
    return {
      ok: false,
      foundFrame: true,
      foundPaypal: false,
      selected: false,
      canRetry: true,
      message: `Stripe PayPal 子框架注入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const frameResults = results
    .map((item) => item.result)
    .filter((item): item is StripePaypalFrameSelectResult => Boolean(item?.foundFrame));
  if (frameResults.length === 0) {
    return { ok: true, foundFrame: false, foundPaypal: false, selected: false, message: '未检测到 Stripe PayPal 子框架' };
  }

  const selected = frameResults.find((item) => item.ok && item.foundPaypal && item.selected);
  if (selected) {
    return selected;
  }

  const alreadySelected = frameResults.find((item) => item.ok && item.foundPaypal);
  if (alreadySelected) {
    return alreadySelected;
  }

  const failed = frameResults.find((item) => !item.ok) || frameResults[0];
  return {
    ok: false,
    foundFrame: true,
    foundPaypal: failed.foundPaypal,
    selected: false,
    canRetry: failed.canRetry !== false,
    message: failed.message || 'Stripe PayPal 子框架存在，但没有找到 PayPal 选项',
    frameUrl: failed.frameUrl,
  };
}

function selectStripePaypalFrame(): StripePaypalFrameSelectResult {
  const frameUrl = location.href;
  if (location.hostname !== 'js.stripe.com' || !/elements-inner-(?:payment|checkout|tabs)/.test(location.pathname)) {
    return { ok: true, foundFrame: false, foundPaypal: false, selected: false, message: '当前不是 Stripe PayPal 子框架', frameUrl };
  }

  const isVisible = (element: Element): boolean => {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);
    const rect = htmlElement.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const normalizedText = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clickElement = (element: HTMLElement): void => {
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
  };

  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    'button#paypal-tab, button[data-testid="paypal"], [role="tab"][value="paypal"], [aria-controls="paypal-panel"], button, [role="tab"], [role="radio"], [data-testid]',
  ))
    .filter(isVisible)
    .filter((element) => normalizedText([
      element.id,
      element.getAttribute('data-testid'),
      element.getAttribute('value'),
      element.getAttribute('aria-label'),
      element.textContent,
    ].join(' ')).includes('paypal'));
  const target = candidates[0] || null;
  if (!target) {
    return {
      ok: false,
      foundFrame: true,
      foundPaypal: false,
      selected: false,
      canRetry: true,
      message: `Stripe PayPal 子框架已加载，但未找到 PayPal 选项（候选=${document.querySelectorAll('button, [role="tab"], [role="radio"], [data-testid]').length}）`,
      frameUrl,
    };
  }

  const alreadySelected = target.getAttribute('aria-selected') === 'true' ||
    target.getAttribute('aria-checked') === 'true' ||
    target.className.includes('selected') ||
    target.className.includes('Selected');
  if (!alreadySelected) {
    clickElement(target);
  }

  return {
    ok: true,
    foundFrame: true,
    foundPaypal: true,
    selected: true,
    message: alreadySelected ? 'Stripe PayPal 子框架已选中 PayPal' : '已在 Stripe PayPal 子框架点击 PayPal',
    frameUrl,
  };
}

async function fillStripeAddressFramesIfNeeded(
  tabId: number | undefined,
  address: AddressProfile,
  waitForFrame: boolean,
): Promise<StripeAddressFrameFillResult> {
  if (typeof tabId !== 'number') {
    return { ok: true, foundFrame: false, filled: 0, message: '未指定标签页，跳过 Stripe 地址子框架填写' };
  }

  const startedAt = Date.now();
  let lastResult: StripeAddressFrameFillResult | null = null;
  while (true) {
    const result = await fillStripeAddressFramesOnce(tabId, address);
    lastResult = result;
    if (result.foundFrame || !waitForFrame || Date.now() - startedAt >= STRIPE_ADDRESS_FRAME_WAIT_MS) {
      break;
    }
    await delay(STRIPE_ADDRESS_FRAME_WAIT_INTERVAL_MS);
  }

  return lastResult || { ok: true, foundFrame: false, filled: 0, message: '未检测到 Stripe 地址子框架' };
}

async function fillStripeAddressFramesOnce(tabId: number, address: AddressProfile): Promise<StripeAddressFrameFillResult> {
  let results: Array<{ result?: StripeAddressFrameFillResult }>;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [address],
      func: fillStripeAddressFrame,
    });
  } catch (error) {
    return {
      ok: false,
      foundFrame: true,
      filled: 0,
      canRetry: true,
      message: `Stripe 地址子框架注入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const frameResults = results
    .map((item) => item.result)
    .filter((item): item is StripeAddressFrameFillResult => Boolean(item?.foundFrame));
  if (frameResults.length === 0) {
    return { ok: true, foundFrame: false, filled: 0, message: '未检测到 Stripe 地址子框架' };
  }

  const filledResult = frameResults.find((item) => item.ok && item.filled > 0);
  if (filledResult) {
    return filledResult;
  }

  const failed = frameResults.find((item) => !item.ok) || frameResults[0];
  return {
    ok: false,
    foundFrame: true,
    filled: failed.filled || 0,
    canRetry: failed.canRetry !== false,
    message: failed.message || 'Stripe 地址子框架存在，但没有填入地址字段',
    frameUrl: failed.frameUrl,
  };
}

function fillStripeAddressFrame(address: AddressProfile): StripeAddressFrameFillResult {
  const frameUrl = location.href;
  if (location.hostname !== 'js.stripe.com' || !location.pathname.includes('elements-inner-address')) {
    return { ok: true, foundFrame: false, filled: 0, message: '当前不是 Stripe 地址子框架', frameUrl };
  }
  const japanPrefectureValueByKey: Record<string, string> = {
    hokkaido: 'Hokkaido',
    aomori: 'Aomori',
    iwate: 'Iwate',
    miyagi: 'Miyagi',
    akita: 'Akita',
    yamagata: 'Yamagata',
    fukushima: 'Fukushima',
    ibaraki: 'Ibaraki',
    tochigi: 'Tochigi',
    gunma: 'Gunma',
    saitama: 'Saitama',
    chiba: 'Chiba',
    tokyo: 'Tokyo',
    kanagawa: 'Kanagawa',
    niigata: 'Niigata',
    toyama: 'Toyama',
    ishikawa: 'Ishikawa',
    fukui: 'Fukui',
    yamanashi: 'Yamanashi',
    nagano: 'Nagano',
    gifu: 'Gifu',
    shizuoka: 'Shizuoka',
    aichi: 'Aichi',
    mie: 'Mie',
    shiga: 'Shiga',
    kyoto: 'Kyoto',
    osaka: 'Osaka',
    hyogo: 'Hyogo',
    nara: 'Nara',
    wakayama: 'Wakayama',
    tottori: 'Tottori',
    shimane: 'Shimane',
    okayama: 'Okayama',
    hiroshima: 'Hiroshima',
    yamaguchi: 'Yamaguchi',
    tokushima: 'Tokushima',
    kagawa: 'Kagawa',
    ehime: 'Ehime',
    kochi: 'Kochi',
    fukuoka: 'Fukuoka',
    saga: 'Saga',
    nagasaki: 'Nagasaki',
    kumamoto: 'Kumamoto',
    oita: 'Oita',
    miyazaki: 'Miyazaki',
    kagoshima: 'Kagoshima',
    okinawa: 'Okinawa',
  };
  const japanPrefectureLabelByValue: Record<string, string> = {
    Hokkaido: '北海道',
    Aomori: '青森県',
    Iwate: '岩手県',
    Miyagi: '宮城県',
    Akita: '秋田県',
    Yamagata: '山形県',
    Fukushima: '福島県',
    Ibaraki: '茨城県',
    Tochigi: '栃木県',
    Gunma: '群馬県',
    Saitama: '埼玉県',
    Chiba: '千葉県',
    Tokyo: '東京都',
    Kanagawa: '神奈川県',
    Niigata: '新潟県',
    Toyama: '富山県',
    Ishikawa: '石川県',
    Fukui: '福井県',
    Yamanashi: '山梨県',
    Nagano: '長野県',
    Gifu: '岐阜県',
    Shizuoka: '静岡県',
    Aichi: '愛知県',
    Mie: '三重県',
    Shiga: '滋賀県',
    Kyoto: '京都府',
    Osaka: '大阪府',
    Hyogo: '兵庫県',
    Nara: '奈良県',
    Wakayama: '和歌山県',
    Tottori: '鳥取県',
    Shimane: '島根県',
    Okayama: '岡山県',
    Hiroshima: '広島県',
    Yamaguchi: '山口県',
    Tokushima: '徳島県',
    Kagawa: '香川県',
    Ehime: '愛媛県',
    Kochi: '高知県',
    Fukuoka: '福岡県',
    Saga: '佐賀県',
    Nagasaki: '長崎県',
    Kumamoto: '熊本県',
    Oita: '大分県',
    Miyazaki: '宮崎県',
    Kagoshima: '鹿児島県',
    Okinawa: '沖縄県',
  };
  const japanCityPrefectureValueByKey: Record<string, string> = {
    sapporo: 'Hokkaido',
    sendai: 'Miyagi',
    saitama: 'Saitama',
    chiba: 'Chiba',
    tokyo: 'Tokyo',
    yokohama: 'Kanagawa',
    kawasaki: 'Kanagawa',
    niigata: 'Niigata',
    shizuoka: 'Shizuoka',
    nagoya: 'Aichi',
    kyoto: 'Kyoto',
    osaka: 'Osaka',
    kobe: 'Hyogo',
    hiroshima: 'Hiroshima',
    fukuoka: 'Fukuoka',
    kumamoto: 'Kumamoto',
    naha: 'Okinawa',
  };

  const isVisible = (element: Element): boolean => {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);
    const rect = htmlElement.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const normalizedText = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizeJapanKey = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, '');
  const resolveAdministrativeArea = (): { value: string; labels: string[] } => {
    if (address.countryCode !== 'JP') {
      return { value: address.state, labels: [address.stateFull, address.state] };
    }
    const rawValues = [address.state, address.stateFull, address.city].map((value) => String(value || '').trim()).filter(Boolean);
    const directJapanese = rawValues.find((value) => /[都道府県]$/.test(value));
    const key = rawValues.map(normalizeJapanKey).find((item) => japanPrefectureValueByKey[item] || japanCityPrefectureValueByKey[item]);
    const value = key ? japanPrefectureValueByKey[key] || japanCityPrefectureValueByKey[key] : 'Tokyo';
    const label = japanPrefectureLabelByValue[value] || directJapanese || '東京都';
    return { value, labels: [value, label, directJapanese || '', address.stateFull, address.state, address.city] };
  };
  const emitChange = (element: HTMLElement): void => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const setNativeValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string): boolean => {
    if (!value || !isVisible(input) || input.disabled || input.readOnly || input.value === value) {
      return false;
    }
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    emitChange(input);
    return true;
  };
  const setSelectOption = (select: HTMLSelectElement, preferredValue: string, preferredLabels: string[]): boolean => {
    if (!isVisible(select) || select.disabled) {
      return false;
    }
    const normalizedPreferred = normalizedText(preferredValue);
    const labels = preferredLabels.map(normalizedText).filter(Boolean);
    const option = Array.from(select.options)
      .filter((item) => !item.disabled && item.value)
      .find((item) => normalizedText(item.value) === normalizedPreferred) ||
      Array.from(select.options)
        .filter((item) => !item.disabled && item.value)
        .find((item) => labels.some((label) => normalizedText(`${item.text} ${item.value}`).includes(label)));
    if (!option || select.value === option.value) {
      return false;
    }
    select.value = option.value;
    emitChange(select);
    return true;
  };
  const fieldText = (element: Element): string => normalizedText([
    element.getAttribute('id'),
    element.getAttribute('name'),
    element.getAttribute('autocomplete'),
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.closest('label')?.textContent,
    element.parentElement?.querySelector('label')?.textContent,
  ].join(' '));
  const textControls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
  const selectControls = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
  const fillText = (needles: string[], value: string): number => {
    const input = textControls.find((item) => {
      const text = fieldText(item);
      return needles.some((needle) => text.includes(needle));
    });
    return input && setNativeValue(input, value) ? 1 : 0;
  };
  const fillSelect = (needles: string[], value: string, labels: string[]): number => {
    const select = selectControls.find((item) => {
      const text = fieldText(item);
      return needles.some((needle) => text.includes(needle));
    });
    return select && setSelectOption(select, value, labels) ? 1 : 0;
  };

  let filled = 0;
  const administrativeArea = resolveAdministrativeArea();
  filled += fillText(['name', '姓名', '名称'], address.fullName);
  filled += fillSelect(['country', '国家', '地区'], address.countryCode, [address.countryLabel, address.countryCode]);
  filled += fillText(['address line 1', 'address-line1', 'line1', 'address1', '地址行 1', '地址 1', '地址'], address.line1);
  filled += fillText(['address line 2', 'address-line2', 'line2', 'address2', '地址行 2', '地址 2', '公寓'], address.line2);
  filled += fillText(['city', 'locality', 'address-level2', '城市', '市区町村'], address.city);
  filled += fillText(['postal', 'zip', 'postal-code', '邮政编码', '邮编'], address.postalCode);
  filled += fillSelect(['state', 'province', 'region', 'administrative', 'administrativearea', 'address-level1', '州', '省', '都道府県'], administrativeArea.value, administrativeArea.labels);
  filled += fillText(['state', 'province', 'region', 'administrative', 'administrativearea', 'address-level1', '州', '省', '都道府県'], administrativeArea.value);
  filled += fillText(['phone', 'tel', '电话', '手機', '携帯'], address.phone);

  const existingValues = textControls.map((item) => normalizedText(item.value)).filter(Boolean);
  const selectedValues = selectControls.map((item) => normalizedText(item.value)).filter(Boolean);
  const expected = [address.fullName, address.line1, address.city, address.postalCode].map(normalizedText).filter(Boolean);
  const matched = expected.filter((value) => existingValues.includes(value)).length;
  const hasAdministrativeArea = !selectControls.some((item) => fieldText(item).includes('administrative') || fieldText(item).includes('address-level1')) ||
    selectedValues.includes(normalizedText(administrativeArea.value));
  if ((filled > 0 || matched >= Math.min(3, expected.length)) && hasAdministrativeArea) {
    return {
      ok: true,
      foundFrame: true,
      filled,
      message: filled > 0 ? `已填写 Stripe 地址子框架 ${filled} 项` : 'Stripe 地址子框架已存在当前地址',
      frameUrl,
    };
  }

  return {
    ok: false,
    foundFrame: true,
    filled,
    canRetry: true,
    message: hasAdministrativeArea
      ? `Stripe 地址子框架已加载，但未匹配到可填写字段（input=${textControls.length}, select=${selectControls.length}）`
      : `Stripe 地址子框架行政区未填写，等待重试（需要 ${administrativeArea.value}）`,
    frameUrl,
  };
}

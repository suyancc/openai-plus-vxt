import { getBrowserTab, isContentScriptUrl, sendActiveTabMessage, sendTabMessage } from '../../app/active-tab';
import { PAGE_ACTION } from '../../app/page-actions';
import type { ActionResult } from '../../app/types';
import { loadAddressAutofillSettings, saveAddressAutofillSettings } from '../settings/state';
import { fillPayOpenAiAddressNow } from './pay-openai-autofill';
import { fillPaypalAddressNow } from './paypal-autofill';
import type { AddressProfile, RandomAddressResponse } from './types';

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
    const message = {
      type: PAGE_ACTION.openAiSubmitCheckout,
      address,
    };
    return tabId ? sendTabMessage<ActionResult>(message, tabId) : sendActiveTabMessage<ActionResult>(message);
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

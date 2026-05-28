import { canUseExtensionApi } from '../src/app/extension-context';
import { PAGE_ACTION, isFillCurrentPaymentAddressAction, isOAuthFillPhoneAction, isOAuthFillPhoneCodeAction, isOpenAiSubmitCheckoutAction } from '../src/app/page-actions';
import { initPayOpenAiAddressAutofill } from '../src/features/address-autofill/pay-openai-autofill';
import { initPaypalAutofill } from '../src/features/address-autofill/paypal-autofill';
import { createRegisterController } from '../src/features/register/controller';
import { getEmailDebugState } from '../src/features/register/chatgpt-auth-page';
import { checkRegisterPageReady, type RegisterReadyKind } from '../src/features/register/page-ready';
import type { ActionResult } from '../src/app/types';
import type { AddressProfile } from '../src/features/address-autofill/types';
import {
  checkPayOpenAiCheckoutReady,
  fillPayOpenAiAddressNow,
  submitOpenAiCheckoutNow,
} from '../src/features/address-autofill/pay-openai-autofill';
import {
  checkPaypalCheckoutReady,
  clickPaypalBillingConsentNow,
  fillPaypalAddressNow,
  fillPaypalCheckoutEmailNow,
  fillPaypalSmsCodeNow,
  openPaypalAccountEntryNow,
  resendPaypalSmsCodeIfNeededNow,
} from '../src/features/address-autofill/paypal-autofill';
import {
  chooseOAuthExistingAccount,
  continueOAuthConsent,
  fillOAuthPhoneAndContinue,
  fillOAuthPhoneCodeAndContinue,
  getOAuthPhoneChannelSupport,
  inspectOAuthPhonePageState,
  initOAuthPhoneCountrySearch,
} from '../src/features/oauth/openai-phone-page';

const CONTENT_AUTOFILL_LOADED_KEY = '__opx_assistant_content_autofill_loaded__';
const CONTENT_ACTION_BRIDGE_KEY = '__opx_assistant_action_bridge_installed__';
const CONTENT_ACTION_BRIDGE_VERSION = '2026-05-22-action-bridge-v3';

export default defineContentScript({
  matches: [
    'https://chatgpt.com/*',
    'https://auth.openai.com/*',
    'https://pay.openai.com/*',
    'https://www.paypal.com/*',
    'https://paypal.com/*',
    'http://localhost:1455/*',
    'http://127.0.0.1:1455/*',
  ],
  runAt: 'document_idle',
  registration: 'runtime',
  main() {
    if (!canUseExtensionApi()) {
      return;
    }

    installContentActionBridge();
    const scope = globalThis as unknown as Partial<Record<typeof CONTENT_AUTOFILL_LOADED_KEY, boolean>>;
    if (scope[CONTENT_AUTOFILL_LOADED_KEY]) {
      return;
    }
    scope[CONTENT_AUTOFILL_LOADED_KEY] = true;

    try {
      initPayOpenAiAddressAutofill();
    } catch (error) {
      console.warn('[OPX] pay autofill init failed', error);
    }
    try {
      initPaypalAutofill();
    } catch (error) {
      console.warn('[OPX] PayPal autofill init failed', error);
    }
    try {
      initOAuthPhoneCountrySearch();
    } catch (error) {
      console.warn('[OPX] OAuth phone country search init failed', error);
    }
  },
});

function installContentActionBridge(): void {
  const scope = globalThis as unknown as Partial<Record<typeof CONTENT_ACTION_BRIDGE_KEY, string>>;
  if (scope[CONTENT_ACTION_BRIDGE_KEY] === CONTENT_ACTION_BRIDGE_VERSION) {
    return;
  }
  scope[CONTENT_ACTION_BRIDGE_KEY] = CONTENT_ACTION_BRIDGE_VERSION;

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isRecord(message)) {
      return undefined;
    }
    return handleContentActionMessage(message);
  });
}

async function handleContentActionMessage(message: Record<string, unknown>): Promise<ActionResult | undefined> {
  if (message.type === PAGE_ACTION.registerFillEmail) {
    return createRegisterController().fillEmailFromInput();
  }
  if (message.type === PAGE_ACTION.registerFillOtp) {
    return createRegisterController().fillOtp(String(message.code || ''));
  }
  if (message.type === PAGE_ACTION.registerFillProfile) {
    return createRegisterController().fillProfileAndCreate();
  }
  if (message.type === PAGE_ACTION.registerCheckReady || message.type === 'opx:register-check-ready') {
    return checkRegisterPageReady(String(message.kind || 'email') as RegisterReadyKind);
  }
  if (message.type === PAGE_ACTION.registerDebugState || message.type === 'opx:register-debug-state') {
    return getEmailDebugState(String(message.expectedEmail || ''));
  }
  if (isFillCurrentPaymentAddressAction(message)) {
    return fillCurrentPaymentAddress(message.address);
  }
  if (message.type === PAGE_ACTION.paymentCheckReady) {
    return checkPaymentReady(String(message.kind || 'paypal-profile'));
  }
  if (isOpenAiSubmitCheckoutAction(message)) {
    return submitOpenAiCheckoutNow(message.address);
  }
  if (message.type === PAGE_ACTION.paypalOpenAccount) {
    return openPaypalAccountEntryNow();
  }
  if (message.type === PAGE_ACTION.paypalFillEmail) {
    return fillPaypalCheckoutEmailNow();
  }
  if (message.type === PAGE_ACTION.paypalClickBillingConsent) {
    return clickPaypalBillingConsentNow();
  }
  if (message.type === PAGE_ACTION.paypalFillSmsCode) {
    return fillPaypalSmsCodeNow();
  }
  if (message.type === PAGE_ACTION.paypalResendSmsCode) {
    return resendPaypalSmsCodeIfNeededNow();
  }
  if (message.type === PAGE_ACTION.oauthChooseAccount) {
    return chooseOAuthExistingAccount();
  }
  if (isOAuthFillPhoneAction(message)) {
    return fillOAuthPhoneAndContinue({
      countryIso: message.countryIso,
      phoneNumber: message.phoneNumber,
    });
  }
  if (isOAuthFillPhoneCodeAction(message)) {
    return fillOAuthPhoneCodeAndContinue(message.code);
  }
  if (message.type === PAGE_ACTION.oauthContinueConsent) {
    return continueOAuthConsent();
  }
  if (message.type === PAGE_ACTION.oauthPhoneChannelSupport) {
    return getOAuthPhoneChannelSupport();
  }
  if (message.type === PAGE_ACTION.oauthPhonePageState) {
    return inspectOAuthPhonePageState();
  }
  return undefined;
}

async function fillCurrentPaymentAddress(address: AddressProfile): Promise<ActionResult> {
  if (location.hostname === 'pay.openai.com') {
    return fillPayOpenAiAddressNow(address);
  }
  if (location.hostname.endsWith('paypal.com')) {
    return fillPaypalAddressNow(address, true, false);
  }
  return { ok: false, message: '当前页面不是支持填写的支付页' };
}

function checkPaymentReady(kind: string): ActionResult {
  if (kind === 'openai-checkout') {
    return checkPayOpenAiCheckoutReady();
  }
  if (kind === 'paypal-account-entry' || kind === 'paypal-email' || kind === 'paypal-profile') {
    return checkPaypalCheckoutReady(kind);
  }
  if (kind === 'paypal-page-error') {
    return checkPaypalCheckoutReady(kind);
  }
  return { ok: false, message: '未知支付页面状态检查类型' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

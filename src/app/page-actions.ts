import type { AddressProfile } from '../features/address-autofill/types';

export const PAGE_ACTION = {
  registerFillEmail: 'opx:register-fill-email',
  registerFillOtp: 'opx:register-fill-otp',
  registerFillProfile: 'opx:register-fill-profile',
  registerCheckReady: 'opx:register-check-ready',
  registerDebugState: 'opx:register-debug-state',
  fillCurrentPaymentAddress: 'opx:fill-current-payment-address',
  paymentCheckReady: 'opx:payment-check-ready',
  openAiSubmitCheckout: 'opx:openai-submit-checkout',
  paypalOpenAccount: 'opx:paypal-open-account',
  paypalFillEmail: 'opx:paypal-fill-email',
  paypalClickBillingConsent: 'opx:paypal-click-billing-consent',
  paypalFillSmsCode: 'opx:paypal-fill-sms-code',
  paypalResendSmsCode: 'opx:paypal-resend-sms-code',
  oauthChooseAccount: 'opx:oauth-choose-account',
  oauthFillPhone: 'opx:oauth-fill-phone',
  oauthFillPhoneCode: 'opx:oauth-fill-phone-code',
  oauthContinueConsent: 'opx:oauth-continue-consent',
  oauthPhoneChannelSupport: 'opx:oauth-phone-channel-support',
  oauthPhonePageState: 'opx:oauth-phone-page-state',
} as const;

export interface RegisterFillEmailAction {
  type: typeof PAGE_ACTION.registerFillEmail;
}

export interface RegisterFillOtpAction {
  type: typeof PAGE_ACTION.registerFillOtp;
  code: string;
}

export interface RegisterFillProfileAction {
  type: typeof PAGE_ACTION.registerFillProfile;
}

export interface RegisterCheckReadyAction {
  type: typeof PAGE_ACTION.registerCheckReady;
  kind: 'email' | 'otp' | 'profile';
}

export interface RegisterDebugStateAction {
  type: typeof PAGE_ACTION.registerDebugState;
  expectedEmail?: string;
}

export interface FillCurrentPaymentAddressAction {
  type: typeof PAGE_ACTION.fillCurrentPaymentAddress;
  address: AddressProfile;
}

export interface PaymentCheckReadyAction {
  type: typeof PAGE_ACTION.paymentCheckReady;
  kind: 'openai-checkout' | 'paypal-account-entry' | 'paypal-email' | 'paypal-profile' | 'paypal-page-error';
}

export interface OpenAiSubmitCheckoutAction {
  type: typeof PAGE_ACTION.openAiSubmitCheckout;
  address: AddressProfile;
}

export interface PaypalOpenAccountAction {
  type: typeof PAGE_ACTION.paypalOpenAccount;
}

export interface PaypalFillEmailAction {
  type: typeof PAGE_ACTION.paypalFillEmail;
}

export interface PaypalClickBillingConsentAction {
  type: typeof PAGE_ACTION.paypalClickBillingConsent;
}

export interface PaypalFillSmsCodeAction {
  type: typeof PAGE_ACTION.paypalFillSmsCode;
}

export interface PaypalResendSmsCodeAction {
  type: typeof PAGE_ACTION.paypalResendSmsCode;
}

export interface OAuthChooseAccountAction {
  type: typeof PAGE_ACTION.oauthChooseAccount;
}

export interface OAuthFillPhoneAction {
  type: typeof PAGE_ACTION.oauthFillPhone;
  countryIso: string;
  phoneNumber: string;
}

export interface OAuthFillPhoneCodeAction {
  type: typeof PAGE_ACTION.oauthFillPhoneCode;
  code: string;
}

export interface OAuthContinueConsentAction {
  type: typeof PAGE_ACTION.oauthContinueConsent;
}

export interface OAuthPhoneChannelSupportAction {
  type: typeof PAGE_ACTION.oauthPhoneChannelSupport;
}

export interface OAuthPhonePageStateAction {
  type: typeof PAGE_ACTION.oauthPhonePageState;
}

export type PageActionMessage =
  | RegisterFillEmailAction
  | RegisterFillOtpAction
  | RegisterFillProfileAction
  | RegisterCheckReadyAction
  | RegisterDebugStateAction
  | FillCurrentPaymentAddressAction
  | PaymentCheckReadyAction
  | OpenAiSubmitCheckoutAction
  | PaypalOpenAccountAction
  | PaypalFillEmailAction
  | PaypalClickBillingConsentAction
  | PaypalFillSmsCodeAction
  | PaypalResendSmsCodeAction
  | OAuthChooseAccountAction
  | OAuthFillPhoneAction
  | OAuthFillPhoneCodeAction
  | OAuthContinueConsentAction
  | OAuthPhoneChannelSupportAction
  | OAuthPhonePageStateAction;

export function isOAuthFillPhoneAction(message: unknown): message is OAuthFillPhoneAction {
  return Boolean(
    isRecord(message) &&
      message.type === PAGE_ACTION.oauthFillPhone &&
      typeof message.countryIso === 'string' &&
      typeof message.phoneNumber === 'string',
  );
}

export function isOAuthFillPhoneCodeAction(message: unknown): message is OAuthFillPhoneCodeAction {
  return Boolean(
    isRecord(message) &&
      message.type === PAGE_ACTION.oauthFillPhoneCode &&
      typeof message.code === 'string',
  );
}

export function isFillCurrentPaymentAddressAction(message: unknown): message is FillCurrentPaymentAddressAction {
  return Boolean(
    isRecord(message) &&
      message.type === PAGE_ACTION.fillCurrentPaymentAddress &&
      isAddressProfile(message.address),
  );
}

export function isOpenAiSubmitCheckoutAction(message: unknown): message is OpenAiSubmitCheckoutAction {
  return Boolean(
    isRecord(message) &&
      message.type === PAGE_ACTION.openAiSubmitCheckout &&
      isAddressProfile(message.address),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isAddressProfile(value: unknown): value is AddressProfile {
  return Boolean(
    isRecord(value) &&
      typeof value.line1 === 'string' &&
      typeof value.city === 'string' &&
      typeof value.state === 'string' &&
      typeof value.postalCode === 'string' &&
      typeof value.countryCode === 'string',
  );
}

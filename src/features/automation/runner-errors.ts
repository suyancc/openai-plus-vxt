import type { ActionResult } from '../../app/types';
import type { AutomationStepId } from './types';
import { isRecord } from './runner-format';

export interface PaymentProfileResult extends ActionResult {
  canRetry?: boolean;
  submitted?: boolean;
  requiresSubmit?: boolean;
  paymentError?: string;
  phoneNumberRejected?: boolean;
  countryChanged?: boolean;
  filled?: number;
}

const PAYMENT_PROFILE_STEP: AutomationStepId = 'fill-payment-profile';

export function isTransientContentScriptResult(result: ActionResult): boolean {
  const message = result.message.toLowerCase();
  return message.includes('could not establish connection') ||
    message.includes('receiving end does not exist') ||
    message.includes('message channel closed') ||
    message.includes('message port closed') ||
    message.includes('asynchronous response') ||
    message.includes('before a response was received') ||
    message.includes('extension context invalidated');
}

export function isRetryablePaypalProfileFailure(result: ActionResult): boolean {
  if (isPaypalAccountLimitedFailure('wait-payment-sms', result)) {
    return false;
  }
  if (isRecord(result.data) && result.data.canRetry === true) {
    return true;
  }
  const message = resultText(result);
  return message.includes('cclinked') ||
    message.includes('already been added') ||
    message.includes('another paypal account') ||
    message.includes('资料不可用') ||
    message.includes('try a different') ||
    message.includes('different way to pay') ||
    message.includes('unsupported characters') ||
    message.includes('unsupported character') ||
    message.includes('first name') ||
    message.includes('last name');
}

export function isRetryableOpenAiCheckoutAddressFailure(result: ActionResult): boolean {
  const payment = result as PaymentProfileResult;
  if (payment.canRetry === true) {
    return true;
  }
  if (isRecord(result.data) && result.data.canRetry === true) {
    return true;
  }
  const message = `${payment.paymentError || ''} ${result.message}`.toLowerCase();
  return message.includes('could not calculate tax') ||
    message.includes('calculate tax') ||
    message.includes('invalid zip') ||
    message.includes('invalid postal') ||
    message.includes('zip code') ||
    message.includes('postal code');
}

export function accountUnavailableFailureLabel(stepId: AutomationStepId, result: ActionResult): string {
  if (isOutlookMailboxUnavailableFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isOpenAiAuthAccountUnavailableFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isProfileSubmitUnavailableFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isOpenAiCheckoutPaypalUnavailableFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isOpenAiCheckoutSubmitUnavailableFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isCheckoutTrialUnavailableFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isChatGptCheckoutOrganizationRequiredFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isOpenAiCheckoutNonZeroAmountFailure(stepId, result)) {
    return '邮箱不可用';
  }
  if (isPaypalAccountLimitedFailure(stepId, result)) {
    return 'PayPal 账号不可用';
  }
  return '';
}

function isOutlookMailboxUnavailableFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'wait-register-email-code' && stepId !== 'wait-oauth-email-code') {
    return false;
  }
  const text = result.message.toLowerCase();
  if (!text.includes('outlook api')) {
    return false;
  }
  return text.includes('mailbox fetch failed') ||
    text.includes('token refresh request failed') ||
    text.includes('login.microsoftonline.com') ||
    text.includes('ssleoferror') ||
    text.includes('unexpected_eof') ||
    text.includes('invalid_grant') ||
    text.includes('refresh token') ||
    text.includes('invalid token') ||
    text.includes('unauthorized');
}

export function isOpenAiAuthAccountUnavailableFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'wait-register-email-code' && stepId !== 'wait-oauth-email-code') {
    return false;
  }
  if (isRecord(result.data) && result.data.accountDeactivated === true) {
    return true;
  }
  const text = resultText(result);
  return text.includes('account_deactivated') ||
    text.includes('账户已被删除或停用') ||
    text.includes('account has been deleted or deactivated') ||
    text.includes('account deleted or deactivated');
}

function isProfileSubmitUnavailableFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'fill-profile') {
    return false;
  }
  if (isRecord(result.data) && result.data.retryableAboutYouError === true) {
    return true;
  }
  return isRetryableAboutYouTimeout(result);
}

function isOpenAiCheckoutPaypalUnavailableFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'open-checkout-link' && stepId !== 'submit-openai-checkout') {
    return false;
  }
  if (isRecord(result.data) && result.data.paypalUnavailable === true) {
    return true;
  }
  const text = resultText(result);
  return text.includes('没有 paypal 支付选项') ||
    text.includes('no paypal payment option') ||
    text.includes('paypal unavailable');
}

function isOpenAiCheckoutSubmitUnavailableFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'submit-openai-checkout') {
    return false;
  }
  const text = resultText(result);
  return text.includes('出错了，请重试') ||
    text.includes('付款未获批准') ||
    text.includes('something went wrong') ||
    text.includes('please try again');
}

function isCheckoutTrialUnavailableFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'create-checkout-link') {
    return false;
  }
  const text = resultText(result);
  return text.includes('没有试用资格') ||
    text.includes('no trial') ||
    text.includes('not eligible') ||
    text.includes('ineligible') ||
    text.includes('trial unavailable');
}

function isChatGptCheckoutOrganizationRequiredFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'create-checkout-link') {
    return false;
  }
  const text = resultText(result);
  return (text.includes('chatgpt checkout http 401') || text.includes('http 401')) &&
    text.includes('must be a member of an organization');
}

function isOpenAiCheckoutNonZeroAmountFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'open-checkout-link' && stepId !== 'submit-openai-checkout') {
    return false;
  }
  const text = resultText(result);
  return text.includes('当前应付金额不是 0') ||
    (text.includes('应付金额') && text.includes('不是 0')) ||
    text.includes('current amount is not 0') ||
    text.includes('amount is not 0') ||
    text.includes('amount is not zero') ||
    text.includes('non-zero amount');
}

export function isPaypalAccountLimitedFailure(stepId: AutomationStepId, result: ActionResult): boolean {
  if (stepId !== 'wait-payment-sms') {
    return false;
  }
  const text = resultText(result);
  return text.includes('your account is limited') ||
    (text.includes('paypal account overview') && text.includes('resolve this problem')) ||
    text.includes('restricted_user') ||
    text.includes('ukvtvfjjq1rfrf9vu0vs') ||
    text.includes('账号不可用');
}

export function isSmsCodeInvalidResult(result: ActionResult | null): result is ActionResult {
  if (!result) {
    return false;
  }
  if (isRecord(result.data)) {
    if (result.data.smsCodeInvalid === true) {
      return true;
    }
    if (result.data.smsCodeInvalid === false) {
      return false;
    }
  }
  const message = result.message.toLowerCase();
  if (message.includes('未发现') && message.includes('验证码不可用')) {
    return false;
  }
  return message.includes('get a new code') ||
    message.includes('验证码不可用') ||
    message.includes('验证码无效');
}

export function isSmsCodeInvalidResent(result: ActionResult): boolean {
  return isSmsCodeInvalidResult(result) &&
    isRecord(result.data) &&
    result.data.resent === true;
}

export function isEmailOtpIncorrectResult(result: ActionResult | null): result is ActionResult {
  if (!result) {
    return false;
  }
  if (isRecord(result.data) && result.data.emailOtpIncorrect === true) {
    return true;
  }
  const message = resultText(result);
  return message.includes('邮箱验证码不正确') ||
    message.includes('代码不正确') ||
    message.includes('验证码不正确') ||
    message.includes('incorrect code') ||
    message.includes('invalid code') ||
    message.includes('wrong code');
}

export function isPaymentProfileComplete(result: ActionResult): boolean {
  const payment = result as PaymentProfileResult;
  if (!result.ok) {
    return false;
  }
  if (payment.countryChanged === true) {
    return false;
  }
  if (payment.submitted === false) {
    return false;
  }
  if ('filled' in payment && Number(payment.filled || 0) <= 0) {
    return false;
  }
  if (payment.requiresSubmit === true && payment.submitted !== true) {
    return false;
  }
  return true;
}

export function shouldRetryPaymentProfile(result: ActionResult): boolean {
  const payment = result as PaymentProfileResult;
  if (isPhoneNumberRejectedFailure(result)) {
    return false;
  }
  if (payment.canRetry) {
    return true;
  }
  const message = result.message.toLowerCase();
  return payment.countryChanged === true ||
    payment.submitted === false ||
    message.includes('等待页面重新加载') ||
    message.includes('agree & create account') ||
    message.includes('按钮暂不可点击') ||
    message.includes('尚未渲染') ||
    message.includes('未找到可填写') ||
    message.includes('尚未完全可点击') ||
    message.includes('invalid zip') ||
    message.includes('invalid postal') ||
    message.includes('invalidaddress') ||
    message.includes('check the address you entered');
}

export function shouldRefreshPaymentAddress(result: ActionResult): boolean {
  const payment = result as PaymentProfileResult;
  const message = `${payment.paymentError || ''} ${result.message}`.toLowerCase();
  return message.includes('invalid zip') ||
    message.includes('invalid postal') ||
    message.includes('invalidaddress') ||
    message.includes('check the address you entered') ||
    message.includes('zip code') ||
    message.includes('postal code') ||
    message.includes('表单字段错误') ||
    message.includes('valid card') ||
    message.includes('card number') ||
    message.includes('expiration') ||
    message.includes('security code') ||
    message.includes('cvv') ||
    message.includes('required') ||
    message.includes('invalid') ||
    message.includes('unsupported characters') ||
    message.includes('unsupported character') ||
    message.includes('first name') ||
    message.includes('last name') ||
    message.includes('卡号') ||
    message.includes('安全码') ||
    message.includes('必填') ||
    message.includes('无效');
}

export function isPhoneNumberRejectedFailure(result: ActionResult): boolean {
  const payment = result as PaymentProfileResult;
  if (payment.phoneNumberRejected === true) {
    return true;
  }
  if (isRecord(result.data) && result.data.phoneNumberRejected === true) {
    return true;
  }
  const text = `${payment.paymentError || ''} ${result.message}`.toLowerCase();
  return text.includes('try a different phone number') ||
    (text.includes('unable to complete your request') && text.includes('phone number')) ||
    text.includes('虚拟号码') ||
    text.includes('虚拟电话号码') ||
    text.includes('非虚拟电话号码') ||
    text.includes('voip') ||
    text.includes('virtual phone') ||
    text.includes('virtual number') ||
    text.includes('non-virtual phone number') ||
    text.includes("couldn't send a text message to this phone number") ||
    text.includes('could not send a text message to this phone number') ||
    text.includes('switched to whatsapp') ||
    text.includes('continue to send a verification code on whatsapp') ||
    text.includes('手机号不可用') ||
    text.includes('更换手机号');
}

export function resultText(result: ActionResult): string {
  const parts = [result.message || ''];
  const payment = result as PaymentProfileResult;
  if (typeof payment.paymentError === 'string') {
    parts.push(payment.paymentError);
  }
  if (isRecord(result.data)) {
    for (const key of ['paymentError', 'url', 'pageKind', 'redirectStatus']) {
      const value = result.data[key];
      if (typeof value === 'string') {
        parts.push(value);
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

export function isRetryableAboutYouTimeout(result: ActionResult): boolean {
  if (isRecord(result.data) && result.data.retryableAboutYouError === true) {
    return true;
  }
  const text = result.message.toLowerCase();
  return text.includes('operation timed out') ||
    (text.includes('资料页错误') && (text.includes('timed out') || text.includes('timeout'))) ||
    (text.includes('糟糕') && (text.includes('timed out') || text.includes('timeout')));
}

export function isRetryableAboutYouReadyFailure(result: ActionResult): boolean {
  if (isRetryableAboutYouTimeout(result)) {
    return true;
  }
  if (isRecord(result.data) && result.data.profilePendingRender === true) {
    return true;
  }
  const text = result.message.toLowerCase();
  return text.includes('资料输入框还没有渲染完成') ||
    text.includes('创建账号按钮还没有渲染完成') ||
    text.includes('等待页面控件渲染超时') ||
    text.includes('没有找到全名输入框') ||
    text.includes('没有找到年龄输入框') ||
    text.includes('没有找到生日输入控件') ||
    text.includes('没有找到完成账户创建按钮') ||
    text.includes('完成账户创建按钮仍然不可点击');
}

export function isSmsNumberRejectedStep(stepId: AutomationStepId): boolean {
  return stepId === PAYMENT_PROFILE_STEP || stepId === 'wait-payment-sms';
}

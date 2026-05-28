import type { BrowserTabInfo } from '../../app/active-tab';
import { loadAutomationState } from '../../app/state';
import type { ActionResult } from '../../app/types';
import {
  checkCurrentPaymentPageReady,
  clickCurrentPaypalBillingConsent,
  fillCurrentPaypalSmsCode,
  resendCurrentPaypalSmsCodeIfNeeded,
} from '../address-autofill/service';
import { fetchSmsRelayCode } from '../sms/poller';
import type { SmsRelayTarget } from '../sms/types';
import { appendAutomationLog } from './state';
import {
  currentSmsTarget,
  markSmsCodeReceived,
  markSmsMessage,
} from './runner-state';
import {
  appendSmsHistory,
  loadSeenSmsCodes,
  smsCodeKey,
} from './runner-sms';
import {
  delay,
  isRecord,
  parseUrl,
  shortUrl,
} from './runner-format';
import {
  isPaypalAccountLimitedFailure,
  isPhoneNumberRejectedFailure,
  isRetryablePaypalProfileFailure,
  isSmsCodeInvalidResent,
  isSmsCodeInvalidResult,
  isTransientContentScriptResult,
} from './runner-errors';
import {
  getFailedOpenAiPaymentRedirect,
  isChatGptHomeUrl,
  isChatGptPaymentSuccessUrl,
  paymentCompletionStage,
  paymentCompletionStageLabel,
} from './runner-url';

const SMS_WAIT_TIMEOUT_MS = 180_000;
const SMS_WAIT_INTERVAL_MS = 3_000;
const PAYMENT_COMPLETION_TIMEOUT_MS = 120_000;
const PAYPAL_SMS_INVALID_CHECK_GRACE_MS = 10_000;

interface PaymentSmsContext {
  automationTargetTabId(): Promise<number>;
  ensureAutomationTargetTab(): Promise<BrowserTabInfo>;
  appendAutomationDebugLog(stepId: string, event: string, data?: Record<string, unknown>): Promise<void>;
  isStopRequested(): boolean;
}

export async function waitPaymentSmsStep(context: PaymentSmsContext): Promise<ActionResult> {
  const tabId = await context.automationTargetTabId();
  const state = await loadAutomationState();
  const sms = currentSmsTarget(state);
  if (!sms) {
    return { ok: false, message: '没有当前接码号码，请先执行“选择接码号码”' };
  }

  const target: SmsRelayTarget = {
    id: sms.id,
    phone: sms.phone,
    url: sms.url,
  };
  const seenCodes = await loadSeenSmsCodes(sms.phone);
  const deadline = Date.now() + SMS_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '手机验证码等待已停止' };
    }
    const pageIssue = await waitForPaypalPageErrorAfterSms(100, context);
    if (pageIssue?.ok && isPaypalAccountLimitedFailure('wait-payment-sms', pageIssue)) {
      return {
        ...pageIssue,
        ok: false,
        message: `PayPal 账号不可用：${pageIssue.message}`,
      };
    }
    if (pageIssue?.ok && isPhoneNumberRejectedFailure(pageIssue)) {
      return {
        ...pageIssue,
        ok: false,
        message: pageIssue.message,
      };
    }
    if (pageIssue?.ok && isSmsCodeInvalidResult(pageIssue)) {
      const resendResult = await resendCurrentPaypalSmsCodeIfNeeded(tabId);
      if (!isSmsCodeInvalidResent(resendResult)) {
        return {
          ok: false,
          message: `PayPal 手机验证码不可用，但重新发送失败：${resendResult.message}`,
          data: resendResult.data || pageIssue.data,
        };
      }
      await markSmsMessage(sms.id, 'PayPal 提示验证码不可用，已点击 Resend，等待新验证码');
      await appendAutomationLog('warn', 'PayPal 提示验证码不可用，已重发短信，等待新验证码', 'wait-payment-sms');
      await delay(SMS_WAIT_INTERVAL_MS);
      continue;
    }
    const result = await fetchSmsRelayCode(target);
    if (result.kind === 'code') {
      const codeKey = smsCodeKey(sms.phone, result.code);
      if (seenCodes.has(codeKey)) {
        await markSmsMessage(sms.id, `忽略旧手机验证码：${result.code}`);
        await delay(SMS_WAIT_INTERVAL_MS);
        continue;
      }
      seenCodes.add(codeKey);
      await appendSmsHistory(sms.phone, result.code, result.message);
      await markSmsCodeReceived(sms.id, result.message);
      const fillResult = await fillPaypalSmsCodeWithRetry(12_000, context);
      if (!fillResult.ok) {
        return {
          ok: false,
          message: `已收到手机验证码：${result.code}，但未能填入页面：${fillResult.message}`,
          code: result.code,
          data: fillResult.data,
        };
      }
      const completion = await waitForPaymentCompletionAfterSms(result.code, PAYMENT_COMPLETION_TIMEOUT_MS, context);
      if (isSmsCodeInvalidResent(completion)) {
        await markSmsMessage(sms.id, `验证码 ${result.code} 不可用，已点击 Resend，等待新验证码`);
        await appendAutomationLog('warn', `PayPal 提示验证码不可用，已重发短信，旧码 ${result.code} 将被忽略`, 'wait-payment-sms');
        await delay(SMS_WAIT_INTERVAL_MS);
        continue;
      }
      return {
        ok: completion.ok,
        message: completion.ok
          ? `已收到并填写手机验证码：${result.code}；${completion.message}`
          : `已收到并填写手机验证码：${result.code}，但支付回跳未完成：${completion.message}`,
        code: result.code,
        data: completion.data || fillResult.data,
      };
    }
    if (result.kind === 'error') {
      await markSmsMessage(sms.id, result.message);
      return { ok: false, message: `接码失败：${result.message}` };
    }
    await markSmsMessage(sms.id, result.message);
    await delay(SMS_WAIT_INTERVAL_MS);
  }
  return { ok: false, message: '等待手机验证码超时' };
}

async function waitForPaymentCompletionAfterSms(
  code: string,
  timeoutMs: number,
  context: PaymentSmsContext,
): Promise<ActionResult> {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  let lastStage = '';
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待支付完成回跳已停止' };
    }

    const tab = await context.ensureAutomationTargetTab();
    lastUrl = tab?.url || lastUrl;
    const parsed = parseUrl(tab?.url || '');
    if (parsed) {
      const failedRedirect = getFailedOpenAiPaymentRedirect(parsed);
      if (failedRedirect) {
        return {
          ok: false,
          message: `OpenAI 支付回跳状态异常：${failedRedirect}`,
          data: { url: parsed.href, redirectStatus: failedRedirect },
        };
      }

      const stage = paymentCompletionStage(parsed);
      if (stage && stage !== lastStage) {
        lastStage = stage;
        await appendAutomationLog('info', `${paymentCompletionStageLabel(stage)}：${shortUrl(parsed.href)}`, 'wait-payment-sms');
      }
      if (isChatGptPaymentSuccessUrl(parsed)) {
        return {
          ok: true,
          message: '支付成功，已进入 ChatGPT 支付成功页',
          code,
          data: { url: parsed.href, stage },
        };
      }
      if (isChatGptHomeUrl(parsed)) {
        return {
          ok: true,
          message: '支付成功，已回到 ChatGPT 首页',
          code,
          data: { url: parsed.href, stage },
        };
      }

      if (parsed.hostname.endsWith('paypal.com')) {
        if (tab.status === 'loading') {
          await delay(600);
          continue;
        }
        const consentResult = await clickPaypalBillingConsentIfReady(typeof tab.id === 'number' ? tab.id : undefined);
        if (consentResult.ok) {
          await appendAutomationLog('info', consentResult.message, 'wait-payment-sms');
          await delay(1000);
          continue;
        }
        if (isTransientContentScriptResult(consentResult)) {
          await context.appendAutomationDebugLog('wait-payment-sms', 'paypal-content-script-pending', {
            message: consentResult.message,
            url: parsed.href,
          });
          await delay(600);
          continue;
        }

        const pageIssue = await waitForPaypalPageErrorAfterSms(100, context);
        if (pageIssue?.ok && isPaypalAccountLimitedFailure('wait-payment-sms', pageIssue)) {
          return {
            ok: false,
            message: `PayPal 账号不可用：${pageIssue.message}`,
            code,
            data: pageIssue.data,
          };
        }
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= PAYPAL_SMS_INVALID_CHECK_GRACE_MS) {
          if (pageIssue?.ok && isSmsCodeInvalidResult(pageIssue)) {
            const resendResult = await resendCurrentPaypalSmsCodeIfNeeded(typeof tab.id === 'number' ? tab.id : undefined);
            if (isSmsCodeInvalidResult(resendResult)) {
              return {
                ok: false,
                message: resendResult.ok
                  ? `PayPal 手机验证码不可用，已点击 Resend 等待新验证码：${resendResult.message}`
                  : `PayPal 手机验证码不可用，但重新发送失败：${resendResult.message}`,
                code,
                data: {
                  ...(isRecord(resendResult.data) ? resendResult.data : {}),
                  smsCodeInvalid: true,
                  resent: resendResult.ok,
                },
              };
            }
          }
          if (pageIssue?.ok && isRetryablePaypalProfileFailure(pageIssue)) {
            return {
              ok: false,
              message: `PayPal 返回资料不可用：${pageIssue.message}`,
              code,
              data: pageIssue.data,
            };
          }
        }
      }
    }

    await delay(600);
  }

  return {
    ok: false,
    message: `等待支付完成回跳超时，最后页面：${lastUrl ? shortUrl(lastUrl) : '未知'}`,
    data: { url: lastUrl },
  };
}

async function clickPaypalBillingConsentIfReady(tabId?: number): Promise<ActionResult> {
  try {
    return await clickCurrentPaypalBillingConsent(tabId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForPaypalPageErrorAfterSms(
  timeoutMs: number,
  context: Pick<PaymentSmsContext, 'automationTargetTabId'>,
): Promise<ActionResult | null> {
  const deadline = Date.now() + timeoutMs;
  let last: ActionResult | null = null;
  const tabId = await context.automationTargetTabId();
  while (Date.now() <= deadline) {
    try {
      last = await checkCurrentPaymentPageReady('paypal-page-error', tabId);
      if (last.ok) {
        return last;
      }
    } catch (error) {
      last = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    await delay(500);
  }
  return last?.ok ? last : null;
}

async function fillPaypalSmsCodeWithRetry(
  timeoutMs: number,
  context: Pick<PaymentSmsContext, 'automationTargetTabId' | 'isStopRequested'>,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let last: ActionResult = { ok: false, message: '尚未尝试填写 PayPal 手机验证码' };
  const tabId = await context.automationTargetTabId();
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '填写 PayPal 手机验证码已停止' };
    }
    try {
      last = await fillCurrentPaypalSmsCode(tabId);
    } catch (error) {
      last = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      if (!isTransientContentScriptResult(last)) {
        return last;
      }
    }
    if (last.ok) {
      return last;
    }
    await delay(600);
  }
  return last;
}

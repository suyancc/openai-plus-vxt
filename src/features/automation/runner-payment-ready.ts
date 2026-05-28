import type { BrowserTabInfo } from '../../app/active-tab';
import type { ActionResult } from '../../app/types';
import {
  checkCurrentPaymentPageReady,
  openCurrentPaypalAccountEntry,
} from '../address-autofill/service';
import { appendAutomationLog } from './state';
import {
  delay,
  isRecord,
  summarizeActionData,
} from './runner-format';

const OPENAI_PAYPAL_UNAVAILABLE_MIN_WAIT_MS = 10_000;
const OPENAI_PAYPAL_UNAVAILABLE_STABLE_COUNT = 3;

type PaymentReadyKind = 'openai-checkout' | 'paypal-account-entry' | 'paypal-email' | 'paypal-profile';

interface PaymentReadyContext {
  automationTargetTabId(): Promise<number>;
  getAutomationTargetTab(): Promise<BrowserTabInfo | null>;
  appendAutomationDebugLog(stepId: string, event: string, data?: Record<string, unknown>): Promise<void>;
  isStopRequested(): boolean;
}

export async function waitForPaymentPageReady(
  context: PaymentReadyContext,
  kind: PaymentReadyKind,
  timeoutMs: number,
): Promise<ActionResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let last: ActionResult = { ok: false, message: '尚未检查支付页面状态' };
  const tabId = await context.automationTargetTabId();
  let terminalCandidateCount = 0;

  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待支付页面已停止' };
    }
    last = await checkCurrentPaymentPageReady(kind, tabId);
    if (last.ok) {
      await context.appendAutomationDebugLog('', 'payment-ready', {
        kind,
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: last,
      });
      return last;
    }
    if (isTerminalPaymentReadyFailure(kind, last)) {
      const tab = await context.getAutomationTargetTab();
      const elapsedMs = Date.now() - startedAt;
      const tabComplete = tab?.status === 'complete';
      const stableEnough = tabComplete && elapsedMs >= OPENAI_PAYPAL_UNAVAILABLE_MIN_WAIT_MS;
      terminalCandidateCount = stableEnough ? terminalCandidateCount + 1 : 0;
      await context.appendAutomationDebugLog('', 'payment-ready-terminal-candidate', {
        kind,
        elapsedMs,
        tabStatus: tab?.status || '',
        stableEnough,
        candidateCount: terminalCandidateCount,
        requiredCount: OPENAI_PAYPAL_UNAVAILABLE_STABLE_COUNT,
        result: last,
      });
      if (terminalCandidateCount >= OPENAI_PAYPAL_UNAVAILABLE_STABLE_COUNT) {
        await context.appendAutomationDebugLog('', 'payment-ready-terminal', {
          kind,
          elapsedMs,
          result: last,
        });
        return last;
      }
    } else {
      terminalCandidateCount = 0;
    }
    await delay(500);
  }

  const debug = summarizeActionData(last.data);
  await context.appendAutomationDebugLog('', 'payment-ready-timeout', {
    kind,
    timeoutMs,
    last,
  });
  return {
    ok: false,
    message: debug ? `${last.message}：${debug}` : last.message,
    data: last.data,
  };
}

function isTerminalPaymentReadyFailure(kind: PaymentReadyKind, result: ActionResult): boolean {
  return kind === 'openai-checkout' &&
    isRecord(result.data) &&
    result.data.paypalUnavailable === true;
}

export async function waitForPaypalAfterAccountEntry(
  context: PaymentReadyContext,
  timeoutMs: number,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let last: ActionResult = { ok: false, message: '尚未检查 PayPal 下一页面' };
  const tabId = await context.automationTargetTabId();

  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待 PayPal 页面已停止' };
    }
    last = await checkCurrentPaymentPageReady('paypal-email', tabId);
    if (last.ok) {
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-next-ready', {
        kind: 'paypal-email',
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: last,
      });
      return last;
    }
    last = await checkCurrentPaymentPageReady('paypal-profile', tabId);
    if (last.ok) {
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-next-ready', {
        kind: 'paypal-profile',
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: last,
      });
      return last;
    }
    await delay(500);
  }

  const debug = summarizeActionData(last.data);
  await context.appendAutomationDebugLog('open-paypal-account', 'paypal-next-timeout', {
    timeoutMs,
    last,
  });
  return {
    ok: false,
    message: debug ? `${last.message}：${debug}` : last.message,
    data: last.data,
  };
}

export async function waitForPaypalEmailReadyOrClickEntry(
  context: PaymentReadyContext,
  timeoutMs: number,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let last: ActionResult = { ok: false, message: '尚未检查 PayPal 邮箱页' };
  const tabId = await context.automationTargetTabId();
  let entryClickCount = 0;

  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待 PayPal 邮箱页已停止' };
    }

    last = await checkCurrentPaymentPageReady('paypal-email', tabId);
    if (last.ok) {
      await context.appendAutomationDebugLog('fill-paypal-email', 'paypal-email-ready', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: last,
      });
      return last;
    }

    const data = isRecord(last.data) ? last.data : {};
    if (data.pageKind === 'account-entry' && data.createAccountButtonFound === true) {
      entryClickCount += 1;
      const clickResult = await openCurrentPaypalAccountEntry(tabId);
      await appendAutomationLog(
        clickResult.ok ? 'info' : 'warn',
        `PayPal 仍在创建账户入口页，已尝试点击入口 ${entryClickCount} 次：${clickResult.message}`,
        'fill-paypal-email',
      );
      await delay(1_500);
      continue;
    }

    await delay(500);
  }

  const debug = summarizeActionData(last.data);
  await context.appendAutomationDebugLog('fill-paypal-email', 'paypal-email-ready-timeout', {
    timeoutMs,
    last,
  });
  return {
    ok: false,
    message: debug ? `${last.message}：${debug}` : last.message,
    data: last.data,
  };
}

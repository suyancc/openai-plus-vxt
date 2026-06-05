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
const PAYMENT_READY_CHECK_TIMEOUT_MS = 4_000;
const PAYPAL_ENTRY_DIRECT_PROBE_INTERVAL_MS = 3_000;

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
  let paypalEntrySliderLogged = false;
  let paypalEntryLastProbeAt = 0;
  let readyCheckFailureCount = 0;

  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待支付页面已停止' };
    }
    const checkResult = await checkPaymentReadyWithTimeout(kind, tabId, PAYMENT_READY_CHECK_TIMEOUT_MS);
    last = checkResult.result;
    if (checkResult.timedOut || checkResult.errorMessage) {
      readyCheckFailureCount += 1;
      await context.appendAutomationDebugLog(
        kind === 'paypal-account-entry' ? 'open-paypal-account' : '',
        'payment-ready-check-error',
        {
          kind,
          elapsedMs: Date.now() - startedAt,
          failureCount: readyCheckFailureCount,
          timedOut: checkResult.timedOut,
          errorMessage: checkResult.errorMessage || '',
          result: last,
        },
      );
    }
    if (kind === 'paypal-account-entry' && (!last.ok || checkResult.timedOut || checkResult.errorMessage)) {
      const now = Date.now();
      if (now - paypalEntryLastProbeAt >= PAYPAL_ENTRY_DIRECT_PROBE_INTERVAL_MS) {
        paypalEntryLastProbeAt = now;
        const probeResult = await probePaypalAccountEntryPage(tabId);
        await context.appendAutomationDebugLog('open-paypal-account', 'paypal-entry-direct-probe', {
          kind,
          elapsedMs: now - startedAt,
          result: probeResult,
        });
        if (probeResult.ok || isPaypalSliderChallengeResult(probeResult)) {
          last = probeResult;
        }
      }
    }
    if (kind === 'paypal-account-entry' && !paypalEntrySliderLogged && isPaypalSliderChallengeResult(last)) {
      paypalEntrySliderLogged = true;
      await appendAutomationLog(
        'warn',
        'PayPal 出现滑块/DataDome 验证，请在页面手动完成；自动化会等待页面跳转后继续',
        'open-paypal-account',
      );
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-slider-challenge-before-entry-ready', {
        kind,
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: last,
      });
      const jsHookResult = await runPaypalSliderChallengePageScript(tabId);
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-slider-js-hook', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: jsHookResult,
      });
    }
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
    message: paypalEntrySliderLogged
      ? `PayPal 滑块/DataDome 验证等待超时，请手动完成后从第 11 步继续：${debug || last.message}`
      : debug ? `${last.message}：${debug}` : last.message,
    data: last.data,
  };
}

interface PaymentReadyCheckResult {
  result: ActionResult;
  timedOut: boolean;
  errorMessage?: string;
}

async function checkPaymentReadyWithTimeout(
  kind: PaymentReadyKind,
  tabId: number,
  timeoutMs: number,
): Promise<PaymentReadyCheckResult> {
  const readyPromise = checkCurrentPaymentPageReady(kind, tabId).then(
    (result): PaymentReadyCheckResult => ({ result, timedOut: false }),
    (error): PaymentReadyCheckResult => ({
      result: {
        ok: false,
        message: `等待页面 ready 检查失败：${error instanceof Error ? error.message : String(error)}`,
      },
      timedOut: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    }),
  );
  return await Promise.race([
    readyPromise,
    delay(timeoutMs).then((): PaymentReadyCheckResult => ({
      result: {
        ok: false,
        message: `等待页面 ready 检查超时：${Math.round(timeoutMs / 1000)} 秒内 content script 没有返回`,
        data: { readyCheckTimedOut: true },
      },
      timedOut: true,
    })),
  ]);
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
  let sliderLogged = false;
  let entryClickCount = 0;

  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待 PayPal 页面已停止' };
    }
    last = await checkCurrentPaymentPageReady('paypal-email', tabId);
    if (!sliderLogged && isPaypalSliderChallengeResult(last)) {
      sliderLogged = true;
      // 检测到 PayPal 滑块后的处理入口：如果需要执行页面调试 JS 或人工辅助提示，入口放在这里。
      // 不要在这里加入自动拖动滑块、自动通过验证、绕过验证之类的逻辑；当前保持为人工处理提示。
      await appendAutomationLog(
        'warn',
        'PayPal 出现滑块验证，请在页面手动完成；自动化会等待页面跳转后继续',
        'open-paypal-account',
      );
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-slider-challenge', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: last,
      });
      const jsHookResult = await runPaypalSliderChallengePageScript(tabId);
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-slider-js-hook', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        result: jsHookResult,
      });
    }
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
    last = await checkCurrentPaymentPageReady('paypal-account-entry', tabId);
    if (last.ok && isPaypalAccountEntryResult(last)) {
      entryClickCount += 1;
      const clickResult = await openCurrentPaypalAccountEntry(tabId);
      await appendAutomationLog(
        clickResult.ok ? 'info' : 'warn',
        `PayPal 仍在创建账户入口页，已补点入口 ${entryClickCount} 次：${clickResult.message}`,
        'open-paypal-account',
      );
      await context.appendAutomationDebugLog('open-paypal-account', 'paypal-entry-reclick', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        entryClickCount,
        ready: last,
        clickResult,
      });
      await delay(1_500);
      continue;
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
    message: sliderLogged
      ? `PayPal 滑块验证等待超时，请手动完成滑块后从第 11 步继续：${debug || last.message}`
      : debug ? `${last.message}：${debug}` : last.message,
    data: last.data,
  };
}

function isPaypalSliderChallengeResult(result: ActionResult): boolean {
  return isRecord(result.data) && result.data.sliderChallengeFound === true;
}

function isPaypalAccountEntryResult(result: ActionResult): boolean {
  return isRecord(result.data) &&
    result.data.pageKind === 'account-entry' &&
    result.data.createAccountButtonFound === true;
}

async function probePaypalAccountEntryPage(tabId: number): Promise<ActionResult> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const isVisible = (element: Element | null): boolean => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            Number(style.opacity || 1) > 0;
        };
        const normalizedText = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
        const rectData = (element: Element | null) => {
          if (!(element instanceof HTMLElement)) {
            return null;
          }
          const rect = element.getBoundingClientRect();
          return {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            centerX: Math.round(rect.left + rect.width / 2),
            centerY: Math.round(rect.top + rect.height / 2),
            pageLeft: Math.round(rect.left + window.scrollX),
            pageTop: Math.round(rect.top + window.scrollY),
            pageCenterX: Math.round(rect.left + rect.width / 2 + window.scrollX),
            pageCenterY: Math.round(rect.top + rect.height / 2 + window.scrollY),
          };
        };
        const createAccountButton = Array.from(document.querySelectorAll<HTMLButtonElement>([
          'button#startOnboardingFlow',
          'button[name="startOnboardingFlow"]',
          'button.onboardingFlowContentKey',
          'button[data-atomic-wait-intent="Pay_With_Card"]',
          'button[data-atomic-wait-viewname="email"][data-atomic-wait-task="login_create_account"]',
          'button',
        ].join(','))).find((button) => {
          if (!isVisible(button)) {
            return false;
          }
          const marker = normalizedText([
            button.textContent,
            button.id,
            button.name,
            button.className,
            button.getAttribute('data-atomic-wait-intent'),
            button.getAttribute('data-atomic-wait-task'),
            button.getAttribute('data-atomic-wait-viewname'),
            button.getAttribute('aria-label'),
          ].join(' '));
          return button.id === 'startOnboardingFlow' ||
            button.name === 'startOnboardingFlow' ||
            button.classList.contains('onboardingFlowContentKey') ||
            marker.includes('pay_with_card') ||
            marker.includes('create an account') ||
            marker.includes('create paypal account') ||
            marker.includes('create a paypal account') ||
            marker.includes('アカウントを開設') ||
            marker.includes('アカウント開設') ||
            marker.includes('创建账户');
        }) || null;
        const emailInput = document.querySelector<HTMLInputElement>(
          'input#onboardingFlowEmail, input[name="login_email"], input[type="email"]',
        );
        const continueButton = document.querySelector<HTMLButtonElement>(
          'button.actionContinue[type="submit"], button.scTrack\\:next, button[type="submit"]',
        );
        const dataDomeIframe = document.querySelector<HTMLIFrameElement>(
          'iframe[title*="DataDome" i], iframe[src*="geo.ddc.paypal.com/captcha"], iframe[src*="ct.ddc.paypal.com"]',
        );
        const dataDomeForm = document.querySelector<HTMLFormElement>('form#ads-dd-captcha, form input[name="adsddcaptcha"]');
        const sliderContainer = document.querySelector<HTMLElement>('.sliderContainer');
        const slider = document.querySelector<HTMLElement>('.slider');
        const captchaComponent = document.getElementById('captchaComponent');
        const sliderChallengeFound = Boolean(
          (dataDomeIframe && isVisible(dataDomeIframe)) ||
            dataDomeForm ||
            (sliderContainer && slider && isVisible(sliderContainer) && isVisible(slider)),
        );
        const createAccountButtonClickable = Boolean(
          createAccountButton &&
            !createAccountButton.disabled &&
            createAccountButton.getAttribute('aria-disabled') !== 'true',
        );
        const emailFormFound = Boolean(emailInput && isVisible(emailInput) && continueButton && isVisible(continueButton));
        const pathname = location.pathname;
        const pageKind = sliderChallengeFound
          ? 'paypal-challenge'
          : pathname.includes('/checkoutweb/signup')
            ? 'signup'
            : emailFormFound
              ? 'checkout-email'
              : createAccountButton
                ? 'account-entry'
                : pathname.includes('/agreements/approve')
                  ? 'agreement-approve'
                  : 'unsupported-paypal';
        const ok = pageKind === 'signup' ||
          pageKind === 'checkout-email' ||
          (pageKind === 'account-entry' && createAccountButtonClickable);

        return {
          ok,
          message: ok
            ? `PayPal 创建账户入口直连探测已就绪：${pageKind}`
            : sliderChallengeFound
              ? 'PayPal 出现 DataDome/滑块验证，等待人工完成'
              : `PayPal 创建账户入口直连探测未就绪：${pageKind}`,
          data: {
            pageKind,
            url: location.href,
            readyState: document.readyState,
            createAccountButtonFound: Boolean(createAccountButton),
            createAccountButtonClickable,
            createAccountButtonDisabled: createAccountButton ? createAccountButton.disabled : false,
            createAccountButtonAriaDisabled: createAccountButton ? createAccountButton.getAttribute('aria-disabled') === 'true' : false,
            createAccountButtonText: createAccountButton ? (createAccountButton.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
            emailInputFound: Boolean(emailInput),
            continueButtonFound: Boolean(continueButton),
            sliderChallengeFound,
            dataDomeIframeFound: Boolean(dataDomeIframe),
            dataDomeIframeSrc: dataDomeIframe?.src || '',
            dataDomeIframeRect: rectData(dataDomeIframe),
            dataDomeFormFound: Boolean(dataDomeForm),
            dataDomeFormRect: rectData(dataDomeForm),
            sliderContainerFound: Boolean(sliderContainer),
            sliderContainerRect: rectData(sliderContainer),
            sliderFound: Boolean(slider),
            sliderRect: rectData(slider),
            captchaComponentFound: Boolean(captchaComponent),
            captchaComponentRect: rectData(captchaComponent),
          },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResultLike(result)
      ? result
      : { ok: false, message: 'PayPal 创建账户入口直连探测没有返回有效结果' };
  } catch (error) {
    return {
      ok: false,
      message: `PayPal 创建账户入口直连探测失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runPaypalSliderChallengePageScript(tabId: number): Promise<ActionResult> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // 唯一的 PayPal 滑块页面 JS 执行入口。
        // 这里仅做检测和日志输出，方便确认页面状态。
        // 自动拖动滑块、自动通过验证、绕过验证相关逻辑不要放进自动化流程。
        const sliderContainer = document.querySelector<HTMLElement>('.sliderContainer');
        const slider = document.querySelector<HTMLElement>('.slider');
        const dataDomeIframe = document.querySelector<HTMLIFrameElement>(
          'iframe[title*="DataDome" i], iframe[src*="geo.ddc.paypal.com/captcha"], iframe[src*="ct.ddc.paypal.com"]',
        );
        const dataDomeForm = document.querySelector<HTMLFormElement>('form#ads-dd-captcha, form input[name="adsddcaptcha"]');
        const rectData = (element: Element | null) => {
          if (!(element instanceof HTMLElement)) {
            return null;
          }
          const rect = element.getBoundingClientRect();
          return {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            centerX: Math.round(rect.left + rect.width / 2),
            centerY: Math.round(rect.top + rect.height / 2),
            pageLeft: Math.round(rect.left + window.scrollX),
            pageTop: Math.round(rect.top + window.scrollY),
            pageCenterX: Math.round(rect.left + rect.width / 2 + window.scrollX),
            pageCenterY: Math.round(rect.top + rect.height / 2 + window.scrollY),
          };
        };

        // if (dataDomeIframe || dataDomeForm) {
        //   console.log('开始调试：DataDome CAPTCHA iframe/form');
        //   return {
        //     ok: true,
        //     message: 'PayPal 滑块调试 JS 已执行：检测到 DataDome CAPTCHA iframe/form',
        //     data: {
        //       url: location.href,
        //       readyState: document.readyState,
        //       hasDataDomeIframe: Boolean(dataDomeIframe),
        //       dataDomeIframeSrc: dataDomeIframe?.src || '',
        //       hasDataDomeForm: Boolean(dataDomeForm),
        //       hasSliderContainer: Boolean(sliderContainer),
        //       hasSlider: Boolean(slider),
        //     },
        //   };
        // }
      console.log('开始调试：DataDome CAPTCHA iframe/form');
      // 匹配你当前真实元素
        console.log(sliderContainer, slider, dataDomeIframe, dataDomeForm);
        if (!sliderContainer || !slider) {
          const dataDomeIframeRect = rectData(dataDomeIframe);
          const dataDomeFormRect = rectData(dataDomeForm);
          if (dataDomeIframe || dataDomeForm) {
            console.log('DataDome 元素位置', {
              iframe: dataDomeIframeRect,
              form: dataDomeFormRect,
              iframeSrc: dataDomeIframe?.src || '',
              formAction: dataDomeForm?.action || '',
            });
            return {
              ok: true,
              message: 'PayPal 滑块调试 JS 已执行：检测到 DataDome iframe/form，已输出外框坐标',
              data: {
                url: location.href,
                readyState: document.readyState,
                hasDataDomeIframe: Boolean(dataDomeIframe),
                dataDomeIframeSrc: dataDomeIframe?.src || '',
                dataDomeIframeRect,
                hasDataDomeForm: Boolean(dataDomeForm),
                dataDomeFormAction: dataDomeForm?.action || '',
                dataDomeFormRect,
                hasSliderContainer: Boolean(sliderContainer),
                hasSlider: Boolean(slider),
              },
            };
          }
          console.error('未找到元素');
          return {
            ok: false,
            message: 'PayPal 滑块调试：未找到元素',
            data: {
              url: location.href,
              readyState: document.readyState,
              hasSliderContainer: Boolean(sliderContainer),
              hasSlider: Boolean(slider),
            },
          };
        }

        console.log('开始调试');
        const containerRect = sliderContainer.getBoundingClientRect();
        const sliderRect = slider.getBoundingClientRect();
        const startX = sliderRect.left + sliderRect.width / 2;
        const startY = sliderRect.top + sliderRect.height / 2;
        console.log('元素位置', { containerRect, sliderRect, startX, startY });

        // 保留原始实验片段供查看，不执行。
        // const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
        // const extraOffset = 12;
        // const totalMove = containerRect.width + extraOffset;
        // const createEvt = (type: string, x: number, y: number) => new MouseEvent(type, {
        //   bubbles: true,
        //   cancelable: true,
        //   clientX: x,
        //   clientY: y,
        // });
        // slider.dispatchEvent(createEvt('mousedown', startX, startY));
        // sleep(120);

        // const steps = 40;
        // for (let i = 1; i <= steps; i += 1) {
        //   const rate = Math.pow(i / steps, 1.2);
        //   const curX = startX + totalMove * rate;
        //   const curY = startY + (Math.random() - 0.5) * 2;
        //   slider.dispatchEvent(createEvt('mousemove', curX, curY));
        //   sleep(6 + Math.random() * 6);
        // }

        // const finalX = startX + totalMove - 2;
        // slider.dispatchEvent(createEvt('mousemove', finalX, startY));
        // sleep(100);
        // slider.dispatchEvent(createEvt('mouseup', finalX, startY));
        

        return {
          ok: true,
          message: 'PayPal 滑块调试 JS 已执行：已定位元素，仅输出诊断',
          data: {
            url: location.href,
            readyState: document.readyState,
            hasSliderContainer: true,
            hasSlider: true,
            containerWidth: containerRect.width,
            sliderWidth: sliderRect.width,
            startX,
            startY,
          },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResultLike(result)
      ? result
      : { ok: false, message: 'PayPal 滑块 JS hook 没有返回有效结果' };
  } catch (error) {
    return {
      ok: false,
      message: `PayPal 滑块 JS hook 执行失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isActionResultLike(value: unknown): value is ActionResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ActionResult).ok === 'boolean' &&
      typeof (value as ActionResult).message === 'string',
  );
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

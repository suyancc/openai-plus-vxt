import { getBrowserTab } from '../../app/active-tab';
import { loadAutomationState, saveRegisterState } from '../../app/state';
import type { ActionResult } from '../../app/types';
import { waitForOutlookOtpAndSubmit } from '../register/service';
import { appendAutomationLog } from './state';
import { currentEmail } from './runner-state';
import {
  delay,
  isActionResultLike,
  parseUrl,
  shortUrl,
} from './runner-format';
import {
  isEmailOtpIncorrectResult,
  isOpenAiAuthAccountUnavailableFailure,
} from './runner-errors';
import {
  isAfterEmailVerificationUrl,
  isEmailVerificationUrl,
} from './runner-url';

const EMAIL_OTP_ATTEMPTS = 5;

interface EmailOtpStepContext {
  automationTargetTabId(): Promise<number>;
  waitForAutomationTabUrl(predicate: (url: URL) => boolean, timeoutMs: number): Promise<URL>;
  isStopRequested(): boolean;
}

export async function waitOutlookCodeStep(context: EmailOtpStepContext): Promise<ActionResult> {
  const state = await loadAutomationState();
  const email = currentEmail(state);
  if (!email) {
    return { ok: false, message: '没有当前邮箱，请先执行“选择邮箱”' };
  }
  if (!email.rawInput.includes('----')) {
    return { ok: false, message: '当前邮箱不是 Outlook 行，无法自动接收邮箱验证码' };
  }

  const tabId = await context.automationTargetTabId();
  const url = await context.waitForAutomationTabUrl(
    (currentUrl) => isEmailVerificationUrl(currentUrl) || isAfterEmailVerificationUrl(currentUrl),
    120_000,
  );
  if (isAfterEmailVerificationUrl(url)) {
    return {
      ok: true,
      message: `邮箱验证码已处理，页面已进入后续流程：${shortUrl(url.href)}`,
      data: { url: url.href, skippedOtpFill: true },
    };
  }

  let since = Date.now() - 10_000;
  const ignoredCodes: string[] = [];
  let lastResult: ActionResult = { ok: false, message: '尚未接收邮箱验证码' };

  for (let attempt = 1; attempt <= EMAIL_OTP_ATTEMPTS; attempt += 1) {
    if (context.isStopRequested()) {
      return { ok: false, message: '接收邮箱验证码已停止' };
    }

    const result = await waitForOutlookOtpAndSubmit({
      since,
      timeoutMs: 180_000,
      intervalMs: 5_000,
      tabId,
      ignoreCodes: ignoredCodes,
    });
    lastResult = result;

    if (!result.ok) {
      if (result.message.includes('当前页面不是邮箱验证码页')) {
        const advanced = await recoverAdvancedAfterEmailVerification(tabId);
        if (advanced) {
          return advanced;
        }
      }
      return result;
    }

    const progress = await waitForEmailVerificationSubmitProgress(12_000, tabId, context);
    if (!progress.ok) {
      if (isEmailOtpIncorrectResult(progress) && attempt < EMAIL_OTP_ATTEMPTS) {
        const resend = await resendEmailVerificationCode(tabId);
        if (!resend.ok) {
          return {
            ...resend,
            code: result.code,
            message: `${result.message}；验证码不正确，但重新发送邮件失败：${resend.message}`,
          };
        }
        if (result.code) {
          ignoredCodes.push(result.code);
        }
        since = Date.now();
        await saveRegisterState({
          otpRequestedAt: since,
          otpAutoPending: false,
          otpLastMessage: `邮箱验证码 ${result.code || ''} 不正确，已重新发送邮件，等待新验证码`,
        });
        await appendAutomationLog(
          'warn',
          `邮箱验证码 ${result.code || ''} 不正确，已点击重新发送邮件，等待新验证码 ${attempt + 1}/${EMAIL_OTP_ATTEMPTS}`,
          'wait-register-email-code',
        );
        await delay(1500);
        continue;
      }
      return {
        ...progress,
        code: result.code,
        message: `${result.message}；${progress.message}`,
      };
    }

    return {
      ...result,
      message: `${result.message}；${progress.message}`,
      data: progress.data || result.data,
    };
  }

  return {
    ...lastResult,
    ok: false,
    message: `邮箱验证码重试 ${EMAIL_OTP_ATTEMPTS} 次后仍不可用：${lastResult.message}`,
  };
}

async function recoverAdvancedAfterEmailVerification(tabId: number): Promise<ActionResult | null> {
  const target = await getBrowserTab(tabId);
  const parsed = parseUrl(target?.url || '');
  if (parsed && isAfterEmailVerificationUrl(parsed)) {
    return {
      ok: true,
      message: `邮箱验证码已处理，页面已进入后续流程：${shortUrl(parsed.href)}`,
      data: { url: parsed.href, recoveredFromPageAdvance: true },
    };
  }
  return null;
}

async function waitForEmailVerificationSubmitProgress(
  timeoutMs: number,
  tabId: number,
  context: Pick<EmailOtpStepContext, 'isStopRequested'>,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待邮箱验证码提交结果已停止' };
    }
    const target = await getBrowserTab(tabId);
    lastUrl = target?.url || lastUrl;
    const parsed = parseUrl(lastUrl);
    if (parsed && isAfterEmailVerificationUrl(parsed)) {
      return {
        ok: true,
        message: `页面已进入后续流程：${shortUrl(parsed.href)}`,
        data: { url: parsed.href },
      };
    }

    const accountStatus = await detectAuthAccountUnavailable(tabId);
    if (isOpenAiAuthAccountUnavailableFailure('wait-register-email-code', accountStatus)) {
      return accountStatus;
    }
    const otpIssue = await detectEmailOtpIncorrect(tabId);
    if (isEmailOtpIncorrectResult(otpIssue)) {
      return otpIssue;
    }
    await delay(500);
  }
  return {
    ok: true,
    message: `验证码已提交，等待后续页面超时，最后页面：${shortUrl(lastUrl) || '未知'}`,
    data: { url: lastUrl, submitProgressTimeout: true },
  };
}

async function detectEmailOtpIncorrect(tabId: number): Promise<ActionResult> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const text = (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim();
        const normalized = text.toLowerCase();
        const incorrect = normalized.includes('代码不正确') ||
          normalized.includes('验证码不正确') ||
          normalized.includes('incorrect code') ||
          normalized.includes('invalid code') ||
          normalized.includes('wrong code');
        return {
          ok: !incorrect,
          message: incorrect ? '邮箱验证码不正确' : '未发现邮箱验证码错误提示',
          data: {
            url: location.href,
            readyState: document.readyState,
            emailOtpIncorrect: incorrect,
            text: incorrect ? text.slice(0, 500) : '',
          },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResultLike(result) ? result : { ok: false, message: '邮箱验证码错误检测没有返回有效结果' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function resendEmailVerificationCode(tabId: number): Promise<ActionResult> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        function isVisible(element: Element): boolean {
          const target = element as HTMLElement;
          const style = window.getComputedStyle(target);
          const rect = target.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        const selectors = [
          'button[name="intent"][value="resend"]',
          'button[value="resend"]',
          'button[type="submit"][form][name="intent"]',
        ];
        for (const selector of selectors) {
          const button = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((candidate) => {
            const text = (candidate.textContent || '').trim().toLowerCase();
            return isVisible(candidate) &&
              !candidate.disabled &&
              candidate.getAttribute('aria-disabled') !== 'true' &&
              (candidate.value === 'resend' ||
                text.includes('重新发送') ||
                text.includes('resend'));
          });
          if (button) {
            button.scrollIntoView({ block: 'center', inline: 'center' });
            button.click();
            return {
              ok: true,
              message: '已点击重新发送电子邮件',
              data: { url: location.href, readyState: document.readyState },
            };
          }
        }
        return {
          ok: false,
          message: '没有找到重新发送电子邮件按钮',
          data: { url: location.href, readyState: document.readyState },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResultLike(result) ? result : { ok: false, message: '重新发送邮件没有返回有效结果' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function detectAuthAccountUnavailable(tabId: number): Promise<ActionResult> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const text = (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim();
        const normalized = text.toLowerCase();
        const unavailable = normalized.includes('account_deactivated') ||
          normalized.includes('账户已被删除或停用') ||
          normalized.includes('account has been deleted or deactivated') ||
          normalized.includes('account deleted or deactivated');
        return {
          ok: !unavailable,
          message: unavailable ? '账号不可用：account_deactivated' : '未发现账号停用提示',
          data: {
            url: location.href,
            readyState: document.readyState,
            accountDeactivated: unavailable,
            text: unavailable ? text.slice(0, 500) : '',
          },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResultLike(result) ? result : { ok: false, message: '账号状态检测没有返回有效结果' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

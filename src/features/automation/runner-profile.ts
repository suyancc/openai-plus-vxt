import { getBrowserTab } from '../../app/active-tab';
import type { ActionResult } from '../../app/types';
import {
  checkRegisterPageReadyNow,
  fillProfileAndCreateAccount,
  skipCreateAccountPasskey,
} from '../register/service';
import { appendAutomationLog } from './state';
import {
  delay,
  isRecord,
  parseUrl,
  shortUrl,
} from './runner-format';
import { isRetryableAboutYouTimeout } from './runner-errors';
import {
  isAboutYouUrl,
  isAfterEmailVerificationUrl,
  isCreateAccountPasskeyEnrollmentUrl,
} from './runner-url';

const CHATGPT_HOME_LOAD_TIMEOUT_MS = 30_000;
const PROFILE_PAGE_TIMEOUT_MS = 15_000;
const PROFILE_SUBMIT_ATTEMPTS = 5;
const PROFILE_SUBMIT_PROGRESS_TIMEOUT_MS = 30_000;

interface ProfileStepContext {
  automationTargetTabId(): Promise<number>;
  waitForAutomationTabUrl(predicate: (url: URL) => boolean, timeoutMs: number): Promise<URL>;
  waitForAutomationTabComplete(timeoutMs: number): Promise<ActionResult>;
  isStopRequested(): boolean;
}

export async function fillProfileStep(context: ProfileStepContext): Promise<ActionResult> {
  const tabId = await context.automationTargetTabId();
  let lastResult: ActionResult = { ok: false, message: '尚未提交资料' };

  for (let attempt = 1; attempt <= PROFILE_SUBMIT_ATTEMPTS; attempt += 1) {
    if (context.isStopRequested()) {
      return { ok: false, message: '填写资料已停止' };
    }

    const currentUrl = await context.waitForAutomationTabUrl(
      (url) => isAboutYouUrl(url) || isAfterEmailVerificationUrl(url),
      PROFILE_PAGE_TIMEOUT_MS,
    );
    if (!isAboutYouUrl(currentUrl)) {
      return {
        ok: true,
        message: `资料填写已跳过，页面已进入后续流程：${shortUrl(currentUrl.href)}`,
        data: { url: currentUrl.href, aboutYouSkipped: true },
      };
    }
    await context.waitForAutomationTabComplete(PROFILE_PAGE_TIMEOUT_MS);
    const ready = await checkRegisterPageReadyNow('profile', tabId);
    if (!ready.ok) {
      lastResult = ready;
      if (isRetryableAboutYouTimeout(ready) && attempt < PROFILE_SUBMIT_ATTEMPTS) {
        await refreshAboutYouAndRetry(tabId, attempt, ready.message, context);
        continue;
      }
      return ready;
    }

    const result = await fillProfileAndCreateAccount(tabId);
    lastResult = result;
    await appendAutomationLog(
      result.ok ? 'info' : 'warn',
      `填写资料尝试 ${attempt}/${PROFILE_SUBMIT_ATTEMPTS}：${result.message}`,
      'fill-profile',
    );
    if (!result.ok) {
      if (isRetryableAboutYouTimeout(result) && attempt < PROFILE_SUBMIT_ATTEMPTS) {
        await refreshAboutYouAndRetry(tabId, attempt, result.message, context);
        continue;
      }
      return result;
    }

    const progress = await waitForAboutYouSubmitProgress(PROFILE_SUBMIT_PROGRESS_TIMEOUT_MS, tabId, context);
    if (progress.ok) {
      return {
        ...result,
        message: `${result.message}；${progress.message}`,
        data: progress.data || result.data,
      };
    }
    lastResult = progress;
    await appendAutomationLog(
      'warn',
      `填写资料提交结果 ${attempt}/${PROFILE_SUBMIT_ATTEMPTS}：${progress.message}`,
      'fill-profile',
    );
    if (isRetryableAboutYouTimeout(progress) && attempt < PROFILE_SUBMIT_ATTEMPTS) {
      await refreshAboutYouAndRetry(tabId, attempt, progress.message, context);
      continue;
    }
    return {
      ...progress,
      ok: false,
      message: `${result.message}；${progress.message}`,
      data: progress.data || result.data,
    };
  }

  return {
    ...lastResult,
    ok: false,
    message: `填写资料重试 ${PROFILE_SUBMIT_ATTEMPTS} 次后仍失败：${lastResult.message}`,
  };
}

async function waitForAboutYouSubmitProgress(
  timeoutMs: number,
  tabId: number,
  context: Pick<ProfileStepContext, 'isStopRequested'>,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let last: ActionResult = { ok: false, message: '资料提交后仍在等待页面变化' };
  let lastUrl = '';
  let passkeySkipClicked = false;
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '等待资料提交结果已停止' };
    }

    const tab = await getBrowserTab(tabId);
    lastUrl = tab?.url || lastUrl;
    const parsed = parseUrl(lastUrl);
    if (parsed && isCreateAccountPasskeyEnrollmentUrl(parsed)) {
      if (!passkeySkipClicked) {
        const skip = await skipCreateAccountPasskey(tabId);
        last = skip;
        await appendAutomationLog(
          skip.ok ? 'info' : 'warn',
          `资料提交后进入 Passkey 设置页：${skip.message}`,
          'fill-profile',
        );
        passkeySkipClicked = skip.ok;
      }
      await delay(450);
      continue;
    }
    if (parsed && !isAboutYouUrl(parsed)) {
      return {
        ok: true,
        message: `资料提交后页面已进入后续流程：${shortUrl(parsed.href)}`,
        data: { url: parsed.href, aboutYouAdvanced: true },
      };
    }

    if (parsed && isAboutYouUrl(parsed)) {
      const ready = await checkRegisterPageReadyNow('profile', tabId);
      last = ready;
      if (isRetryableAboutYouTimeout(ready)) {
        return {
          ok: false,
          message: ready.message,
          data: {
            ...(isRecord(ready.data) ? ready.data : {}),
            url: parsed.href,
          },
        };
      }
    }

    await delay(450);
  }

  return {
    ok: false,
    message: `资料提交后 ${Math.round(timeoutMs / 1000)} 秒内页面没有变化，最后页面：${shortUrl(lastUrl) || '未知'}`,
    data: {
      ...(isRecord(last.data) ? last.data : {}),
      url: lastUrl,
    },
  };
}

async function refreshAboutYouAndRetry(
  tabId: number,
  attempt: number,
  reason: string,
  context: Pick<ProfileStepContext, 'waitForAutomationTabComplete' | 'waitForAutomationTabUrl'>,
): Promise<void> {
  await appendAutomationLog(
    'warn',
    `资料页提交超时，刷新后重试 ${attempt + 1}/${PROFILE_SUBMIT_ATTEMPTS}：${reason}`,
    'fill-profile',
  );
  await browser.tabs.reload(tabId);
  await context.waitForAutomationTabComplete(CHATGPT_HOME_LOAD_TIMEOUT_MS);
  await context.waitForAutomationTabUrl(isAboutYouUrl, PROFILE_PAGE_TIMEOUT_MS);
}

import type { BrowserTabInfo } from '../../app/active-tab';
import {
  loadAutomationState,
  loadOAuthState,
} from '../../app/state';
import type { ActionResult } from '../../app/types';
import {
  chooseOAuthExistingAccount,
  continueOAuthConsent,
  createOAuthSessionFromRegisterSource,
  ensureOAuthFilesFromSession,
  exchangeCurrentOAuthCode,
  fillOAuthEmailFromRegisterSource,
  fillOAuthLoginPasswordFromRegisterSource,
  generateOAuthFilesFromSession,
  startOAuthPhoneVerification,
} from '../oauth/service';
import { saveAutomationGeneratedFile } from './state';
import type { AutomationEmailAccount } from './types';
import { waitOutlookCodeStep } from './runner-email-otp';
import {
  isOAuthAddPhoneUrl,
  isOAuthChooseAccountUrl,
  isOAuthConsentUrl,
  isOAuthCallbackUrl,
  isOAuthLoginPasswordUrl,
  isOAuthLoginUrl,
  isEmailVerificationUrl,
} from './runner-url';
import {
  isRecord,
  parseUrl,
  delay,
  shortUrl,
} from './runner-format';

interface OAuthStepContext {
  ensureSelectedEmail(): Promise<AutomationEmailAccount>;
  ensureSessionIdentity?(): Promise<void>;
  automationTargetTabId(): Promise<number>;
  bindAutomationTargetTab(tab: BrowserTabInfo | null, reason: string): Promise<number>;
  waitForAutomationTabUrl(predicate: (url: URL) => boolean, timeoutMs: number): Promise<URL>;
  waitForAutomationTabComplete(timeoutMs: number): Promise<ActionResult>;
  isRegisterUrl(url: URL): boolean;
  isStopRequested(): boolean;
}

const OAUTH_CALLBACK_WAIT_MS = 45_000;
const OAUTH_FILE_WAIT_MS = 60_000;
const OAUTH_CHOOSE_ACCOUNT_CLICK_TIMEOUT_MS = 20_000;
const OAUTH_LOGIN_EMAIL_SETTLE_MS = 5_000;
const OAUTH_POST_EMAIL_WAIT_MS = 60_000;
const DIRECT_OAUTH_FILE_ATTEMPTS = 5;
const DIRECT_OAUTH_FILE_RETRY_DELAY_MS = 5_000;

export async function createOAuthSessionStep(context: OAuthStepContext): Promise<ActionResult> {
  await context.ensureSelectedEmail();
  const response = await createOAuthSessionFromRegisterSource();
  if (response?.tabId) {
    await context.bindAutomationTargetTab({
      id: response.tabId,
      windowId: response.windowId,
      url: response.state?.authUrl,
    }, '打开 OAuth 登录页');
  }
  return {
    ok: Boolean(response?.ok),
    message: response?.message || 'OAuth 会话返回无效',
  };
}

export async function fillOAuthEmailStep(context: OAuthStepContext): Promise<ActionResult> {
  await context.ensureSelectedEmail();
  const tabId = await context.automationTargetTabId();
  if (context.isStopRequested()) {
    return { ok: false, message: '填写 OAuth 邮箱已停止' };
  }
  const url = await context.waitForAutomationTabUrl(
    (currentUrl) => context.isRegisterUrl(currentUrl) || isOAuthChooseAccountUrl(currentUrl) || isOAuthPostLoginUrl(currentUrl),
    60_000,
  );
  if (context.isStopRequested()) {
    return { ok: false, message: '填写 OAuth 邮箱已停止' };
  }
  if (isOAuthPostLoginUrl(url)) {
    return {
      ok: true,
      message: `OAuth 已进入后续流程，跳过邮箱输入：${shortUrl(url.href)}`,
      data: { url: url.href, skippedEmailFill: true },
    };
  }
  if (isOAuthChooseAccountUrl(url)) {
    await context.waitForAutomationTabComplete(20_000).catch(() => null);
    const choose = await waitForOAuthAction(
      () => chooseOAuthExistingAccount(tabId),
      OAUTH_CHOOSE_ACCOUNT_CLICK_TIMEOUT_MS,
      '点击已有账号超时',
      context,
    );
    if (!choose.ok) {
      return {
        ...choose,
        message: `检测到已有登录账号页，但点击账号失败：${choose.message}`,
      };
    }
    return {
      ...choose,
      message: `${choose.message}，等待后续 OAuth 页面`,
      data: { url: url.href, choseExistingAccount: true },
    };
  }
  if (context.isStopRequested()) {
    return { ok: false, message: '填写 OAuth 邮箱已停止' };
  }
  if (isOAuthLoginUrl(url)) {
    await waitForOAuthLoginEmailSettle(context);
  }

  const fill = await fillOAuthEmailFromRegisterSource(tabId);
  if (context.isStopRequested()) {
    return { ok: false, message: '填写 OAuth 邮箱已停止' };
  }
  if (!fill.ok && !isLikelyNavigationResponseClosed(fill.message)) {
    return fill;
  }

  const nextUrl = await waitForOAuthPostEmailUrl(context).catch(() => null);
  if (!nextUrl) {
    return fill;
  }
  if (isOAuthLoginPasswordUrl(nextUrl)) {
    const password = await fillOAuthLoginPasswordFromRegisterSource(tabId);
    if (!password.ok) {
      return {
        ...password,
        message: `OAuth 邮箱已提交，但登录密码页填写失败：${password.message}`,
      };
    }
    const afterPasswordUrl = await waitForOAuthPostPasswordUrl(context).catch(() => null);
    if (afterPasswordUrl) {
      return {
        ok: true,
        message: `OAuth 邮箱和密码已提交，当前页面：${shortUrl(afterPasswordUrl.href)}`,
        data: { url: afterPasswordUrl.href, passwordSubmitted: true },
      };
    }
    return {
      ...password,
      message: `${password.message}，等待后续 OAuth 页面`,
      data: { url: nextUrl.href, passwordSubmitted: true },
    };
  }
  if (isOAuthPostLoginUrl(nextUrl)) {
    return {
      ok: true,
      message: `OAuth 邮箱已提交并进入后续流程：${shortUrl(nextUrl.href)}`,
      data: { url: nextUrl.href },
    };
  }
  if (isEmailVerificationUrl(nextUrl)) {
    return {
      ...fill,
      message: `${fill.message}；已进入邮箱验证码页`,
      data: { url: nextUrl.href },
    };
  }

  return {
    ...fill,
    message: `${fill.message}；OAuth 下一页：${shortUrl(nextUrl.href)}`,
    data: { url: nextUrl.href },
  };
}

export async function waitOAuthEmailCodeStep(context: OAuthStepContext): Promise<ActionResult> {
  await context.ensureSelectedEmail();
  const tabId = await context.automationTargetTabId();
  const currentUrl = await advanceExistingOAuthSessionIfNeeded(tabId, context);
  const otpResult = currentUrl && isOAuthPostLoginUrl(currentUrl)
    ? {
        ok: true,
        message: `已跳过邮箱验证码，页面已进入后续 OAuth 流程：${shortUrl(currentUrl.href)}`,
        data: { url: currentUrl.href, skippedOtpFill: true, fromExistingSession: true },
      }
    : await waitOutlookCodeStep(context);
  if (!otpResult.ok) {
    return otpResult;
  }

  const nextUrl = await resolveOAuthPostEmailUrl(tabId, otpResult, context);
  if (!nextUrl) {
    return otpResult;
  }

  if (isOAuthAddPhoneUrl(nextUrl)) {
    const phoneResult = await startOAuthPhoneVerification(tabId);
    if (!phoneResult.ok) {
      if (isRetryableOAuthTokenFetchFailureAfterPhone(phoneResult)) {
        return {
          ok: true,
          message: `${otpResult.message}；检测到手机号绑定页，手机号验证已完成，但 OAuth token 网络请求失败，将继续第 19 步重试提取：${phoneResult.message}`,
          data: {
            otp: otpResult.data,
            phone: phoneResult.state?.phoneVerification || null,
            oauth: oauthStepSnapshot(phoneResult.state),
          },
        };
      }
      return {
        ...phoneResult,
        message: `${otpResult.message}；检测到手机号绑定页，但 OAuth 手机接码失败：${phoneResult.message}`,
      };
    }
    return {
      ok: true,
      message: `${otpResult.message}；检测到手机号绑定页，${phoneResult.message}；将继续第 19 步提取 OAuth 文件`,
      data: {
        otp: otpResult.data,
        phone: phoneResult.state?.phoneVerification || null,
        oauth: oauthStepSnapshot(phoneResult.state),
      },
    };
  }

  if (isOAuthConsentUrl(nextUrl)) {
    const consent = await continueOAuthConsent(tabId);
    if (!consent.ok) {
      return {
        ...consent,
        message: `${otpResult.message}；已进入 Codex consent 页，但点击继续失败：${consent.message}`,
      };
    }
    const callbackUrl = await context.waitForAutomationTabUrl(isOAuthCallbackUrl, OAUTH_CALLBACK_WAIT_MS);
    const saveResult = await saveOAuthFilesAfterCallback(
      `${otpResult.message}；已点击 Codex consent 并进入 ${shortUrl(callbackUrl.href)}`,
      callbackUrl.href,
      context,
    );
    return {
      ...saveResult,
      data: otpResult.data,
    };
  }

  if (isOAuthCallbackUrl(nextUrl)) {
    const saveResult = await saveOAuthFilesAfterCallback(
      `${otpResult.message}；已进入 OAuth callback`,
      nextUrl.href,
      context,
    );
    return {
      ...saveResult,
      data: otpResult.data,
    };
  }

  return {
    ...otpResult,
    message: `${otpResult.message}；OAuth 下一页：${shortUrl(nextUrl.href)}`,
  };
}

export async function exportOAuthFilesStep(context: Pick<OAuthStepContext, 'ensureSelectedEmail'>): Promise<ActionResult> {
  await context.ensureSelectedEmail();
  const exchangeRetry = await retryOAuthCodeExchangeIfFetchFailed();
  if (exchangeRetry.ok) {
    return saveCurrentOAuthFilesToAutomation(exchangeRetry.message);
  }
  const ready = await waitForExistingOAuthFiles(8_000);
  const result = ready.ok ? ready : await ensureOAuthFilesFromSession();
  if (!result.ok) {
    return result;
  }
  return saveCurrentOAuthFilesToAutomation(result.message);
}

export async function generateDirectFilesStep(
  context: Pick<OAuthStepContext, 'ensureSelectedEmail' | 'ensureSessionIdentity' | 'isStopRequested'>,
): Promise<ActionResult> {
  if (context.ensureSessionIdentity) {
    await context.ensureSessionIdentity();
  } else {
    await context.ensureSelectedEmail();
  }
  let last: ActionResult = { ok: false, message: '尚未尝试生成 OAuth 文件' };
  for (let attempt = 1; attempt <= DIRECT_OAUTH_FILE_ATTEMPTS; attempt += 1) {
    if (context.isStopRequested()) {
      return { ok: false, message: '直接生成 OAuth 文件已停止' };
    }
    const response = await generateOAuthFilesFromSession();
    if (!response.ok) {
      last = {
        ok: false,
        message: response.message || 'OAuth 文件生成失败',
      };
    } else {
      last = await saveCurrentOAuthFilesToAutomation(response.message);
      if (last.ok) {
        return attempt === 1
          ? last
          : {
              ...last,
              message: `${last.message}；第 ${attempt}/${DIRECT_OAUTH_FILE_ATTEMPTS} 次尝试成功`,
            };
      }
    }
    if (attempt < DIRECT_OAUTH_FILE_ATTEMPTS) {
      await delay(DIRECT_OAUTH_FILE_RETRY_DELAY_MS);
    }
  }
  return {
    ...last,
    ok: false,
    message: `直接生成 OAuth 文件重试 ${DIRECT_OAUTH_FILE_ATTEMPTS} 次仍失败：${last.message}`,
  };
}

async function saveCurrentOAuthFilesToAutomation(prefix: string): Promise<ActionResult> {
  const [oauth, automation] = await Promise.all([loadOAuthState(), loadAutomationState()]);
  const email = (oauth.credentials?.email || oauth.email || automation.run.sessionEmail || '').trim();
  const sub2apiJson = oauth.sub2apiJson.trim();
  const cpaJson = oauth.cpaJson.trim();
  if (!email) {
    return { ok: false, message: `${prefix}，但没有读取到账号邮箱，未保存文件` };
  }
  if (!sub2apiJson && !cpaJson) {
    return { ok: false, message: `${prefix}，但没有读取到 sub2api / CPA 内容` };
  }

  const next = await saveAutomationGeneratedFile({
    id: `generated-${email.toLowerCase()}`,
    email,
    source: oauth.exportSource,
    sub2apiJson,
    cpaJson,
    createdAt: Date.now(),
  });
  return {
    ok: true,
    message: `${prefix}；已保存到自动化设置页（${next.generatedFiles.records.length} 个账号）`,
  };
}

async function saveOAuthFilesAfterCallback(
  prefix: string,
  callbackUrl: string,
  context: Pick<OAuthStepContext, 'isStopRequested'>,
): Promise<ActionResult> {
  const exchange = await exchangeCurrentOAuthCode(callbackUrl, OAUTH_FILE_WAIT_MS);
  if (!exchange.ok) {
    return {
      ...exchange,
      message: `${prefix}，但换取 token 失败：${exchange.message}`,
    };
  }

  const files = await waitForOAuthFiles(10_000, context);
  if (!files.ok) {
    return {
      ...files,
      message: `${prefix}，token 交换返回成功，但文件仍未生成：${files.message}`,
    };
  }

  return saveCurrentOAuthFilesToAutomation(`${prefix}，OAuth token 已生成`);
}

async function waitForOAuthFiles(
  timeoutMs: number,
  context: Pick<OAuthStepContext, 'isStopRequested'>,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let lastMessage = '';
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '已停止自动化，取消等待 OAuth token 交换' };
    }
    const oauth = await loadOAuthState();
    lastMessage = oauth.exchangeMessage || '';
    if (oauth.exchangeStatus === 'success' && (oauth.sub2apiJson.trim() || oauth.cpaJson.trim())) {
      return { ok: true, message: oauth.exchangeMessage || 'OAuth 文件已生成' };
    }
    if (oauth.exchangeStatus === 'error' && (oauth.callbackUrl || oauth.codeParam)) {
      return { ok: false, message: oauth.exchangeMessage || 'OAuth token 交换失败' };
    }
    await delay(500);
  }
  return {
    ok: false,
    message: `等待 OAuth token 交换超时${lastMessage ? `：${lastMessage}` : ''}`,
  };
}

async function waitForExistingOAuthFiles(timeoutMs: number): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let lastMessage = '';
  while (Date.now() <= deadline) {
    const oauth = await loadOAuthState();
    lastMessage = oauth.exchangeMessage || '';
    if (oauth.exchangeStatus === 'success' && (oauth.sub2apiJson.trim() || oauth.cpaJson.trim())) {
      return { ok: true, message: oauth.exchangeMessage || 'OAuth 文件已生成' };
    }
    if (oauth.exchangeStatus === 'error' && (oauth.callbackUrl || oauth.codeParam)) {
      return { ok: false, message: oauth.exchangeMessage || 'OAuth token 交换失败' };
    }
    if (oauth.exchangeStatus !== 'pending') {
      break;
    }
    await delay(500);
  }
  return {
    ok: false,
    message: lastMessage ? `等待 OAuth 文件生成未完成：${lastMessage}` : 'OAuth 文件尚未生成',
  };
}

function oauthStepSnapshot(state: unknown): Record<string, unknown> {
  const oauth = isRecord(state) ? state : {};
  return {
    exchangeStatus: String(oauth.exchangeStatus || ''),
    exchangeMessage: String(oauth.exchangeMessage || ''),
    exportSource: String(oauth.exportSource || ''),
    hasCallbackUrl: Boolean(oauth.callbackUrl),
    hasCodeParam: Boolean(oauth.codeParam),
    hasCredentials: Boolean(oauth.credentials),
    hasSub2ApiJson: Boolean(oauth.sub2apiJson),
    hasCpaJson: Boolean(oauth.cpaJson),
  };
}

function isRetryableOAuthTokenFetchFailureAfterPhone(result: ActionResult & { state?: unknown }): boolean {
  const state = isRecord(result.state) ? result.state : {};
  const exchangeStatus = String(state.exchangeStatus || '');
  const hasCallbackUrl = Boolean(state.callbackUrl);
  const hasCodeParam = Boolean(state.codeParam);
  const text = result.message.toLowerCase();
  return exchangeStatus === 'error' &&
    hasCallbackUrl &&
    hasCodeParam &&
    text.includes('oauth token 请求失败') &&
    text.includes('failed to fetch');
}

async function retryOAuthCodeExchangeIfFetchFailed(): Promise<ActionResult> {
  const oauth = await loadOAuthState();
  if (!isRetryableOAuthTokenFetchFailureState(oauth)) {
    return { ok: false, message: '当前 OAuth 状态不需要重试 token 交换' };
  }
  const exchange = await exchangeCurrentOAuthCode(oauth.callbackUrl, OAUTH_FILE_WAIT_MS);
  if (!exchange.ok) {
    return {
      ok: false,
      message: `OAuth token 网络失败后重试仍失败：${exchange.message}`,
    };
  }
  const files = await waitForExistingOAuthFiles(10_000);
  if (!files.ok) {
    return {
      ok: false,
      message: `OAuth token 重试成功，但文件仍未生成：${files.message}`,
    };
  }
  return {
    ok: true,
    message: exchange.message || files.message || 'OAuth token 已重试换取完成',
  };
}

function isRetryableOAuthTokenFetchFailureState(oauth: Awaited<ReturnType<typeof loadOAuthState>>): boolean {
  const text = String(oauth.exchangeMessage || '').toLowerCase();
  return oauth.exchangeStatus === 'error' &&
    Boolean(oauth.callbackUrl) &&
    Boolean(oauth.codeParam) &&
    text.includes('oauth token 请求失败') &&
    text.includes('failed to fetch');
}

async function waitForOAuthAction(
  action: () => Promise<ActionResult>,
  timeoutMs: number,
  timeoutMessage: string,
  context: Pick<OAuthStepContext, 'isStopRequested'>,
): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let started = false;
  let pending: Promise<ActionResult> | null = null;
  while (Date.now() <= deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: 'OAuth 操作已停止' };
    }
    if (!started) {
      started = true;
      pending = action();
    }
    const runningAction = pending;
    if (!runningAction) {
      return { ok: false, message: 'OAuth 操作没有启动' };
    }
    const result = await Promise.race([
      runningAction.then((value) => ({ type: 'result' as const, value })),
      delay(250).then(() => ({ type: 'tick' as const })),
    ]);
    if (result.type === 'result') {
      return result.value;
    }
  }
  return { ok: false, message: timeoutMessage };
}

async function readAutomationTabUrl(tabId: number): Promise<URL | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    return parseUrl(tab.url || '');
  } catch {
    return null;
  }
}

async function advanceExistingOAuthSessionIfNeeded(
  tabId: number,
  context: Pick<OAuthStepContext, 'waitForAutomationTabUrl' | 'waitForAutomationTabComplete' | 'isStopRequested'>,
): Promise<URL | null> {
  const currentUrl = await readAutomationTabUrl(tabId);
  if (!currentUrl) {
    return currentUrl;
  }
  if (isOAuthLoginPasswordUrl(currentUrl)) {
    const password = await fillOAuthLoginPasswordFromRegisterSource(tabId);
    if (!password.ok) {
      return currentUrl;
    }
    const next = await waitForOAuthPostPasswordUrl(context).catch(() => null);
    return next || currentUrl;
  }
  if (!isOAuthChooseAccountUrl(currentUrl)) {
    return currentUrl;
  }

  await context.waitForAutomationTabComplete(20_000).catch(() => null);
  const choose = await waitForOAuthAction(
    () => chooseOAuthExistingAccount(tabId),
    OAUTH_CHOOSE_ACCOUNT_CLICK_TIMEOUT_MS,
    '点击已有账号超时',
    context,
  );
  if (!choose.ok) {
    return currentUrl;
  }
  const next = await context.waitForAutomationTabUrl(
    (url) => isOAuthPostLoginUrl(url),
    60_000,
  ).catch(() => null);
  return next || currentUrl;
}

async function resolveOAuthPostEmailUrl(
  tabId: number,
  result: ActionResult,
  context: Pick<OAuthStepContext, 'waitForAutomationTabUrl'>,
): Promise<URL | null> {
  const fromData = isRecord(result.data) ? parseUrl(String(result.data.url || '')) : null;
  if (fromData && (isOAuthAddPhoneUrl(fromData) || isOAuthConsentUrl(fromData) || isOAuthCallbackUrl(fromData))) {
    return fromData;
  }
  const ready = await context.waitForAutomationTabUrl(
    (url) => isOAuthAddPhoneUrl(url) || isOAuthConsentUrl(url) || isOAuthCallbackUrl(url),
    45_000,
  ).catch(() => null);
  if (ready) {
    return ready;
  }
  try {
    const tab = await browser.tabs.get(tabId);
    return parseUrl(tab.url || '');
  } catch {
    return fromData;
  }
}

function isOAuthPostLoginUrl(url: URL): boolean {
  return isOAuthAddPhoneUrl(url) || isOAuthConsentUrl(url) || isOAuthCallbackUrl(url);
}

async function waitForOAuthLoginEmailSettle(context: Pick<OAuthStepContext, 'isStopRequested'>): Promise<ActionResult> {
  const deadline = Date.now() + OAUTH_LOGIN_EMAIL_SETTLE_MS;
  while (Date.now() < deadline) {
    if (context.isStopRequested()) {
      return { ok: false, message: '填写 OAuth 邮箱已停止' };
    }
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  return { ok: true, message: '登录页已等待 5 秒' };
}

async function waitForOAuthPostEmailUrl(
  context: Pick<OAuthStepContext, 'waitForAutomationTabUrl'>,
): Promise<URL> {
  return context.waitForAutomationTabUrl(
    (url) => isOAuthLoginPasswordUrl(url) || isEmailVerificationUrl(url) || isOAuthPostLoginUrl(url),
    OAUTH_POST_EMAIL_WAIT_MS,
  );
}

async function waitForOAuthPostPasswordUrl(
  context: Pick<OAuthStepContext, 'waitForAutomationTabUrl'>,
): Promise<URL> {
  return context.waitForAutomationTabUrl(
    (url) => isEmailVerificationUrl(url) || isOAuthPostLoginUrl(url),
    OAUTH_POST_EMAIL_WAIT_MS,
  );
}

function isLikelyNavigationResponseClosed(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('message port closed') ||
    normalized.includes('message channel closed') ||
    normalized.includes('receiving end does not exist') ||
    normalized.includes('asynchronous response') ||
    normalized.includes('context invalidated');
}

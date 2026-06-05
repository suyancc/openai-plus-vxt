import { getBrowserTab, sendActiveTabMessage, sendTabMessage } from '../../app/active-tab';
import { PAGE_ACTION } from '../../app/page-actions';
import { loadRegisterState, saveRegisterState } from '../../app/state';
import { parseAccountInput } from './account-input';
import { isPhoneVerificationPath } from './phone-verification-url';
import type { RegisterReadyKind } from './page-ready';
import type { ActionResult, PageState, RegisterState } from './types';
import { countryIsoToCallingCode } from '../oauth-phone/country-map';

export const CHATGPT_REGISTER_URL = 'https://chatgpt.com/auth/login';

const OUTLOOK_OTP_TIMEOUT_MS = 180_000;
const OUTLOOK_OTP_INTERVAL_MS = 5_000;
const REGISTER_ELEMENT_READY_TIMEOUT_MS = 5_000;
const REGISTER_OTP_ELEMENT_READY_TIMEOUT_MS = 30_000;
const REGISTER_PROFILE_ELEMENT_READY_TIMEOUT_MS = 30_000;
const REGISTER_PASSWORD_ELEMENT_READY_TIMEOUT_MS = 15_000;
const REGISTER_EMAIL_NAVIGATION_TIMEOUT_MS = 60_000;
const REGISTER_EMAIL_PAGE_LOAD_TIMEOUT_MS = 20_000;
const REGISTER_PHONE_NAVIGATION_TIMEOUT_MS = 60_000;
const DEFAULT_REGISTER_PHONE_PASSWORD = 'openaiplusvxt';

let autoOutlookOtpStarted = false;

export interface OutlookOtpWaitOptions {
  since?: number;
  timeoutMs?: number;
  intervalMs?: number;
  requireVerificationPage?: boolean;
  tabId?: number;
  ignoreCodes?: string[];
}

interface RegisterEmailSubmitSuccess {
  ok: true;
  submitted: true;
  result: ActionResult;
  parsed: ReturnType<typeof parseAccountInput>;
  canAutoOtp: boolean;
  shouldAutoOtp: boolean;
  apiMessage: string;
}

export async function saveRegisterInput(rawInput: string): Promise<RegisterState> {
  const parsed = parseAccountInput(rawInput);
  return saveRegisterState({
    rawInput,
    email: parsed.email,
    accountLine: parsed.accountLine,
    inputMode: parsed.mode,
    autoOtp: parsed.mode === 'outlook-line',
    otpAutoPending: false,
    otpAutoRunning: false,
    otpJobId: '',
    otpLastMessage: '',
  });
}

export async function openRegisterPage(): Promise<ActionResult> {
  await browser.tabs.create({ url: CHATGPT_REGISTER_URL, active: true });
  return { ok: true, message: '正在打开 ChatGPT 注册页' };
}

export async function getCurrentRegisterPageState(tabId?: number): Promise<PageState> {
  const tab = await getBrowserTab(tabId);
  return pageStateFromUrl(tab?.url || '');
}

export function pageStateFromUrl(rawUrl: string): PageState {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return unknownPageState();
  }

  if (url.hostname === 'chatgpt.com' && url.pathname === '/') {
    return { kind: 'unknown', label: 'ChatGPT 首页', canFillEmail: false, canFillOtp: false, canFillProfile: false };
  }
  if (url.hostname === 'chatgpt.com' && url.pathname.startsWith('/auth/login')) {
    return { kind: 'login', label: 'ChatGPT 登录页', canFillEmail: true, canFillOtp: false, canFillProfile: false };
  }
  if (url.hostname === 'auth.openai.com' && isOpenAiLogInPasswordPath(url.pathname)) {
    return { kind: 'password', label: 'OpenAI 登录密码页', canFillEmail: false, canFillPassword: true, canFillOtp: false, canFillProfile: false };
  }
  if (url.hostname === 'auth.openai.com' && isOpenAiLogInPath(url.pathname)) {
    return { kind: 'login', label: 'OpenAI 登录页', canFillEmail: true, canFillOtp: false, canFillProfile: false };
  }
  if (url.hostname === 'auth.openai.com' && url.pathname.startsWith('/create-account/password')) {
    return { kind: 'password', label: '创建账号密码页', canFillEmail: false, canFillPassword: true, canFillOtp: false, canFillProfile: false };
  }
  if (url.hostname === 'auth.openai.com' && url.pathname.startsWith('/email-verification')) {
    return { kind: 'email-verification', label: '邮箱验证码页', canFillEmail: false, canFillOtp: true, canFillProfile: false };
  }
  if (url.hostname === 'auth.openai.com' && isPhoneVerificationPath(url.pathname)) {
    return { kind: 'phone-verification', label: '手机验证码页', canFillEmail: false, canFillOtp: true, canFillProfile: false };
  }
  if (url.hostname === 'auth.openai.com' && url.pathname.startsWith('/about-you')) {
    return { kind: 'about-you', label: '资料填写页', canFillEmail: false, canFillOtp: false, canFillProfile: true };
  }
  return unknownPageState();
}

export async function fillRegisterEmailFromCurrentInput(tabId?: number): Promise<ActionResult> {
  const submit = await submitRegisterEmailFromCurrentInput(tabId);
  if (!isRegisterEmailSubmitSuccess(submit)) {
    return submit;
  }
  const parsed = submit.parsed;
  const progress = await waitForRegisterEmailProgress(REGISTER_EMAIL_NAVIGATION_TIMEOUT_MS, parsed.email, tabId);
  if (!progress.ok) {
    const debug = await getRegisterDebugState(parsed.email, tabId);
    return failWithData(`${submit.result.message}；${progress.message}`, debug.data || progress.data || submit.result.data);
  }

  return buildRegisterEmailSuccess(submit.result, progress, submit.canAutoOtp, submit.shouldAutoOtp, submit.apiMessage);
}

export async function submitRegisterEmailOnly(tabId?: number): Promise<ActionResult> {
  const submit = await submitRegisterEmailFromCurrentInput(tabId);
  return isRegisterEmailSubmitSuccess(submit) ? submit.result : submit;
}

async function submitRegisterEmailFromCurrentInput(tabId?: number): Promise<RegisterEmailSubmitSuccess | ActionResult> {
  const state = await loadRegisterState();
  const parsed = parseAccountInput(state.rawInput);
  if (!parsed.ok) {
    return fail(parsed.message);
  }

  const page = await getCurrentRegisterPageState(tabId);
  if (!page.canFillEmail) {
    return fail('当前页面不是 ChatGPT 登录页');
  }
  const ready = await waitForRegisterPageReady('email', REGISTER_ELEMENT_READY_TIMEOUT_MS, tabId);
  if (!ready.ok) {
    const debug = await getRegisterDebugState(parsed.email, tabId);
    return failWithData(ready.message, debug.data || ready.data);
  }

  const canAutoOtp = parsed.mode === 'outlook-line';
  const apiCheck = canAutoOtp
    ? await checkLocalOutlookApi(state.apiBase)
    : { ok: false, message: '' };
  const shouldAutoOtp = canAutoOtp && apiCheck.ok;

  await saveRegisterState({
    email: parsed.email,
    accountLine: parsed.accountLine,
    inputMode: parsed.mode,
    autoOtp: canAutoOtp,
    otpRequestedAt: Date.now(),
    otpAutoPending: shouldAutoOtp,
    otpAutoRunning: false,
    otpJobId: '',
    otpLastMessage: canAutoOtp
      ? (shouldAutoOtp ? '本地 Outlook 服务已连接，验证码页会自动接收' : `${apiCheck.message}，验证码需要手动输入`)
      : '',
  });

  let result = await sendPageAction<ActionResult>({ type: PAGE_ACTION.registerFillEmail }, tabId);
  if (!result.ok && isEmailInputRejected(result.message)) {
    const mainWorldResult = await fillRegisterEmailInMainWorld(parsed.email, tabId);
    result = mainWorldResult.ok
      ? {
          ...mainWorldResult,
          message: `${mainWorldResult.message}；已使用页面主环境写入`,
        }
      : {
          ...mainWorldResult,
          message: `${result.message}；主环境写入也失败：${mainWorldResult.message}`,
          data: mainWorldResult.data || result.data,
        };
  }
  if (!result.ok) {
    if (isLikelyNavigationResponseClosed(result.message)) {
      return {
        ok: true,
        submitted: true,
        result: { ok: true, message: '邮箱已提交，页面正在跳转', data: result.data },
        parsed,
        canAutoOtp,
        shouldAutoOtp,
        apiMessage: apiCheck.message,
      };
    }
    const debug = result.data ? result : await getRegisterDebugState(parsed.email, tabId);
    return failWithData(result.message, result.data || debug.data);
  }
  return {
    ok: true,
    submitted: true,
    result,
    parsed,
    canAutoOtp,
    shouldAutoOtp,
    apiMessage: apiCheck.message,
  };
}

function isRegisterEmailSubmitSuccess(value: RegisterEmailSubmitSuccess | ActionResult): value is RegisterEmailSubmitSuccess {
  return Boolean(value.ok && 'submitted' in value && value.submitted);
}

function buildRegisterEmailSuccess(
  result: ActionResult,
  progress: ActionResult,
  canAutoOtp: boolean,
  shouldAutoOtp: boolean,
  apiMessage: string,
): ActionResult {
  const message = `${result.message}；${progress.message}`;
  const suffix = canAutoOtp
    ? (shouldAutoOtp ? '验证码页会自动接收' : `${apiMessage}，验证码需要手动输入`)
    : '验证码需要手动输入';
  return {
    ...result,
    data: progress.data || result.data,
    message: `${message}；${suffix}`,
  };
}

export async function fillEmailOtp(code: string, tabId?: number): Promise<ActionResult> {
  const page = await getCurrentRegisterPageState(tabId);
  if (!page.canFillOtp) {
    return fail('当前页面不是邮箱验证码页');
  }
  const ready = await waitForRegisterPageReady('otp', REGISTER_OTP_ELEMENT_READY_TIMEOUT_MS, tabId);
  if (!ready.ok) {
    return ready;
  }
  return sendPageAction<ActionResult>({ type: PAGE_ACTION.registerFillOtp, code }, tabId);
}

export async function fillRegisterPhoneNumber(phoneNumber: string, countryIso: string, tabId?: number): Promise<ActionResult> {
  const page = await getCurrentRegisterPageState(tabId);
  if (!page.canFillEmail) {
    return fail('当前页面不是 ChatGPT 登录页');
  }
  let result = await sendPageAction<ActionResult>({
    type: PAGE_ACTION.registerFillPhone,
    phoneNumber,
    countryIso,
  }, tabId);
  if (!result.ok && isPhoneInputRejected(result.message)) {
    const mainWorldResult = await fillRegisterPhoneInMainWorld(phoneNumber, countryIso, tabId);
    result = mainWorldResult.ok
      ? {
          ...mainWorldResult,
          message: `${mainWorldResult.message}；已使用页面主环境逐字符输入`,
        }
      : {
          ...mainWorldResult,
          message: `${result.message}；主环境逐字符输入也失败：${mainWorldResult.message}`,
          data: mainWorldResult.data || result.data,
        };
  }
  if (!result.ok && !isLikelyNavigationResponseClosed(result.message)) {
    return result;
  }
  const progress = await waitForRegisterPhoneProgress(REGISTER_PHONE_NAVIGATION_TIMEOUT_MS, tabId);
  if (!progress.ok && isLikelyNavigationResponseClosed(result.message)) {
    return {
      ...progress,
      message: `手机号已提交但等待跳转失败：${progress.message}`,
      data: progress.data || result.data,
    };
  }
  if (!progress.ok) {
    return {
      ...progress,
      message: `${result.message}；${progress.message}`,
      data: progress.data || result.data,
    };
  }
  return {
    ...result,
    ok: true,
    message: `${result.message}；${progress.message}`,
    data: progress.data || result.data,
  };
}

export async function fillRegisterPhoneOtp(code: string, tabId?: number): Promise<ActionResult> {
  const page = await getCurrentRegisterPageState(tabId);
  if (page.kind !== 'phone-verification') {
    return fail('当前页面不是手机验证码页');
  }
  const ready = await waitForRegisterPageReady('phone-otp', REGISTER_OTP_ELEMENT_READY_TIMEOUT_MS, tabId);
  if (!ready.ok) {
    return ready;
  }
  return sendPageAction<ActionResult>({
    type: PAGE_ACTION.registerFillPhoneOtp,
    code,
  }, tabId);
}

export async function waitForOutlookOtpAndSubmit(options: OutlookOtpWaitOptions = {}): Promise<ActionResult> {
  if (options.requireVerificationPage !== false) {
    const page = await getCurrentRegisterPageState(options.tabId);
    if (!page.canFillOtp) {
      return fail('当前页面不是邮箱验证码页');
    }
  }
  const ready = await waitForRegisterPageReady('otp', REGISTER_OTP_ELEMENT_READY_TIMEOUT_MS, options.tabId);
  if (!ready.ok) {
    return ready;
  }

  const state = await loadRegisterState();
  if (!state.accountLine) {
    return fail('当前输入不是 Outlook 账号行，不能自动接收验证码');
  }

  const jobId = makeOtpJobId();
  await saveRegisterState({
    otpAutoRunning: true,
    otpAutoPending: false,
    otpJobId: jobId,
    otpLastStartedAt: Date.now(),
    otpLastMessage: `正在自动接收 ${state.email || accountEmail(state.accountLine)} 的验证码`,
  });

  const response = await browser.runtime.sendMessage({
    type: 'opx:wait-outlook-otp',
    jobId,
    accountLine: state.accountLine,
    apiBase: state.apiBase,
    since: options.since ?? (state.otpRequestedAt || state.updatedAt || Date.now()),
    timeoutMs: options.timeoutMs ?? OUTLOOK_OTP_TIMEOUT_MS,
    intervalMs: options.intervalMs ?? OUTLOOK_OTP_INTERVAL_MS,
    ignoreCodes: options.ignoreCodes,
  });

  if (!isActionResult(response)) {
    await saveRegisterState({
      otpAutoRunning: false,
      otpJobId: '',
      otpLastMessage: 'Outlook API 没有返回有效结果',
    });
    return fail('Outlook API 没有返回有效结果');
  }

  if (!response.ok || !response.code) {
    await saveRegisterState({
      otpAutoRunning: false,
      otpAutoPending: false,
      otpJobId: '',
      otpLastMessage: response.message,
    });
    return response;
  }

  const fillResult = await sendPageAction<ActionResult>({
    type: PAGE_ACTION.registerFillOtp,
    code: response.code,
  }, options.tabId);
  await saveRegisterState({
    otpAutoRunning: false,
    otpAutoPending: false,
    otpJobId: '',
    otpLastMessage: fillResult.ok ? `已收到并提交验证码：${response.code}` : fillResult.message,
  });

  return {
    ...fillResult,
    code: response.code,
    message: fillResult.ok ? `已收到并提交验证码：${response.code}` : fillResult.message,
  };
}

export async function stopOutlookOtp(): Promise<ActionResult> {
  const state = await loadRegisterState();
  const response = await browser.runtime.sendMessage({
    type: 'opx:cancel-outlook-otp',
    jobId: state.otpJobId || undefined,
  });
  const result = isActionResult(response) ? response : { ok: true, message: '已停止 Outlook 验证码接收' };
  await saveRegisterState({
    otpAutoPending: false,
    otpAutoRunning: false,
    otpJobId: '',
    otpLastMessage: result.message,
  });
  autoOutlookOtpStarted = false;
  return result;
}

export async function fillProfileAndCreateAccount(tabId?: number): Promise<ActionResult> {
  const page = await getCurrentRegisterPageState(tabId);
  if (!page.canFillProfile) {
    return fail('当前页面不是资料填写页');
  }
  const ready = await waitForRegisterPageReady('profile', REGISTER_PROFILE_ELEMENT_READY_TIMEOUT_MS, tabId);
  if (!ready.ok) {
    return ready;
  }
  return sendPageAction<ActionResult>({ type: PAGE_ACTION.registerFillProfile }, tabId);
}

export async function skipCreateAccountPasskey(tabId?: number): Promise<ActionResult> {
  const tab = await getBrowserTab(tabId);
  if (!tab || typeof tab.id !== 'number') {
    return fail('没有可操作的当前标签页');
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        function isVisible(element: Element): boolean {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function isClickableButton(button: HTMLButtonElement): boolean {
          return isVisible(button) &&
            !button.disabled &&
            button.getAttribute('aria-disabled') !== 'true' &&
            button.dataset.disabled !== 'true';
        }

        function clickElement(element: HTMLElement): void {
          element.scrollIntoView({ block: 'center', inline: 'center' });
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            element.dispatchEvent(new EventCtor(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: type.endsWith('down') ? 1 : 0,
              pointerId: 1,
              pointerType: 'mouse',
            }));
          }
          element.click();
        }

        if (location.hostname !== 'auth.openai.com' || !location.pathname.startsWith('/create-account-enroll-passkey')) {
          return {
            ok: false,
            message: '当前页面不是 Passkey 设置页',
            data: { url: location.href },
          };
        }

        const exact = document.querySelector<HTMLButtonElement>('button[data-dd-action-name="skip create account enroll passkey"]');
        const button = exact && isClickableButton(exact)
          ? exact
          : Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => {
              if (!isClickableButton(item)) {
                return false;
              }
              const text = (item.textContent || '').trim().toLowerCase();
              const actionName = (item.getAttribute('data-dd-action-name') || '').toLowerCase();
              return text === '跳过' || text === 'skip' || actionName.includes('skip create account enroll passkey');
            }) || null;

        if (!button) {
          return {
            ok: false,
            message: 'Passkey 设置页没有找到跳过按钮',
            data: { url: location.href, buttonFound: false },
          };
        }

        clickElement(button);
        return {
          ok: true,
          message: 'Passkey 设置页已点击跳过',
          data: {
            url: location.href,
            buttonText: (button.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            actionName: button.getAttribute('data-dd-action-name') || '',
          },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResult(result) ? result : fail('Passkey 设置页没有返回有效结果');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function checkRegisterPageReadyNow(kind: RegisterReadyKind, tabId?: number): Promise<ActionResult> {
  return sendPageAction<ActionResult>({
    type: PAGE_ACTION.registerCheckReady,
    kind,
  }, tabId);
}

export async function waitForRegisterPageReady(kind: RegisterReadyKind, timeoutMs: number, tabId?: number): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let last: ActionResult | null = null;
  while (Date.now() <= deadline) {
    const result = await checkRegisterPageReadyNow(kind, tabId);
    if (result.ok) {
      return result;
    }
    last = result;
    await delay(300);
  }
  return last
    ? failWithData(`等待页面控件渲染超时：${last.message}`, last.data)
    : fail('等待页面控件渲染超时');
}

async function waitForRegisterEmailProgress(navigationTimeoutMs: number, email: string, tabId?: number): Promise<ActionResult> {
  const startedAt = Date.now();
  const deadline = startedAt + navigationTimeoutMs;
  let lastUrl = '';
  let lastKind = 'unknown';
  let lastStatus = '';

  while (Date.now() <= deadline) {
    const tab = await getBrowserTab(tabId);
    lastUrl = tab?.url || '';
    lastStatus = tab?.status || '';
    const page = pageStateFromUrl(lastUrl);
    lastKind = page.kind;
    if (page.kind === 'password') {
      const load = await waitForTabComplete(REGISTER_EMAIL_PAGE_LOAD_TIMEOUT_MS, tabId);
      const passwordResult = await fillOpenAiPassword(passwordFromEmail(email), tabId);
      if (!passwordResult.ok) {
        const passwordData = isObjectRecord(passwordResult.data) ? passwordResult.data : {};
        return failWithData(
          `已进入创建账号密码页，但密码填写失败：${passwordResult.message}`,
          {
            ...passwordData,
            url: lastUrl,
            pageKind: page.kind,
            tabStatus: actionDataStatus(load.data) || lastStatus,
            loadMessage: load.message,
            navigationMs: Date.now() - startedAt,
          },
        );
      }
      await delay(500);
      continue;
    }
    if (page.kind === 'email-verification') {
      const load = await waitForTabComplete(REGISTER_EMAIL_PAGE_LOAD_TIMEOUT_MS, tabId);
      const ready = await waitForRegisterPageReady('otp', REGISTER_OTP_ELEMENT_READY_TIMEOUT_MS, tabId);
      if (!ready.ok) {
        return {
          ok: true,
          message: load.ok
            ? `已进入邮箱验证码页，验证码输入框暂未就绪，将在第 5 步继续等待：${ready.message}`
            : `已进入邮箱验证码页，页面加载未完成或验证码输入框暂未就绪，将在第 5 步继续等待：${load.message}；${ready.message}`,
          data: {
            url: lastUrl,
            pageKind: page.kind,
            tabStatus: actionDataStatus(load.data) || lastStatus,
            loadMessage: load.message,
            readyMessage: ready.message,
            otpReadyPending: true,
            navigationMs: Date.now() - startedAt,
          },
        };
      }
      return {
        ok: true,
        message: '已进入邮箱验证码页，验证码输入框已就绪',
        data: {
          url: lastUrl,
          pageKind: page.kind,
          tabStatus: actionDataStatus(load.data) || lastStatus,
          loadMessage: load.message,
          readyMessage: ready.message,
          navigationMs: Date.now() - startedAt,
        },
      };
    }
    await delay(350);
  }

  return {
    ok: false,
    message: `提交邮箱后 ${Math.round(navigationTimeoutMs / 1000)} 秒内没有跳转到邮箱验证码页，最后页面：${shortUrl(lastUrl) || '未知'}`,
    data: { url: lastUrl, pageKind: lastKind, tabStatus: lastStatus },
  };
}

async function waitForRegisterPhoneProgress(navigationTimeoutMs: number, tabId?: number): Promise<ActionResult> {
  const startedAt = Date.now();
  const deadline = startedAt + navigationTimeoutMs;
  let lastUrl = '';
  let lastKind = 'unknown';
  let lastStatus = '';
  let passwordAttempts = 0;
  let lastPasswordAttemptAt = 0;
  let lastPasswordResult: ActionResult | null = null;
  let lastPasswordLoad: ActionResult | null = null;

  while (Date.now() <= deadline) {
    const tab = await getBrowserTab(tabId);
    lastUrl = tab?.url || '';
    lastStatus = tab?.status || '';
    const page = pageStateFromUrl(lastUrl);
    lastKind = page.kind;
    if (page.kind === 'password') {
      const shouldSubmitPassword = passwordAttempts === 0 || Date.now() - lastPasswordAttemptAt >= 6_000;
      if (shouldSubmitPassword) {
        const load = await waitForTabComplete(REGISTER_EMAIL_PAGE_LOAD_TIMEOUT_MS, tabId);
        lastPasswordLoad = load;
        const passwordResult = await fillOpenAiPassword(DEFAULT_REGISTER_PHONE_PASSWORD, tabId);
        passwordAttempts += 1;
        lastPasswordAttemptAt = Date.now();
        lastPasswordResult = passwordResult;
        if (!passwordResult.ok) {
          const passwordData = isObjectRecord(passwordResult.data) ? passwordResult.data : {};
          return failWithData(
            `已进入手机号注册密码页，但默认密码填写失败：${passwordResult.message}`,
            {
              ...passwordData,
              url: lastUrl,
              pageKind: page.kind,
              tabStatus: actionDataStatus(load.data) || lastStatus,
              loadMessage: load.message,
              passwordAttempts,
              defaultPasswordLength: DEFAULT_REGISTER_PHONE_PASSWORD.length,
              navigationMs: Date.now() - startedAt,
            },
          );
        }
      }
      await delay(700);
      continue;
    }
    if (page.kind === 'phone-verification') {
      const load = await waitForTabComplete(REGISTER_EMAIL_PAGE_LOAD_TIMEOUT_MS, tabId);
      const ready = await waitForRegisterPageReady('phone-otp', REGISTER_OTP_ELEMENT_READY_TIMEOUT_MS, tabId);
      if (!ready.ok) {
        return {
          ok: true,
          message: load.ok
            ? `已进入手机验证码页，验证码输入框暂未就绪，将在第 5 步继续等待：${ready.message}`
            : `已进入手机验证码页，页面加载未完成或验证码输入框暂未就绪，将在第 5 步继续等待：${load.message}；${ready.message}`,
          data: {
            url: lastUrl,
            pageKind: page.kind,
            tabStatus: actionDataStatus(load.data) || lastStatus,
            loadMessage: load.message,
            readyMessage: ready.message,
            otpReadyPending: true,
            navigationMs: Date.now() - startedAt,
          },
        };
      }
      return {
        ok: true,
        message: '已进入手机验证码页，验证码输入框已就绪',
        data: {
          url: lastUrl,
          pageKind: page.kind,
          tabStatus: actionDataStatus(load.data) || lastStatus,
          loadMessage: load.message,
          readyMessage: ready.message,
          navigationMs: Date.now() - startedAt,
        },
      };
    }
    if (page.kind === 'about-you') {
      return {
        ok: true,
        message: '手机号已验证，页面已进入资料填写页',
        data: {
          url: lastUrl,
          pageKind: page.kind,
          tabStatus: lastStatus,
          navigationMs: Date.now() - startedAt,
          skippedOtpFill: true,
        },
      };
    }
    await delay(350);
  }

  return {
    ok: false,
    message: `提交手机号后 ${Math.round(navigationTimeoutMs / 1000)} 秒内没有跳转到手机验证码页，最后页面：${shortUrl(lastUrl) || '未知'}`,
    data: {
      url: lastUrl,
      pageKind: lastKind,
      tabStatus: lastStatus,
      passwordAttempts,
      lastPasswordMessage: lastPasswordResult?.message || '',
      lastPasswordData: lastPasswordResult?.data || null,
      lastPasswordLoadMessage: lastPasswordLoad?.message || '',
      defaultPasswordLength: DEFAULT_REGISTER_PHONE_PASSWORD.length,
      navigationMs: Date.now() - startedAt,
    },
  };
}

export async function fillOpenAiPassword(password: string, tabId?: number): Promise<ActionResult> {
  const tab = await getBrowserTab(tabId);
  if (!tab || typeof tab.id !== 'number') {
    return fail('没有可操作的当前标签页');
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [password, REGISTER_PASSWORD_ELEMENT_READY_TIMEOUT_MS],
      func: async (targetPassword: string, readyTimeoutMs: number) => {
        function isVisible(element: Element): boolean {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function findPasswordInput(): HTMLInputElement | null {
          const selectors = [
            'form[action="/log-in/password"] input[name="current-password"]',
            'form[action="/create-account/password"] input[name="new-password"]',
            'input[name="current-password"]',
            'input[name="new-password"]',
            'input[autocomplete~="current-password"]',
            'input[autocomplete="new-password"]',
            'input[id$="-current-password"]',
            'input[id$="-new-password"]',
            'input[placeholder="密码"]',
            'input[placeholder="Password"]',
            'input[type="password"]',
          ];
          for (const selector of selectors) {
            const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector))
              .find((candidate) => isVisible(candidate) && !candidate.disabled && !candidate.readOnly && candidate.isConnected);
            if (input) {
              return input;
            }
          }
          return null;
        }

        async function waitForPasswordInput(timeoutMs: number): Promise<HTMLInputElement | null> {
          const started = Date.now();
          let input = findPasswordInput();
          while (!input && Date.now() - started < timeoutMs) {
            await new Promise((resolve) => window.setTimeout(resolve, 150));
            input = findPasswordInput();
          }
          return input;
        }

        function isClickableButton(button: HTMLButtonElement): boolean {
          return isVisible(button) &&
            !button.disabled &&
            button.getAttribute('aria-disabled') !== 'true' &&
            button.dataset.disabled !== 'true';
        }

        function sleep(ms: number): Promise<void> {
          return new Promise((resolve) => window.setTimeout(resolve, ms));
        }

        async function waitForClickableButton(button: HTMLButtonElement, timeoutMs: number): Promise<boolean> {
          const started = Date.now();
          while (Date.now() - started < timeoutMs) {
            if (isClickableButton(button)) {
              return true;
            }
            await sleep(100);
          }
          return isClickableButton(button);
        }

        function setNativeValue(input: HTMLInputElement, value: string): void {
          const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
          const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          const setter = prototypeDescriptor?.set || ownDescriptor?.set;
          if (setter) {
            setter.call(input, value);
            return;
          }
          input.value = value;
        }

        function dispatchInputEvent(input: HTMLInputElement, data: string): void {
          try {
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: false,
              composed: true,
              data,
              inputType: 'insertText',
            }));
          } catch {
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function clickElement(element: HTMLElement): void {
          element.scrollIntoView({ block: 'center', inline: 'center' });
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            element.dispatchEvent(new EventCtor(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: type.endsWith('down') ? 1 : 0,
              pointerId: 1,
              pointerType: 'mouse',
            }));
          }
          element.click();
        }

        function findSubmitButton(): HTMLButtonElement | null {
          const selectors = [
            'form[action="/log-in/password"] button[type="submit"][name="intent"][value="validate"]',
            'form[action="/log-in/password"] button[type="submit"]',
            'form[action="/create-account/password"] button[type="submit"]',
            'button[data-dd-action-name="Continue"]',
            'button[type="submit"]',
          ];
          for (const selector of selectors) {
            const button = document.querySelector<HTMLButtonElement>(selector);
            if (button && isVisible(button)) {
              return button;
            }
          }
          return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
            const text = (button.textContent || '').trim().toLowerCase();
            return isVisible(button) && (text === '继续' || text === 'continue');
          }) || null;
        }

        const passwordInput = await waitForPasswordInput(readyTimeoutMs);
        if (!passwordInput) {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).map((input) => ({
            type: input.type,
            name: input.name,
            id: input.id,
            autocomplete: input.autocomplete,
            placeholder: input.placeholder,
            disabled: input.disabled,
            readOnly: input.readOnly,
            visible: isVisible(input),
          }));
          return {
            ok: false,
            message: `没有找到密码输入框（等待 ${Math.round(readyTimeoutMs / 1000)} 秒）`,
            data: { url: location.href, readyState: document.readyState, inputs },
          };
        }

        passwordInput.scrollIntoView({ block: 'center', inline: 'center' });
        passwordInput.focus({ preventScroll: true });
        try {
          passwordInput.setSelectionRange(0, passwordInput.value.length);
        } catch {
          // Ignore selection failures on password fields.
        }
        setNativeValue(passwordInput, targetPassword);
        dispatchInputEvent(passwordInput, targetPassword);
        await sleep(250);

        if (passwordInput.value !== targetPassword) {
          return {
            ok: false,
            message: '密码输入框没有接受输入值',
            data: {
              url: location.href,
              readyState: document.readyState,
              valueLength: passwordInput.value.length,
              expectedLength: targetPassword.length,
            },
          };
        }

        const button = findSubmitButton();
        const buttonData = button
          ? {
              buttonFound: true,
              buttonText: (button.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
              buttonDisabled: button.disabled,
              buttonAriaDisabled: button.getAttribute('aria-disabled') || '',
              buttonType: button.type,
              buttonName: button.name,
              buttonValue: button.value,
            }
          : { buttonFound: false };
        if (!button) {
          return {
            ok: false,
            message: '没有找到密码页继续按钮',
            data: { url: location.href, readyState: document.readyState, passwordLength: passwordInput.value.length, ...buttonData },
          };
        }

        const clickable = await waitForClickableButton(button, 5_000);
        if (!clickable) {
          return {
            ok: false,
            message: '密码页继续按钮未变为可点击',
            data: {
              url: location.href,
              readyState: document.readyState,
              passwordLength: passwordInput.value.length,
              ...buttonData,
              buttonDisabledAfterWait: button.disabled,
              buttonAriaDisabledAfterWait: button.getAttribute('aria-disabled') || '',
            },
          };
        }

        clickElement(button);
        await sleep(300);
        return {
          ok: true,
          message: '已填写密码并点击继续',
          data: {
            url: location.href,
            readyState: document.readyState,
            passwordLength: targetPassword.length,
            ...buttonData,
            buttonDisabledAfterWait: button.disabled,
            buttonAriaDisabledAfterWait: button.getAttribute('aria-disabled') || '',
          },
        };
      },
    });
    const result = results[0]?.result;
    return isActionResult(result) ? result : fail('密码页没有返回有效结果');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function passwordFromEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function waitForTabComplete(timeoutMs: number, tabId?: number): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  while (Date.now() <= deadline) {
    const tab = await getBrowserTab(tabId);
    lastStatus = tab?.status || '';
    if (!lastStatus) {
      return { ok: true, message: '浏览器未返回加载状态', data: { status: lastStatus } };
    }
    if (lastStatus === 'complete') {
      return { ok: true, message: '页面加载完成', data: { status: lastStatus } };
    }
    await delay(250);
  }

  return {
    ok: false,
    message: `等待页面加载完成超时，最后状态：${lastStatus || '未知'}`,
    data: { status: lastStatus },
  };
}

export async function autoStartOutlookOtpIfNeeded(): Promise<void> {
  if (autoOutlookOtpStarted) {
    return;
  }

  const page = await getCurrentRegisterPageState();
  if (!page.canFillOtp) {
    return;
  }

  const state = await loadRegisterState();
  if (!state.autoOtp || !state.otpAutoPending || state.otpAutoRunning || !state.accountLine) {
    return;
  }

  autoOutlookOtpStarted = true;
  const apiCheck = await checkLocalOutlookApi(state.apiBase);
  if (!apiCheck.ok) {
    autoOutlookOtpStarted = false;
    await saveRegisterState({
      otpAutoPending: false,
      otpAutoRunning: false,
      otpJobId: '',
      otpLastMessage: `${apiCheck.message}，已切换为手动验证码`,
    });
    return;
  }

  void waitForOutlookOtpAndSubmit().finally(() => {
    autoOutlookOtpStarted = false;
  });
}

export async function checkLocalOutlookApi(apiBase: string): Promise<ActionResult> {
  const response = await browser.runtime.sendMessage({
    type: 'opx:check-outlook-api',
    apiBase,
  });
  return isActionResult(response)
    ? response
    : { ok: false, message: '本地 Outlook 服务没有返回有效状态' };
}

async function sendPageAction<T extends ActionResult>(message: unknown, tabId?: number): Promise<T> {
  try {
    const response = typeof tabId === 'number' && tabId > 0
      ? await sendTabMessage<unknown>(message, tabId)
      : await sendActiveTabMessage<unknown>(message);
    if (isActionResult(response)) {
      return response as T;
    }
    return fail('页面脚本没有返回有效结果，请刷新当前页面后重试') as T;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error)) as T;
  }
}

async function getRegisterDebugState(expectedEmail: string, tabId?: number): Promise<ActionResult> {
  return sendPageAction<ActionResult>({
    type: PAGE_ACTION.registerDebugState,
    expectedEmail,
  }, tabId);
}

async function fillRegisterEmailInMainWorld(email: string, tabId?: number): Promise<ActionResult> {
  const tab = await getBrowserTab(tabId);
  if (!tab || typeof tab.id !== 'number') {
    return fail('没有可操作的当前标签页');
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [email],
      func: async (targetEmail: string) => {
        const emailSelectors = [
          '[data-testid="login-form"] input#email[name="email"][type="email"]',
          '[data-testid="login-form"] input[name="email"][type="email"]',
          'form input#email[name="email"][type="email"]',
          'form[aria-label="选择登录选项"] input[name="email"][type="email"]',
          'input#email',
          'input[id$="-email"]',
          'input[name="email"]',
          'input[type="email"]',
          'input[autocomplete="email"]',
        ];
        const buttonSelectors = [
          '[data-testid="login-form"] button[type="submit"]',
          'button[name="intent"][value="email"]',
          'button[data-dd-action-name="Continue"]',
          'button[type="submit"]',
          'form button:not([type="button"])',
        ];

        function isVisible(element: Element): boolean {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function isWritableInput(input: HTMLInputElement): boolean {
          return isVisible(input) && !input.disabled && !input.readOnly && input.isConnected;
        }

        function isClickableButton(button: HTMLButtonElement): boolean {
          return isVisible(button) &&
            !button.disabled &&
            button.getAttribute('aria-disabled') !== 'true' &&
            button.dataset.disabled !== 'true';
        }

        function sleep(ms: number): Promise<void> {
          return new Promise((resolve) => window.setTimeout(resolve, ms));
        }

        async function waitForWritableInput(input: HTMLInputElement, timeoutMs: number): Promise<void> {
          const started = Date.now();
          while (!isWritableInput(input) && Date.now() - started < timeoutMs) {
            await sleep(100);
          }
        }

        async function waitForClickableButton(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
          const started = Date.now();
          while (!isClickableButton(button) && Date.now() - started < timeoutMs) {
            await sleep(100);
          }
        }

        function findVisible<T extends Element>(selectors: string[]): T | null {
          for (const selector of selectors) {
            const element = Array.from(document.querySelectorAll<T>(selector)).find(isVisible);
            if (element) {
              return element;
            }
          }
          return null;
        }

        function findButton(): HTMLButtonElement | null {
          const matched = findVisible<HTMLButtonElement>(buttonSelectors);
          if (matched) {
            return matched;
          }
          return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
            if (!isVisible(button)) {
              return false;
            }
            const text = (button.textContent || '').trim().toLowerCase();
            return text === '继续' || text === 'continue';
          }) || null;
        }

        function sameEmail(left: string, right: string): boolean {
          return left.trim().toLowerCase() === right.trim().toLowerCase();
        }

        function setNativeValue(input: HTMLInputElement, value: string): void {
          const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
          const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          const setter = prototypeDescriptor?.set || ownDescriptor?.set;
          if (setter) {
            setter.call(input, value);
            return;
          }
          input.value = value;
        }

        function dispatchInput(input: HTMLInputElement, value: string, inputType: string): void {
          try {
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              composed: true,
              data: value,
              inputType,
            }));
          } catch {
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        function clickElement(element: HTMLElement): void {
          element.scrollIntoView({ block: 'center', inline: 'center' });
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            element.dispatchEvent(new EventCtor(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: type.endsWith('down') ? 1 : 0,
              pointerId: 1,
              pointerType: 'mouse',
            }));
          }
          element.click();
        }

        const input = findVisible<HTMLInputElement>(emailSelectors);
        if (!input) {
          return {
            ok: false,
            message: '主环境没有找到邮箱输入框',
            data: { fillMethod: 'main-world', inputFound: false, url: location.href },
          };
        }

        await waitForWritableInput(input, 3500);
        if (!isWritableInput(input)) {
          return {
            ok: false,
            message: '主环境邮箱输入框仍然不可写',
            data: {
              fillMethod: 'main-world',
              inputFound: true,
              inputDisabled: input.disabled,
              inputReadOnly: input.readOnly,
              inputConnected: input.isConnected,
              url: location.href,
              readyState: document.readyState,
            },
          };
        }

        input.scrollIntoView({ block: 'center', inline: 'center' });
        clickElement(input);
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(0, input.value.length);
        } catch {
          // Ignore selection failures for email inputs.
        }

        setNativeValue(input, '');
        dispatchInput(input, '', 'deleteContentBackward');
        setNativeValue(input, targetEmail);
        dispatchInput(input, targetEmail, 'insertText');
        input.dispatchEvent(new Event('change', { bubbles: true }));

        if (!sameEmail(input.value, targetEmail)) {
          try {
            input.setSelectionRange(0, input.value.length);
            input.setRangeText(targetEmail, 0, input.value.length, 'end');
            dispatchInput(input, targetEmail, 'insertReplacementText');
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch {
            // Keep the native setter result.
          }
        }

        if (!sameEmail(input.value, targetEmail)) {
          return {
            ok: false,
            message: '主环境邮箱输入框没有接受输入值',
            data: {
              fillMethod: 'main-world',
              inputFound: true,
              inputValueLength: input.value.length,
              expectedLength: targetEmail.length,
              inputMatchesExpected: false,
              inputDisabled: input.disabled,
              inputReadOnly: input.readOnly,
              inputConnected: input.isConnected,
              url: location.href,
            },
          };
        }

        const button = findButton();
        if (!button) {
          return {
            ok: false,
            message: '主环境没有找到继续按钮',
            data: {
              fillMethod: 'main-world',
              inputFound: true,
              inputValueLength: input.value.length,
              expectedLength: targetEmail.length,
              inputMatchesExpected: true,
              buttonFound: false,
              url: location.href,
            },
          };
        }

        await waitForClickableButton(button, 3500);
        if (!isClickableButton(button)) {
          return {
            ok: false,
            message: '主环境继续按钮仍然不可点击',
            data: {
              fillMethod: 'main-world',
              inputFound: true,
              inputValueLength: input.value.length,
              expectedLength: targetEmail.length,
              inputMatchesExpected: true,
              buttonFound: true,
              buttonText: (button.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
              buttonDisabled: button.disabled,
              buttonAriaDisabled: button.getAttribute('aria-disabled') || '',
              url: location.href,
              readyState: document.readyState,
            },
          };
        }

        clickElement(button);
        return {
          ok: true,
          message: '主环境已填入邮箱并点击继续',
          data: {
            fillMethod: 'main-world',
            fillMethodOk: true,
            inputFound: true,
            inputValueLength: input.value.length,
            expectedLength: targetEmail.length,
            inputMatchesExpected: true,
            buttonFound: true,
            buttonText: (button.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            buttonDisabled: button.disabled,
            url: location.href,
            readyState: document.readyState,
          },
        };
      },
    });
    const value = results[0]?.result;
    return isActionResult(value)
      ? value
      : fail('主环境脚本没有返回有效结果');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function fillRegisterPhoneInMainWorld(
  phoneNumber: string,
  countryIso: string,
  tabId?: number,
): Promise<ActionResult> {
  const tab = await getBrowserTab(tabId);
  if (!tab || typeof tab.id !== 'number') {
    return fail('没有可操作的当前标签页');
  }

  const candidates = phoneInputCandidates(phoneNumber, countryIso);
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [candidates],
      func: async (targetValues: string[]) => {
        const phoneSelectors = [
          'input#phoneNumberInput',
          'input[name="phoneNumberInput"]',
          'input[type="tel"]',
          'input[autocomplete="tel"]',
          'input[name*="phone" i]',
          'input[id*="phone" i]',
          'input[inputmode="tel"]',
          'input[inputmode="numeric"]',
        ];
        const continueLabels = ['继续', 'continue', '下一步', 'next'];

        function sleep(ms: number): Promise<void> {
          return new Promise((resolve) => window.setTimeout(resolve, ms));
        }

        function isVisible(element: Element): boolean {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0;
        }

        function isWritableInput(input: HTMLInputElement): boolean {
          return isVisible(input) && !input.disabled && !input.readOnly && input.isConnected;
        }

        function isClickableButton(button: HTMLButtonElement): boolean {
          return isVisible(button) &&
            !button.disabled &&
            button.getAttribute('aria-disabled') !== 'true' &&
            button.dataset.disabled !== 'true';
        }

        function findPhoneInput(): HTMLInputElement | null {
          for (const selector of phoneSelectors) {
            const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector)).find(isVisible);
            if (input) {
              return input;
            }
          }
          return null;
        }

        function findContinueButton(): HTMLButtonElement | null {
          for (const selector of [
            'button[type="submit"]',
            'button[data-dd-action-name="Continue"]',
            'form button:not([type="button"])',
          ]) {
            const button = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find(isVisible);
            if (button) {
              return button;
            }
          }
          return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
            if (!isVisible(button)) {
              return false;
            }
            const text = (button.textContent || button.ariaLabel || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return continueLabels.some((label) => text.includes(label));
          }) || null;
        }

        function clickElement(element: HTMLElement): void {
          element.scrollIntoView({ block: 'center', inline: 'center' });
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            element.dispatchEvent(new EventCtor(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              button: 0,
              buttons: type.endsWith('down') ? 1 : 0,
              pointerId: 1,
              pointerType: 'mouse',
            }));
          }
          element.click();
        }

        function setNativeValue(input: HTMLInputElement, value: string): void {
          const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
          const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          const setter = prototypeDescriptor?.set || ownDescriptor?.set;
          if (setter) {
            setter.call(input, value);
            return;
          }
          input.value = value;
        }

        function dispatchTextInput(input: HTMLInputElement, text: string): void {
          try {
            input.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              composed: true,
              inputType: 'insertText',
              data: text,
            }));
          } catch {
            // Older pages may not allow constructing beforeinput.
          }
          try {
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              composed: true,
              inputType: 'insertText',
              data: text,
            }));
          } catch {
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        function dispatchKeyboard(input: HTMLInputElement, key: string): void {
          for (const type of ['keydown', 'keypress', 'keyup']) {
            input.dispatchEvent(new KeyboardEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              key,
              code: key === '+' ? 'Equal' : `Digit${key}`,
              charCode: key.length === 1 ? key.charCodeAt(0) : 0,
              keyCode: key.length === 1 ? key.charCodeAt(0) : 0,
              which: key.length === 1 ? key.charCodeAt(0) : 0,
            }));
          }
        }

        async function clearInput(input: HTMLInputElement): Promise<void> {
          input.scrollIntoView({ block: 'center', inline: 'center' });
          clickElement(input);
          input.focus({ preventScroll: true });
          try {
            input.setSelectionRange(0, input.value.length);
          } catch {
            // Ignore selection failures on formatted phone controls.
          }
          setNativeValue(input, '');
          input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'deleteContentBackward',
            data: '',
          }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(120);
        }

        async function typeLikeUser(input: HTMLInputElement, value: string): Promise<void> {
          for (const char of value) {
            dispatchKeyboard(input, char);
            const next = `${input.value}${char}`;
            setNativeValue(input, next);
            dispatchTextInput(input, char);
            await sleep(55);
          }
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          input.focus({ preventScroll: true });
          await sleep(260);
        }

        function digits(value: string): string {
          return value.replace(/[^\d]/g, '');
        }

        function inputMatches(input: HTMLInputElement, expected: string): boolean {
          const actualDigits = digits(input.value);
          const expectedDigits = digits(expected);
          return Boolean(actualDigits && expectedDigits && (
            actualDigits.includes(expectedDigits.slice(-7)) ||
            expectedDigits.includes(actualDigits)
          ));
        }

        function countryButtonText(): string {
          return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
            .filter(isVisible)
            .map((button) => (button.textContent || button.ariaLabel || '').replace(/\s+/g, ' ').trim())
            .find((text) => /\+\(\d+\)|\+\d+/.test(text)) || '';
        }

        const input = findPhoneInput();
        if (!input) {
          return {
            ok: false,
            message: '主环境没有找到手机号输入框',
            data: { fillMethod: 'main-world-phone', inputFound: false, url: location.href },
          };
        }
        if (!isWritableInput(input)) {
          const started = Date.now();
          while (!isWritableInput(input) && Date.now() - started < 3500) {
            await sleep(100);
          }
        }
        if (!isWritableInput(input)) {
          return {
            ok: false,
            message: '主环境手机号输入框仍然不可写',
            data: {
              fillMethod: 'main-world-phone',
              inputFound: true,
              inputDisabled: input.disabled,
              inputReadOnly: input.readOnly,
              inputConnected: input.isConnected,
              url: location.href,
              readyState: document.readyState,
            },
          };
        }

        const attempts: Array<Record<string, unknown>> = [];
        for (const candidate of targetValues) {
          await clearInput(input);
          await typeLikeUser(input, candidate);
          attempts.push({
            candidateLength: candidate.length,
            candidateTail: digits(candidate).slice(-4),
            value: input.value,
            valueLength: input.value.length,
            valueDigits: digits(input.value),
            countryButton: countryButtonText(),
          });
          if (inputMatches(input, candidate)) {
            const button = findContinueButton();
            if (!button) {
              return {
                ok: false,
                message: '主环境没有找到手机号继续按钮',
                data: {
                  fillMethod: 'main-world-phone',
                  inputFound: true,
                  inputValueLength: input.value.length,
                  attempts,
                  buttonFound: false,
                  url: location.href,
                },
              };
            }
            const started = Date.now();
            while (!isClickableButton(button) && Date.now() - started < 3500) {
              await sleep(100);
            }
            if (!isClickableButton(button)) {
              return {
                ok: false,
                message: '主环境手机号继续按钮仍然不可点击',
                data: {
                  fillMethod: 'main-world-phone',
                  inputFound: true,
                  inputValueLength: input.value.length,
                  attempts,
                  buttonFound: true,
                  buttonText: (button.textContent || button.ariaLabel || '').replace(/\s+/g, ' ').trim(),
                  buttonDisabled: button.disabled,
                  url: location.href,
                },
              };
            }
            clickElement(button);
            return {
              ok: true,
              message: '主环境已逐字符填入手机号并点击继续',
              data: {
                fillMethod: 'main-world-phone',
                fillMethodOk: true,
                inputFound: true,
                inputValueLength: input.value.length,
                inputValue: input.value,
                attempts,
                buttonFound: true,
                buttonText: (button.textContent || button.ariaLabel || '').replace(/\s+/g, ' ').trim(),
                url: location.href,
                readyState: document.readyState,
              },
            };
          }
        }

        return {
          ok: false,
          message: '主环境手机号输入框没有接受逐字符输入值',
          data: {
            fillMethod: 'main-world-phone',
            inputFound: true,
            inputValueLength: input.value.length,
            inputValue: input.value,
            attempts,
            url: location.href,
            readyState: document.readyState,
          },
        };
      },
    });
    const value = results[0]?.result;
    return isActionResult(value)
      ? value
      : fail('主环境手机号脚本没有返回有效结果');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function phoneInputCandidates(phoneNumber: string, countryIso: string): string[] {
  const raw = phoneNumber.trim();
  const digits = raw.replace(/[^\d]/g, '');
  const callingCode = countryIsoToCallingCode(countryIso);
  const full = callingCode && digits && !digits.startsWith(callingCode)
    ? `+${callingCode}${digits}`
    : (raw.startsWith('+') ? raw : `+${digits}`);
  const local = callingCode && digits.startsWith(callingCode)
    ? digits.slice(callingCode.length)
    : digits;
  return Array.from(new Set([full, local].filter(Boolean)));
}

function unknownPageState(): PageState {
  return {
    kind: 'unknown',
    label: '未识别页面',
    canFillEmail: false,
    canFillOtp: false,
    canFillProfile: false,
  };
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function failWithData(message: string, data: unknown): ActionResult {
  return { ok: false, message, data };
}

function isLikelyNavigationResponseClosed(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('message port closed') ||
    normalized.includes('message channel closed') ||
    normalized.includes('message channel is closed') ||
    normalized.includes('extension port') ||
    normalized.includes('back/forward cache') ||
    normalized.includes('back-forward cache') ||
    normalized.includes('bfcache') ||
    normalized.includes('receiving end does not exist') ||
    normalized.includes('asynchronous response') ||
    normalized.includes('context invalidated');
}

function isEmailInputRejected(message: string): boolean {
  return message.includes('邮箱输入框没有接受输入值') ||
    message.includes('点击继续后邮箱输入值丢失');
}

function isPhoneInputRejected(message: string): boolean {
  return message.includes('手机号输入框没有接受输入值') ||
    message.includes('点击继续后手机号输入值丢失');
}

function actionDataStatus(data: unknown): string {
  return data && typeof data === 'object' && 'status' in data
    ? String((data as { status?: unknown }).status || '')
    : '';
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value.slice(0, 100);
  }
}

function isActionResult(value: unknown): value is ActionResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ActionResult).ok === 'boolean' &&
      typeof (value as ActionResult).message === 'string',
  );
}

function makeOtpJobId(): string {
  return `otp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function accountEmail(accountLine: string): string {
  return accountLine.split('----', 1)[0] || 'Outlook 邮箱';
}

function isOpenAiLogInPath(pathname: string): boolean {
  return pathname === '/log-in' || pathname.startsWith('/log-in/');
}

function isOpenAiLogInPasswordPath(pathname: string): boolean {
  return pathname === '/log-in/password' || pathname.startsWith('/log-in/password/');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

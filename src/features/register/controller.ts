import { fillEmailAndContinue, isChatGptLoginPage } from './chatgpt-auth-page';
import { fillOtpAndContinue, isEmailVerificationPage } from './openai-email-verification-page';
import { fillAboutYouAndCreate, isAboutYouPage } from './openai-about-you-page';
import { parseAccountInput } from './account-input';
import { loadRegisterState, saveRegisterState } from '../../app/state';
import type { ActionResult, PageState, RegisterController } from './types';

let autoProfileStarted = false;
let autoOtpStarted = false;
const CHATGPT_REGISTER_URL = 'https://chatgpt.com/auth/login';
const OUTLOOK_OTP_TIMEOUT_MS = 180_000;
const OUTLOOK_OTP_INTERVAL_MS = 5_000;

export function createRegisterController(): RegisterController {
  return {
    getPageState,
    loadState: loadRegisterState,
    saveInput: async (rawInput: string) => {
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
    },
    openRegisterPage: async () => {
      location.assign(CHATGPT_REGISTER_URL);
      return { ok: true, message: '正在打开 ChatGPT 注册页' };
    },
    fillEmailFromInput: async () => {
      const state = await loadRegisterState();
      const parsed = parseAccountInput(state.rawInput);
      if (!parsed.ok) {
        return fail(parsed.message);
      }
      if (!isChatGptLoginPage()) {
        return fail('当前页面不是 ChatGPT 登录页');
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
      const result = await fillEmailAndContinue(parsed.email);
      if (!canAutoOtp || !result.ok) {
        return result;
      }
      return {
        ...result,
        message: shouldAutoOtp
          ? `${result.message}；验证码页会自动接收`
          : `${result.message}；${apiCheck.message}，验证码需要手动输入`,
      };
    },
    fillOtp: async (code: string) => {
      if (!isEmailVerificationPage()) {
        return fail('当前页面不是邮箱验证码页');
      }
      return fillOtpAndContinue(code);
    },
    waitForOutlookOtp: async () => {
      if (!isEmailVerificationPage()) {
        return fail('当前页面不是邮箱验证码页');
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
        since: state.otpRequestedAt || state.updatedAt || Date.now(),
        timeoutMs: OUTLOOK_OTP_TIMEOUT_MS,
        intervalMs: OUTLOOK_OTP_INTERVAL_MS,
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

      const fillResult = await fillOtpAndContinue(response.code);
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
    },
    stopOutlookOtp: async () => {
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
      autoOtpStarted = false;
      return result;
    },
    fillProfileAndCreate: async () => {
      if (!isAboutYouPage()) {
        return fail('当前页面不是资料填写页');
      }
      return fillAboutYouAndCreate();
    },
    autoRunForCurrentPage: async () => {
      if (isEmailVerificationPage()) {
        await autoStartOutlookOtpIfNeeded();
      }
      if (isAboutYouPage() && !autoProfileStarted) {
        autoProfileStarted = true;
        await waitForPageReady();
        const result = await fillAboutYouAndCreate();
        if (!result.ok) {
          autoProfileStarted = false;
        }
      }
    },
  };
}

async function autoStartOutlookOtpIfNeeded(): Promise<void> {
  if (autoOtpStarted) {
    return;
  }
  const state = await loadRegisterState();
  if (!state.autoOtp || !state.otpAutoPending || state.otpAutoRunning || !state.accountLine) {
    return;
  }
  autoOtpStarted = true;
  const apiCheck = await checkLocalOutlookApi(state.apiBase);
  if (!apiCheck.ok) {
    autoOtpStarted = false;
    await saveRegisterState({
      otpAutoPending: false,
      otpAutoRunning: false,
      otpJobId: '',
      otpLastMessage: `${apiCheck.message}，已切换为手动验证码`,
    });
    return;
  }
  const controller = createRegisterController();
  void controller.waitForOutlookOtp().finally(() => {
    autoOtpStarted = false;
  });
}

async function checkLocalOutlookApi(apiBase: string): Promise<ActionResult> {
  const response = await browser.runtime.sendMessage({
    type: 'opx:check-outlook-api',
    apiBase,
  });
  return isActionResult(response)
    ? response
    : { ok: false, message: '本地 Outlook 服务没有返回有效状态' };
}

function getPageState(): PageState {
  if (location.hostname === 'chatgpt.com' && location.pathname === '/') {
    return {
      kind: 'unknown',
      label: 'ChatGPT 首页',
      canFillEmail: false,
      canFillOtp: false,
      canFillProfile: false,
    };
  }

  if (isChatGptLoginPage()) {
    return {
      kind: 'login',
      label: 'ChatGPT 登录页',
      canFillEmail: true,
      canFillOtp: false,
      canFillProfile: false,
    };
  }

  if (isEmailVerificationPage()) {
    return {
      kind: 'email-verification',
      label: '邮箱验证码页',
      canFillEmail: false,
      canFillOtp: true,
      canFillProfile: false,
    };
  }

  if (isAboutYouPage()) {
    return {
      kind: 'about-you',
      label: '资料填写页',
      canFillEmail: false,
      canFillOtp: false,
      canFillProfile: true,
    };
  }

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

function isActionResult(value: unknown): value is ActionResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ActionResult).ok === 'boolean' &&
      typeof (value as ActionResult).message === 'string',
  );
}

function waitForPageReady(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 800));
}

function makeOtpJobId(): string {
  return `otp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function accountEmail(accountLine: string): string {
  return accountLine.split('----', 1)[0] || 'Outlook 邮箱';
}

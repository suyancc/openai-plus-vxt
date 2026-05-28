import { loadOAuthState, loadRegisterState } from '../../app/state';
import { PAGE_ACTION } from '../../app/page-actions';
import { sendTabMessage } from '../../app/active-tab';
import type { ActionResult } from '../../app/types';
import { parseAccountInput } from '../register/account-input';
import { fillEmailOtp, fillOpenAiPassword, submitRegisterEmailOnly } from '../register/service';
import type { OAuthResultResponse } from './types';

export interface RegisterSource {
  ok: boolean;
  email: string;
  password: string;
  accountLine: string;
  apiBase: string;
  otpAutoPending: boolean;
  otpAutoRunning: boolean;
  otpLastMessage: string;
  message: string;
}

export async function getRegisterSource(): Promise<RegisterSource> {
  const register = await loadRegisterState();
  const parsed = parseAccountInput(register.rawInput);
  if (!parsed.ok) {
    return {
      ok: false,
      email: '',
      password: '',
      accountLine: '',
      apiBase: '',
      otpAutoPending: false,
      otpAutoRunning: false,
      otpLastMessage: '',
      message: '请先在注册 tab 填写邮箱或 Outlook 行。',
    };
  }

  return {
    ok: true,
    email: parsed.email,
    password: parsed.accountLine ? parsed.accountLine.split('----')[1] || '' : '',
    accountLine: parsed.accountLine,
    apiBase: register.apiBase,
    otpAutoPending: register.otpAutoPending,
    otpAutoRunning: register.otpAutoRunning,
    otpLastMessage: register.otpLastMessage,
    message: parsed.message,
  };
}

export async function createOAuthSessionFromRegisterSource(): Promise<OAuthResultResponse> {
  const source = await getRegisterSource();
  if (!source.ok) {
    return { ok: false, message: source.message };
  }

  const response = await browser.runtime.sendMessage({
    type: 'opx:oauth-create-session',
    email: source.email,
    password: source.password,
  });
  return normalizeOAuthResponse(response, 'OAuth 会话返回无效');
}

export async function fillOAuthEmailFromRegisterSource(tabId?: number): Promise<ActionResult> {
  const source = await getRegisterSource();
  if (!source.ok) {
    return { ok: false, message: source.message };
  }
  return submitRegisterEmailOnly(tabId);
}

export async function fillOAuthLoginPasswordFromRegisterSource(tabId?: number): Promise<ActionResult> {
  const source = await getRegisterSource();
  if (!source.ok) {
    return { ok: false, message: source.message };
  }
  return fillOpenAiPassword(resolveOAuthPassword(source), tabId);
}

export async function chooseOAuthExistingAccount(tabId?: number): Promise<ActionResult> {
  return sendTabMessage<ActionResult>({ type: PAGE_ACTION.oauthChooseAccount }, tabId);
}

export async function submitManualOAuthOtp(code: string, tabId?: number): Promise<ActionResult> {
  return fillEmailOtp(code, tabId);
}

export async function generateOAuthFilesFromSession(): Promise<OAuthResultResponse> {
  const source = await getRegisterSource();
  const response = await browser.runtime.sendMessage({
    type: 'opx:oauth-generate-from-session',
    email: source.ok ? source.email : '',
    password: source.ok ? source.password : '',
  });
  return normalizeOAuthResponse(response, 'OAuth 文件生成返回无效');
}

export async function startOAuthPhoneVerification(tabId?: number): Promise<OAuthResultResponse> {
  const response = await browser.runtime.sendMessage({
    type: 'opx:oauth-phone-start',
    tabId,
  });
  return normalizeOAuthResponse(response, 'OAuth 手机接码返回无效');
}

export async function cancelOAuthPhoneVerification(): Promise<OAuthResultResponse> {
  const response = await browser.runtime.sendMessage({
    type: 'opx:oauth-phone-cancel',
  });
  return normalizeOAuthResponse(response, '停止 OAuth 手机接码返回无效');
}

export async function continueOAuthConsent(tabId?: number): Promise<ActionResult> {
  return sendTabMessage<ActionResult>({ type: PAGE_ACTION.oauthContinueConsent }, tabId);
}

export async function exchangeCurrentOAuthCode(callbackUrl?: string, timeoutMs?: number): Promise<OAuthResultResponse> {
  const response = await browser.runtime.sendMessage({
    type: 'opx:oauth-exchange-code',
    callbackUrl,
    timeoutMs,
  });
  return normalizeOAuthResponse(response, 'OAuth token 交换返回无效');
}

export async function ensureOAuthFilesFromSession(): Promise<ActionResult> {
  const oauth = await loadOAuthState();
  if (oauth.exchangeStatus === 'success' && (oauth.cpaJson || oauth.sub2apiJson)) {
    return { ok: true, message: 'OAuth 文件已生成' };
  }

  const response = await generateOAuthFilesFromSession();
  return {
    ok: response.ok,
    message: response.message,
  };
}

function normalizeOAuthResponse(value: unknown, fallbackMessage: string): OAuthResultResponse {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as OAuthResultResponse).ok === 'boolean' &&
    typeof (value as OAuthResultResponse).message === 'string'
  ) {
    return value as OAuthResultResponse;
  }
  return { ok: false, message: fallbackMessage };
}

function resolveOAuthPassword(source: RegisterSource): string {
  const password = source.password.trim();
  if (password) {
    return password;
  }
  const at = source.email.indexOf('@');
  return at > 0 ? source.email.slice(0, at) : source.email;
}

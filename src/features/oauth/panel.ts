import { loadOAuthState, saveOAuthState } from '../../app/state';
import type { FeaturePanelHandle } from '../../app/types';
import { flashButtonLabel, setButtonPending } from '../../app/button-feedback';
import {
  cancelOAuthPhoneVerification,
  createOAuthSessionFromRegisterSource,
  fillOAuthEmailFromRegisterSource,
  generateOAuthFilesFromSession,
  getRegisterSource,
  startOAuthPhoneVerification,
  submitManualOAuthOtp,
  type RegisterSource,
} from './service';
import type { OAuthState } from './types';

export function createOAuthPanel(container: HTMLElement): FeaturePanelHandle {
  const summary = document.createElement('div');
  summary.className = 'opx-summary';

  const createButton = createActionButton('生成 OAuth 链接并打开');
  const emailActions = document.createElement('div');
  emailActions.className = 'opx-button-row opx-oauth-email-actions';
  const fillEmailButton = createActionButton('填邮箱继续', 'opx-button opx-button-secondary');
  const directFileButton = createActionButton('直接生成文件', 'opx-button opx-button-secondary');
  emailActions.append(fillEmailButton, directFileButton);

  const phoneActions = document.createElement('div');
  phoneActions.className = 'opx-button-row opx-oauth-phone-actions';
  const phoneButton = createActionButton('手机接码继续', 'opx-button opx-button-secondary');
  const stopPhoneButton = createActionButton('停止接码', 'opx-button opx-button-secondary');
  const clearPhoneLogButton = createActionButton('清空日志', 'opx-button opx-button-secondary');
  phoneActions.append(phoneButton, stopPhoneButton, clearPhoneLogButton);

  const otpInput = document.createElement('input');
  otpInput.className = 'opx-input';
  otpInput.type = 'text';
  otpInput.inputMode = 'numeric';
  otpInput.placeholder = '手动验证码';
  otpInput.autocomplete = 'one-time-code';

  const manualOtpButton = createActionButton('手动输入并继续', 'opx-button opx-button-secondary');
  const otpRow = document.createElement('div');
  otpRow.className = 'opx-oauth-code-row';
  otpRow.append(createField('验证码', otpInput), manualOtpButton);

  const codeOutput = document.createElement('textarea');
  codeOutput.className = 'opx-textarea opx-output';
  codeOutput.placeholder = 'code=xxx&state=xxx';
  codeOutput.readOnly = true;
  codeOutput.spellcheck = false;

  const phoneLogOutput = document.createElement('textarea');
  phoneLogOutput.className = 'opx-textarea opx-oauth-phone-log';
  phoneLogOutput.placeholder = 'OAuth / 手机接码调试日志会显示在这里';
  phoneLogOutput.readOnly = true;
  phoneLogOutput.spellcheck = false;

  const resultActions = document.createElement('div');
  resultActions.className = 'opx-button-row opx-oauth-result-actions';
  const copyCodeButton = createActionButton('复制 code', 'opx-button opx-button-secondary');
  const sub2apiButton = createActionButton('下载 sub2api', 'opx-button opx-button-secondary');
  const cpaButton = createActionButton('下载 CPA', 'opx-button opx-button-secondary');
  resultActions.append(copyCodeButton, sub2apiButton, cpaButton);

  const status = document.createElement('div');
  status.className = 'opx-status';
  status.textContent = '先在注册 tab 填写邮箱或 Outlook 行。';

  container.append(
    summary,
    createButton,
    emailActions,
    phoneActions,
    otpRow,
    createField('OAuth code', codeOutput),
    createField('接码日志', phoneLogOutput),
    resultActions,
    status,
  );

  const printedPhoneLogIds = new Set<string>();

  createButton.addEventListener('click', async () => {
    const source = await getRegisterSource();
    if (!source.ok) {
      setStatus(status, source.message, 'error');
      await update();
      return;
    }
    const restoreButton = setButtonPending(createButton, '生成中...');
    setStatus(status, '正在生成 OAuth 链接...', 'pending');
    try {
      const response = await createOAuthSessionFromRegisterSource();
      setStatus(status, response.message, response.ok ? 'ok' : 'error');
    } catch (error) {
      setStatus(status, `生成 OAuth 链接失败：${String(error)}`, 'error');
    } finally {
      restoreButton();
      await update();
    }
  });

  fillEmailButton.addEventListener('click', async () => {
    const source = await getRegisterSource();
    if (!source.ok) {
      setStatus(status, source.message, 'error');
      return;
    }
    const restoreButton = setButtonPending(fillEmailButton, '填写中...');
    try {
      setStatus(status, '正在填入邮箱...', 'pending');
      const result = await fillOAuthEmailFromRegisterSource();
      setStatus(status, result.message, result.ok ? 'ok' : 'error');
    } finally {
      restoreButton();
      await update();
    }
  });

  directFileButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(directFileButton, '生成中...');
    setStatus(status, '正在从 ChatGPT session 直接生成文件...', 'pending');
    try {
      const response = await generateOAuthFilesFromSession();
      await update();
      const oauth = await loadOAuthState();
      setStatus(
        status,
        response.ok && (oauth.sub2apiJson || oauth.cpaJson)
          ? '文件已生成，可点击下方按钮分别下载 sub2api 或 CPA'
          : response.message,
        response.ok ? 'ok' : 'error',
      );
    } catch (error) {
      setStatus(status, `直接生成文件失败：${String(error)}`, 'error');
    } finally {
      restoreButton();
      await update();
    }
  });

  phoneButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(phoneButton, '接码中...');
    const refreshTimer = window.setInterval(() => {
      void update();
    }, 2000);
    setStatus(status, '正在启动 OAuth 手机接码...', 'pending');
    try {
      const response = await startOAuthPhoneVerification();
      setStatus(status, response.message, response.ok ? 'ok' : 'error');
    } catch (error) {
      setStatus(status, `OAuth 手机接码失败：${String(error)}`, 'error');
    } finally {
      window.clearInterval(refreshTimer);
      restoreButton();
      await update();
    }
  });

  stopPhoneButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(stopPhoneButton, '停止中...');
    try {
      const response = await cancelOAuthPhoneVerification();
      setStatus(status, response.message, response.ok ? 'ok' : 'error');
    } catch (error) {
      setStatus(status, `停止 OAuth 手机接码失败：${String(error)}`, 'error');
    } finally {
      restoreButton();
      await update();
    }
  });

  clearPhoneLogButton.addEventListener('click', async () => {
    const oauth = await loadOAuthState();
    await saveOAuthState({
      phoneVerification: {
        ...oauth.phoneVerification,
        logs: [],
      },
    });
    printedPhoneLogIds.clear();
    phoneLogOutput.value = '';
    flashButtonLabel(clearPhoneLogButton, '已清空');
    setStatus(status, '手机接码日志已清空', 'ok');
    await update();
  });

  manualOtpButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(manualOtpButton, '提交中...');
    try {
      setStatus(status, '正在提交验证码...', 'pending');
      const result = await submitManualOAuthOtp(otpInput.value);
      setStatus(status, result.message, result.ok ? 'ok' : 'error');
    } finally {
      restoreButton();
      await update();
    }
  });

  copyCodeButton.addEventListener('click', async () => {
    const oauth = await loadOAuthState();
    if (!oauth.codeParam) {
      return;
    }
    await navigator.clipboard.writeText(oauth.codeParam);
    flashButtonLabel(copyCodeButton, '已复制');
    setStatus(status, '已复制 code 参数', 'ok');
  });

  sub2apiButton.addEventListener('click', async () => {
    const oauth = await loadOAuthState();
    downloadJson(oauth.sub2apiJson, `sub2api_${fileKey(oauth.email)}.json`);
    flashButtonLabel(sub2apiButton, '已下载');
    setStatus(status, '已下载 sub2api JSON', 'ok');
  });

  cpaButton.addEventListener('click', async () => {
    const oauth = await loadOAuthState();
    downloadJson(oauth.cpaJson, `token_${fileKey(oauth.email)}.json`);
    flashButtonLabel(cpaButton, '已下载');
    setStatus(status, '已下载 CPA JSON', 'ok');
  });

  const update = async () => {
    const [oauth, source] = await Promise.all([loadOAuthState(), getRegisterSource()]);
    render(oauth, source);
  };

  void update();
  return { update, onShow: update };

  function render(oauth: OAuthState, source: RegisterSource): void {
    const isAddPhoneFallback = oauth.exportSource === 'chatgpt-session-add-phone';
    const isSessionDirect = oauth.exportSource === 'chatgpt-session-direct';
    const isSessionExport = isAddPhoneFallback || isSessionDirect;
    codeOutput.value = oauth.codeParam;
    codeOutput.placeholder = isAddPhoneFallback
      ? '当前账号需要添加手机号，无法获取到 code，已自动转换文件'
      : isSessionDirect
        ? '已从 ChatGPT session 直接生成文件，无 OAuth code'
        : 'code=xxx&state=xxx';
    codeOutput.disabled = isSessionExport;
    phoneLogOutput.value = formatPhoneLogs(oauth);
    replayPhoneLogsToConsole(oauth, printedPhoneLogIds);
    otpInput.disabled = isSessionExport;
    manualOtpButton.disabled = isSessionExport;
    summary.textContent = buildSummary(oauth, source);
    createButton.disabled = !source.ok;
    fillEmailButton.disabled = !source.ok;
    directFileButton.disabled = oauth.exchangeStatus === 'pending';
    const phoneRunning = isPhoneVerificationRunning(oauth);
    const canRetryPhoneCancel = phoneRunning || Boolean(oauth.phoneVerification.activationId && oauth.phoneVerification.providerId && oauth.phoneVerification.providerId !== 'api');
    phoneButton.disabled = phoneRunning;
    stopPhoneButton.disabled = !canRetryPhoneCancel;
    clearPhoneLogButton.disabled = !oauth.phoneVerification.logs.length;
    copyCodeButton.disabled = isSessionExport || !oauth.codeParam;
    sub2apiButton.disabled = !oauth.sub2apiJson;
    cpaButton.disabled = !oauth.cpaJson;
    if (isSessionExport && oauth.exchangeMessage && status.dataset.oauthMessage !== oauth.exchangeMessage) {
      status.dataset.oauthMessage = oauth.exchangeMessage;
      setStatus(status, oauth.exchangeMessage, oauth.exchangeStatus === 'error' ? 'error' : 'ok');
    } else if (!isSessionExport) {
      delete status.dataset.oauthMessage;
    }
  }
}

function buildSummary(oauth: OAuthState, source: RegisterSource): string {
  const isAddPhoneFallback = oauth.exportSource === 'chatgpt-session-add-phone';
  const isSessionDirect = oauth.exportSource === 'chatgpt-session-direct';
  const isSessionExport = isAddPhoneFallback || isSessionDirect;
  const lines = [
    `邮箱：${source.ok ? source.email : oauth.email || '未读取'}`,
    `OAuth：${oauth.authUrl ? '已生成链接' : '未生成链接'}`,
    `回调：${isAddPhoneFallback ? '手机号验证拦截' : isSessionDirect ? 'ChatGPT session' : oauth.callbackUrl ? '已捕获 code' : '等待回调'}`,
    `验证码：${isSessionExport ? '已停止' : getOtpSummary(source)}`,
    `手机：${getPhoneSummary(oauth)}`,
  ];
  if (isAddPhoneFallback && oauth.exchangeStatus === 'success') {
    lines.push('Code：账号需要添加手机号，无法获取');
    lines.push('导出：已使用 ChatGPT session 自动生成 sub2api / CPA');
  } else if (isSessionDirect && oauth.exchangeStatus === 'success') {
    lines.push('Code：未使用 OAuth code');
    lines.push('导出：已使用 ChatGPT session 直接生成 sub2api / CPA');
  } else if (oauth.exchangeStatus === 'success') {
    lines.push(`导出：sub2api / CPA 已生成`);
  } else if (oauth.exchangeStatus === 'pending') {
    lines.push('导出：正在换取 token...');
  } else if (oauth.exchangeStatus === 'error') {
    lines.push(`导出失败：${oauth.exchangeMessage}`);
  }
  return lines.join('\n');
}

function getPhoneSummary(oauth: OAuthState): string {
  const phone = oauth.phoneVerification;
  if (!phone || phone.status === 'idle') {
    return '未启动';
  }
  const target = phone.phoneNumber ? ` ${maskPhone(phone.phoneNumber)}` : '';
  return `${phone.message || phone.status}${target}`;
}

function formatPhoneLogs(oauth: OAuthState): string {
  const logs = oauth.phoneVerification.logs || [];
  if (!logs.length) {
    return '';
  }
  return logs.slice(-30).map((entry) => {
    const time = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
    const detail = entry.data ? ` ${entry.data}` : '';
    return `[${time}] ${entry.stage}${entry.message ? ` ${entry.message}` : ''}${detail}`;
  }).join('\n');
}

function replayPhoneLogsToConsole(oauth: OAuthState, printedIds: Set<string>): void {
  for (const entry of oauth.phoneVerification.logs || []) {
    if (printedIds.has(entry.id)) {
      continue;
    }
    printedIds.add(entry.id);
    const parsed = parseLogData(entry.data);
    console.info(`[OPX OAuth UI] ${entry.stage}`, parsed ?? entry.data);
  }
}

function parseLogData(value: string): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isPhoneVerificationRunning(oauth: OAuthState): boolean {
  return [
    'requesting',
    'requested',
    'waiting',
    'received',
    'submitted',
  ].includes(oauth.phoneVerification.status);
}

function maskPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 4 ? `${digits.slice(0, 3)}***${digits.slice(-4)}` : digits;
}

function getOtpSummary(source: RegisterSource): string {
  if (!source.ok) {
    return '未准备';
  }
  if (!source.accountLine) {
    return '手动输入';
  }
  if (source.otpAutoRunning) {
    return source.otpLastMessage || '正在自动接收';
  }
  if (source.otpAutoPending) {
    return '已准备自动接收';
  }
  return 'Outlook 行，可自动接收';
}

function createActionButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function createField(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement('label');
  field.className = 'opx-field';
  const caption = document.createElement('span');
  caption.className = 'opx-label';
  caption.textContent = label;
  field.append(caption, control);
  return field;
}

function setStatus(element: HTMLElement, message: string, type: 'pending' | 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

function downloadJson(content: string, filename: string): void {
  if (!content) {
    return;
  }
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function fileKey(email: string): string {
  return (email || 'oauth').replace(/[^a-zA-Z0-9._-]+/g, '_').replace('@', '_');
}

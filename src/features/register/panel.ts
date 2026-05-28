import type { FeaturePanelHandle } from '../../app/types';
import { setButtonPending } from '../../app/button-feedback';
import type { RegisterController } from './types';

export function createRegisterPanel(container: HTMLElement, controller: RegisterController): FeaturePanelHandle {
  const accountInput = document.createElement('textarea');
  accountInput.className = 'opx-textarea';
  accountInput.placeholder = '邮箱或 Outlook 行';
  accountInput.autocomplete = 'off';
  accountInput.spellcheck = false;

  const inputHint = document.createElement('div');
  inputHint.className = 'opx-hint';
  inputHint.textContent = '支持 user@example.com 或 email----password----client_id----refresh_token';

  const emailButton = createButton('填入邮箱并继续');
  const otp = document.createElement('input');
  otp.className = 'opx-input';
  otp.type = 'text';
  otp.inputMode = 'numeric';
  otp.placeholder = '验证码';
  otp.autocomplete = 'one-time-code';

  const otpButton = createButton('填入验证码并继续');
  const otpState = document.createElement('div');
  otpState.className = 'opx-summary';
  otpState.hidden = true;
  const stopOtpButton = createButton('停止接收验证码', 'opx-button opx-button-danger');
  stopOtpButton.hidden = true;
  const profileButton = createButton('填写资料并创建');

  const status = document.createElement('div');
  status.className = 'opx-status';
  status.textContent = '等待操作';

  const update = async () => {
    const page = controller.getPageState();
    const saved = await controller.loadState();
    if (accountInput.value !== saved.rawInput) {
      accountInput.value = saved.rawInput;
    }
    emailButton.disabled = false;
    otpButton.disabled = !page.canFillOtp;
    stopOtpButton.hidden = !saved.otpAutoRunning;
    stopOtpButton.disabled = !saved.otpAutoRunning;
    otpState.hidden = !saved.autoOtp && !saved.otpLastMessage && !saved.otpAutoPending && !saved.otpAutoRunning;
    otpState.textContent = getOtpStateText(saved);
    profileButton.disabled = !page.canFillProfile;
    inputHint.textContent = saved.autoOtp
      ? 'Outlook 行模式：提交邮箱后会在验证码页自动收码'
      : '单邮箱模式：验证码需要手动输入';
  };

  accountInput.addEventListener('input', async () => {
    const saved = await controller.saveInput(accountInput.value);
    inputHint.textContent = saved.autoOtp
      ? 'Outlook 行模式：提交邮箱后会在验证码页自动收码'
      : '单邮箱模式：验证码需要手动输入';
  });

  emailButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(emailButton, '提交中...');
    try {
      setStatus(status, '正在提交邮箱...', 'pending');
      await controller.saveInput(accountInput.value);
      setResult(status, await controller.fillEmailFromInput());
    } finally {
      restoreButton();
      await update();
    }
  });

  otpButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(otpButton, '提交中...');
    try {
      setStatus(status, '正在提交验证码...', 'pending');
      setResult(status, await controller.fillOtp(otp.value));
    } finally {
      restoreButton();
      await update();
    }
  });

  stopOtpButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(stopOtpButton, '停止中...');
    try {
      setStatus(status, '正在停止接收验证码...', 'pending');
      setResult(status, await controller.stopOutlookOtp());
    } finally {
      restoreButton();
      await update();
    }
  });

  profileButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(profileButton, '填写中...');
    try {
      setStatus(status, '正在填写资料...', 'pending');
      setResult(status, await controller.fillProfileAndCreate());
    } finally {
      restoreButton();
      await update();
    }
  });

  container.append(accountInput, inputHint, emailButton, otpState, stopOtpButton, otp, otpButton, profileButton, status);
  void update();
  return { update };
}

function getOtpStateText(saved: Awaited<ReturnType<RegisterController['loadState']>>): string {
  if (saved.otpAutoRunning) {
    return saved.otpLastMessage || '正在自动接收 Outlook 验证码';
  }
  if (saved.otpAutoPending) {
    return '已准备自动接收验证码，跳转到验证码页后会自动开始';
  }
  if (saved.otpLastMessage) {
    return saved.otpLastMessage;
  }
  return saved.autoOtp ? '本地 Outlook 服务启动后，提交邮箱会自动接收验证码' : '';
}

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function setResult(element: HTMLElement, result: { ok: boolean; message: string }): void {
  setStatus(element, result.message, result.ok ? 'ok' : 'error');
}

function setStatus(element: HTMLElement, message: string, type: 'pending' | 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

import type { FeaturePanelHandle } from '../../app/types';
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
  const autoOtpButton = createButton('自动接收并填入验证码', 'opx-button opx-button-secondary');
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
    emailButton.disabled = !page.canFillEmail;
    otpButton.disabled = !page.canFillOtp;
    autoOtpButton.disabled = !page.canFillOtp || !saved.autoOtp;
    profileButton.disabled = !page.canFillProfile;
    inputHint.textContent = saved.autoOtp
      ? 'Outlook 行模式：验证码页会通过本地 API 自动收码'
      : '单邮箱模式：验证码需要手动输入';
  };

  accountInput.addEventListener('input', async () => {
    const saved = await controller.saveInput(accountInput.value);
    inputHint.textContent = saved.autoOtp
      ? 'Outlook 行模式：验证码页会通过本地 API 自动收码'
      : '单邮箱模式：验证码需要手动输入';
  });

  emailButton.addEventListener('click', async () => {
    setStatus(status, '正在提交邮箱...', 'pending');
    await controller.saveInput(accountInput.value);
    setResult(status, await controller.fillEmailFromInput());
    await update();
  });

  otpButton.addEventListener('click', async () => {
    setStatus(status, '正在提交验证码...', 'pending');
    setResult(status, await controller.fillOtp(otp.value));
    await update();
  });

  autoOtpButton.addEventListener('click', async () => {
    setStatus(status, '等待 Outlook 验证码...', 'pending');
    setResult(status, await controller.waitForOutlookOtp());
    await update();
  });

  profileButton.addEventListener('click', async () => {
    setStatus(status, '正在填写资料...', 'pending');
    setResult(status, await controller.fillProfileAndCreate());
    await update();
  });

  container.append(accountInput, inputHint, emailButton, otp, otpButton, autoOtpButton, profileButton, status);
  void update();
  return { update };
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

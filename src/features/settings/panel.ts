import { checkLatestVersion } from '../version-check/github';
import { loadAddressAutofillSettings, saveAddressAutofillSettings } from './state';
import type { ClearDomainCookiesResponse, CookieClearTarget } from './types';
import type { FeaturePanelHandle } from '../../app/types';
import { flashButtonLabel, setButtonPending } from '../../app/button-feedback';

const TG_GROUP_URL = 'https://t.me/fuck_open';

export interface SettingsPanelOptions {
  onVersionChecked?: () => Promise<void> | void;
}

export function createSettingsPanel(container: HTMLElement, options: SettingsPanelOptions = {}): FeaturePanelHandle {
  const dialog = document.createElement('section');
  dialog.className = 'opx-settings-panel';
  dialog.setAttribute('aria-label', '插件设置');

  const header = document.createElement('div');
  header.className = 'opx-settings-header';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'opx-settings-title';
  const title = document.createElement('strong');
  title.textContent = '设置';
  const version = document.createElement('span');
  version.className = 'opx-version-badge';
  version.textContent = `v${browser.runtime.getManifest().version}`;
  titleGroup.append(title, version);
  header.append(titleGroup);

  const payOpenAiCheckbox = document.createElement('input');
  payOpenAiCheckbox.type = 'checkbox';
  payOpenAiCheckbox.className = 'opx-checkbox';

  const payPalSignupCheckbox = document.createElement('input');
  payPalSignupCheckbox.type = 'checkbox';
  payPalSignupCheckbox.className = 'opx-checkbox';

  const payOpenAiItem = createSettingItem(
    payOpenAiCheckbox,
    'OpenAI 支付页自动填写',
    '用于 pay.openai.com/c/pay 页面，填写姓名、国家、地址、邮编、电话并勾选条款。',
  );
  const payPalSignupItem = createSettingItem(
    payPalSignupCheckbox,
    'PayPal 注册页自动填写',
    '用于 paypal.com/checkoutweb/signup 页面，填写国家、邮箱、卡资料、姓名、地址和密码提示。',
  );

  const cookieSection = document.createElement('div');
  cookieSection.className = 'opx-settings-section';
  const cookieTitle = document.createElement('div');
  cookieTitle.className = 'opx-settings-section-title';
  cookieTitle.textContent = 'Cookie 清理';

  const cookieActions = document.createElement('div');
  cookieActions.className = 'opx-settings-cookie-actions';

  const clearPaypalCookiesButton = createCookieClearButton('清除 PayPal Cookie');
  clearPaypalCookiesButton.title = '清除 paypal.com 及其子域名下的 cookie';
  const clearChatGptCookiesButton = createCookieClearButton('清除 ChatGPT Cookie');
  clearChatGptCookiesButton.title = '清除 chatgpt.com、openai.com 及其子域名下的 cookie';
  cookieActions.append(clearPaypalCookiesButton, clearChatGptCookiesButton);

  const cookieHint = document.createElement('div');
  cookieHint.className = 'opx-setting-description opx-cookie-description';
  cookieHint.textContent = '用于快速退出相关站点登录态。只清除对应域名下的浏览器 cookie。';
  cookieSection.append(cookieTitle, cookieActions, cookieHint);

  const checkUpdateButton = document.createElement('button');
  checkUpdateButton.className = 'opx-external-link-button';
  checkUpdateButton.type = 'button';
  checkUpdateButton.title = '立即检查 GitHub Release 最新版本';
  checkUpdateButton.textContent = '检测更新';

  const tgGroupButton = document.createElement('button');
  tgGroupButton.className = 'opx-external-link-button';
  tgGroupButton.type = 'button';
  tgGroupButton.title = '打开 TG 群组';
  tgGroupButton.append(createTelegramIcon(), document.createTextNode('TG 群组：t.me/fuck_open'));

  const status = document.createElement('div');
  status.className = 'opx-status';

  dialog.append(header, payOpenAiItem, payPalSignupItem, cookieSection, checkUpdateButton, tgGroupButton, status);
  container.append(dialog);

  payOpenAiCheckbox.addEventListener('change', async () => {
    await saveAddressAutofillSettings({ payOpenAiEnabled: payOpenAiCheckbox.checked });
    setStatus(status, '设置已保存', 'ok');
  });
  payPalSignupCheckbox.addEventListener('change', async () => {
    await saveAddressAutofillSettings({ payPalSignupEnabled: payPalSignupCheckbox.checked });
    setStatus(status, '设置已保存', 'ok');
  });
  tgGroupButton.addEventListener('click', () => {
    window.open(TG_GROUP_URL, '_blank', 'noopener,noreferrer');
    flashButtonLabel(tgGroupButton, '已打开');
  });
  clearPaypalCookiesButton.addEventListener('click', () => {
    void clearCookies('paypal', clearPaypalCookiesButton);
  });
  clearChatGptCookiesButton.addEventListener('click', () => {
    void clearCookies('chatgpt', clearChatGptCookiesButton);
  });
  checkUpdateButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(checkUpdateButton, '检测中...');
    setStatus(status, '正在检测 GitHub 最新版本...', 'pending');
    try {
      const result = await checkLatestVersion(true);
      await options.onVersionChecked?.();
      if (result.latest && result.updateAvailable) {
        setStatus(status, `发现新版本 v${result.latest.version}，顶部已显示更新提示`, 'ok');
      } else if (result.latest) {
        setStatus(status, `当前已是最新版本 v${result.currentVersion}`, 'ok');
      } else {
        setStatus(status, result.error || '暂未找到可用 Release', 'pending');
      }
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    } finally {
      restoreButton();
    }
  });

  const update = async () => {
    const settings = await loadAddressAutofillSettings();
    payOpenAiCheckbox.checked = settings.payOpenAiEnabled;
    payPalSignupCheckbox.checked = settings.payPalSignupEnabled;
    const enabledCount = Number(settings.payOpenAiEnabled) + Number(settings.payPalSignupEnabled);
    if (!status.textContent || status.dataset.source === 'summary') {
      setStatus(
        status,
        enabledCount > 0 ? `已开启 ${enabledCount} 项自动填写` : '自动填写未开启',
        enabledCount > 0 ? 'ok' : 'pending',
        'summary',
      );
    }
  };

  return {
    update,
    onShow: update,
  };

  async function clearCookies(target: CookieClearTarget, button: HTMLButtonElement): Promise<void> {
    const label = target === 'paypal' ? 'PayPal' : 'ChatGPT';
    const restoreButton = setButtonPending(button, '清除中...');
    setStatus(status, `正在清除 ${label} Cookie...`, 'pending');
    try {
      const response = await browser.runtime.sendMessage({
        type: 'opx:clear-domain-cookies',
        target,
      }) as ClearDomainCookiesResponse;
      if (!response?.ok) {
        setStatus(status, response?.message || `${label} Cookie 清除失败`, 'error');
        return;
      }
      setStatus(status, response.message, 'ok');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    } finally {
      restoreButton();
    }
  }
}

function createSettingItem(checkbox: HTMLInputElement, title: string, description: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'opx-setting-item';

  const label = document.createElement('label');
  label.className = 'opx-check-row';
  const titleElement = document.createElement('span');
  titleElement.textContent = title;
  label.append(checkbox, titleElement);

  const descriptionElement = document.createElement('div');
  descriptionElement.className = 'opx-setting-description';
  descriptionElement.textContent = description;

  item.append(label, descriptionElement);
  return item;
}

function createTelegramIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('opx-telegram-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M21.9 4.3 18.7 19c-.2 1-.8 1.2-1.6.8l-4.6-3.4-2.2 2.1c-.2.2-.4.4-.9.4l.3-4.7 8.5-7.7c.4-.3-.1-.5-.6-.2L7.1 12.9 2.6 11.5c-1-.3-1-1 0-1.4L20.2 3.3c.8-.3 1.5.2 1.7 1Z');
  svg.append(path);
  return svg;
}

function createCookieClearButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'opx-cookie-clear-button';
  button.type = 'button';
  button.textContent = label;
  return button;
}

function setStatus(
  element: HTMLElement,
  message: string,
  type: 'pending' | 'ok' | 'error',
  source: 'action' | 'summary' = 'action',
): void {
  element.textContent = message;
  element.dataset.type = type;
  element.dataset.source = source;
}

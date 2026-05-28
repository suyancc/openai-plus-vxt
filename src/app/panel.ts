import { createAddressPanel } from '../features/address-autofill/panel';
import { createAutomationPanel } from '../features/automation/panel';
import { createLinkExtractorPanel } from '../features/link-extractor/panel';
import { createOAuthPanel } from '../features/oauth/panel';
import { createRegisterPanel } from '../features/register/panel';
import type { RegisterController } from '../features/register/types';
import { createSettingsPanel } from '../features/settings/panel';
import { createSmsPanel } from '../features/sms/panel';
import { createVersionNotice } from '../features/version-check/panel';
import { canUseExtensionApi, isExtensionContextInvalidated } from './extension-context';
import { setButtonPending } from './button-feedback';
import { isFeatureTab, loadAppState, saveActiveTab, savePanelCollapsed } from './state';
import { PANEL_STYLES } from './styles';
import { installToastHost } from './toast';
import type { FeaturePanelHandle, FeatureTab } from './types';

const CHATGPT_REGISTER_URL = 'https://chatgpt.com/auth/login';
const OTP_SERVICE_DOWNLOAD_URL =
  'https://github.com/suyancc/openai-plus-vxt/releases/download/outlook-otp-service/outlook-otp-service.zip';

interface PanelOptions {
  surface?: 'page' | 'sidepanel';
}

export function createPanel(root: ShadowRoot, registerController: RegisterController, options: PanelOptions = {}): void {
  root.innerHTML = '';
  const isSidePanel = options.surface === 'sidepanel';

  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;

  const shell = document.createElement('div');
  shell.className = 'opx-shell';
  shell.classList.toggle('is-sidepanel', isSidePanel);

  const collapseButton = document.createElement('button');
  collapseButton.className = 'opx-collapse-toggle';
  collapseButton.type = 'button';
  collapseButton.textContent = '收起';
  collapseButton.title = '收起侧边栏';
  collapseButton.setAttribute('aria-expanded', 'true');

  const panel = document.createElement('aside');
  panel.className = 'opx-panel';

  const topbar = document.createElement('div');
  topbar.className = 'opx-topbar';

  const tabs = document.createElement('div');
  tabs.className = 'opx-tabs';

  const registerTab = createTab('register', '注册');
  const automationTab = createTab('automation', '自动化');
  const linkTab = createTab('link', '提链接');
  const oauthTab = createTab('oauth', 'OAuth');
  const addressTab = createTab('address', '地址');
  const smsTab = createTab('sms', '接码');
  const settingsTab = createTab('settings', '设置');
  tabs.append(registerTab, automationTab, linkTab, oauthTab, addressTab, smsTab, settingsTab);

  const state = document.createElement('div');
  state.className = 'opx-state';

  const stateRow = document.createElement('div');
  stateRow.className = 'opx-state-row';

  const registerQuickLinks = document.createElement('div');
  registerQuickLinks.className = 'opx-state-register-links';

  const openRegisterButton = document.createElement('button');
  openRegisterButton.className = 'opx-state-link opx-state-link-primary opx-state-button';
  openRegisterButton.type = 'button';
  openRegisterButton.textContent = '打开注册页';

  const downloadOtpLink = document.createElement('a');
  downloadOtpLink.className = 'opx-state-link';
  downloadOtpLink.href = OTP_SERVICE_DOWNLOAD_URL;
  downloadOtpLink.target = '_blank';
  downloadOtpLink.rel = 'noopener noreferrer';
  downloadOtpLink.textContent = '下载 Outlook 接码软件';
  registerQuickLinks.append(openRegisterButton, downloadOtpLink);
  stateRow.append(state, registerQuickLinks);

  const registerView = createView();
  const automationView = createView();
  const linkView = createView();
  const oauthView = createView();
  const addressView = createView();
  const smsView = createView();
  const settingsView = createView();
  const versionNotice = createVersionNotice();

  const handles: Record<FeatureTab, FeaturePanelHandle> = {
    register: createRegisterPanel(registerView, registerController),
    automation: createAutomationPanel(automationView),
    link: createLinkExtractorPanel(linkView),
    oauth: createOAuthPanel(oauthView),
    address: createAddressPanel(addressView),
    sms: createSmsPanel(smsView),
    settings: createSettingsPanel(settingsView, {
      onVersionChecked: () => versionNotice.update(true),
    }),
  };

  let activeTab: FeatureTab = 'register';

  const setCollapsed = (collapsed: boolean) => {
    shell.classList.toggle('is-collapsed', collapsed);
    collapseButton.textContent = collapsed ? '展开' : '收起';
    collapseButton.title = collapsed ? '展开侧边栏' : '收起侧边栏';
    collapseButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };

  const setActiveTab = async (tab: string) => {
    if (!isFeatureTab(tab)) {
      return;
    }
    await runWithContextGuard(async () => {
      activeTab = tab;
      await saveActiveTab(tab);
      renderActiveTab();
      await handles[tab].onShow?.();
      await updateState();
    });
  };

  const renderActiveTab = () => {
    for (const item of [registerTab, automationTab, linkTab, oauthTab, addressTab, smsTab, settingsTab]) {
      item.classList.toggle('is-active', item.dataset.tab === activeTab);
    }
    registerView.hidden = activeTab !== 'register';
    automationView.hidden = activeTab !== 'automation';
    linkView.hidden = activeTab !== 'link';
    oauthView.hidden = activeTab !== 'oauth';
    addressView.hidden = activeTab !== 'address';
    smsView.hidden = activeTab !== 'sms';
    settingsView.hidden = activeTab !== 'settings';
    registerQuickLinks.hidden = activeTab !== 'register';
  };

  const updateState = async () => {
    if (!canUseExtensionApi()) {
      stopBackgroundLoops();
      return;
    }
    const saved = await loadAppState();
    activeTab = saved.activeTab;
    setCollapsed(isSidePanel ? false : saved.panelCollapsed);
    renderActiveTab();
    state.textContent = getStateLabel(activeTab, registerController);
    await handles[activeTab].update();
    if (!saved.automation.run.running) {
      await registerController.autoRunForCurrentPage();
    }
  };

  registerTab.addEventListener('click', () => void setActiveTab('register'));
  automationTab.addEventListener('click', () => void setActiveTab('automation'));
  linkTab.addEventListener('click', () => void setActiveTab('link'));
  oauthTab.addEventListener('click', () => void setActiveTab('oauth'));
  addressTab.addEventListener('click', () => void setActiveTab('address'));
  smsTab.addEventListener('click', () => void setActiveTab('sms'));
  settingsTab.addEventListener('click', () => void setActiveTab('settings'));
  openRegisterButton.addEventListener('click', () => {
    void runWithContextGuard(async () => {
      const restoreButton = setButtonPending(openRegisterButton, '打开中...');
      state.textContent = '正在打开注册页...';
      try {
        const result = await registerController.openRegisterPage();
        state.textContent = result.message;
      } finally {
        restoreButton();
      }
    });
  });

  collapseButton.addEventListener('click', () => {
    if (isSidePanel) {
      return;
    }
    const collapsed = !shell.classList.contains('is-collapsed');
    setCollapsed(collapsed);
    void runWithContextGuard(() => savePanelCollapsed(collapsed));
  });

  topbar.append(tabs);
  panel.append(topbar, versionNotice.element, stateRow, registerView, automationView, linkView, oauthView, addressView, smsView, settingsView);
  shell.append(collapseButton, panel);
  root.append(style, shell);
  installToastHost(root);

  const stateTimer = window.setInterval(() => void runWithContextGuard(updateState), 1000);
  const versionTimer = window.setTimeout(() => void runWithContextGuard(() => versionNotice.update()), 800);
  void runWithContextGuard(updateState).then(() => {
    void handles[activeTab].onShow?.();
  });

  function stopBackgroundLoops(): void {
    window.clearInterval(stateTimer);
    window.clearTimeout(versionTimer);
  }

  async function runWithContextGuard<T>(task: () => Promise<T> | T): Promise<T | undefined> {
    try {
      return await task();
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        stopBackgroundLoops();
        return undefined;
      }
      throw error;
    }
  }
}

function getStateLabel(activeTab: FeatureTab, registerController: RegisterController): string {
  if (activeTab === 'register') {
    return registerController.getPageState().label;
  }
  if (activeTab === 'link') {
    return '提链接：ChatGPT session';
  }
  if (activeTab === 'automation') {
    return '自动化：流程编排';
  }
  if (activeTab === 'oauth') {
    return 'OAuth：授权码导出';
  }
  if (activeTab === 'address') {
    return '地址：随机资料';
  }
  if (activeTab === 'settings') {
    return '设置：插件选项';
  }
  return '接码：短信验证码';
}

function createView(): HTMLElement {
  const view = document.createElement('section');
  view.className = 'opx-view';
  return view;
}

function createTab(tab: FeatureTab, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'opx-tab';
  button.type = 'button';
  button.dataset.tab = tab;
  button.textContent = label;
  return button;
}

import { createAddressPanel } from '../features/address-autofill/panel';
import { createLinkExtractorPanel } from '../features/link-extractor/panel';
import { createPaymentPanel } from '../features/payment/panel';
import { createRegisterPanel } from '../features/register/panel';
import type { RegisterController } from '../features/register/types';
import { createSettingsDialog } from '../features/settings/panel';
import { createSmsPanel } from '../features/sms/panel';
import { isFeatureTab, loadAppState, saveActiveTab, savePanelCollapsed } from './state';
import { PANEL_STYLES } from './styles';
import type { FeaturePanelHandle, FeatureTab } from './types';

export function createPanel(root: ShadowRoot, registerController: RegisterController): void {
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;

  const shell = document.createElement('div');
  shell.className = 'opx-shell';

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
  const linkTab = createTab('link', '提链接');
  const addressTab = createTab('address', '地址');
  const paymentTab = createTab('payment', '支付');
  const smsTab = createTab('sms', '接码');
  tabs.append(registerTab, linkTab, addressTab, paymentTab, smsTab);

  const settingsButton = document.createElement('button');
  settingsButton.className = 'opx-icon-button';
  settingsButton.type = 'button';
  settingsButton.textContent = '⚙';
  settingsButton.title = '打开设置';
  settingsButton.setAttribute('aria-label', '打开设置');

  const state = document.createElement('div');
  state.className = 'opx-state';

  const registerView = createView();
  const linkView = createView();
  const addressView = createView();
  const paymentView = createView();
  const smsView = createView();

  const handles: Record<FeatureTab, FeaturePanelHandle> = {
    register: createRegisterPanel(registerView, registerController),
    link: createLinkExtractorPanel(linkView),
    address: createAddressPanel(addressView),
    payment: createPaymentPanel(paymentView),
    sms: createSmsPanel(smsView),
  };
  const settingsDialog = createSettingsDialog();

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
    activeTab = tab;
    await saveActiveTab(tab);
    renderActiveTab();
    await handles[tab].onShow?.();
    await updateState();
  };

  const renderActiveTab = () => {
    for (const item of [registerTab, linkTab, addressTab, paymentTab, smsTab]) {
      item.classList.toggle('is-active', item.dataset.tab === activeTab);
    }
    registerView.hidden = activeTab !== 'register';
    linkView.hidden = activeTab !== 'link';
    addressView.hidden = activeTab !== 'address';
    paymentView.hidden = activeTab !== 'payment';
    smsView.hidden = activeTab !== 'sms';
  };

  const updateState = async () => {
    const saved = await loadAppState();
    activeTab = saved.activeTab;
    setCollapsed(saved.panelCollapsed);
    renderActiveTab();
    state.textContent = getStateLabel(activeTab, registerController);
    await handles[activeTab].update();
  };

  registerTab.addEventListener('click', () => void setActiveTab('register'));
  linkTab.addEventListener('click', () => void setActiveTab('link'));
  addressTab.addEventListener('click', () => void setActiveTab('address'));
  paymentTab.addEventListener('click', () => void setActiveTab('payment'));
  smsTab.addEventListener('click', () => void setActiveTab('sms'));
  settingsButton.addEventListener('click', () => settingsDialog.open());

  collapseButton.addEventListener('click', () => {
    const collapsed = !shell.classList.contains('is-collapsed');
    setCollapsed(collapsed);
    void savePanelCollapsed(collapsed);
  });

  topbar.append(tabs, settingsButton);
  panel.append(topbar, state, registerView, linkView, addressView, paymentView, smsView, settingsDialog.element);
  shell.append(collapseButton, panel);
  root.append(style, shell);

  window.setInterval(() => void updateState(), 1000);
  void updateState().then(() => {
    if (activeTab === 'link') {
      void handles.link.onShow?.();
    }
  });
}

function getStateLabel(activeTab: FeatureTab, registerController: RegisterController): string {
  if (activeTab === 'register') {
    return registerController.getPageState().label;
  }
  if (activeTab === 'link') {
    return '提链接：ChatGPT session';
  }
  if (activeTab === 'address') {
    return '地址：随机资料';
  }
  if (activeTab === 'payment') {
    return '支付模块';
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

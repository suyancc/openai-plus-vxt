import { loadLinkExtractorState, saveLinkExtractorState } from '../../app/state';
import type { FeaturePanelHandle } from '../../app/types';
import { extractAccessToken, normalizeCheckoutOptions } from './checkout';
import { fetchChatGptSessionDirect } from './session-direct';
import type { ChatGptSessionResponse, CheckoutLinkResponse, CheckoutOptions } from './types';

const REGION_OPTIONS = [
  ['ID', '印尼 / IDR'],
  ['DE', '德国 / EUR'],
  ['JP', '日本 / JPY'],
  ['US', '美国 / USD'],
];

export function createLinkExtractorPanel(container: HTMLElement): FeaturePanelHandle {
  const linkSummary = document.createElement('div');
  linkSummary.className = 'opx-summary';

  const sessionCard = document.createElement('div');
  sessionCard.className = 'opx-session-card';
  const emailValue = createSessionRow('邮箱', '未读取');
  const planValue = createSessionRow('套餐', '未读取');
  const tokenValue = createSessionRow('Token', '未读取');
  sessionCard.append(emailValue.row, planValue.row, tokenValue.row);

  const refreshSessionButton = createButton('读取 ChatGPT session', 'opx-button opx-button-secondary');

  const planSelect = createSelect([
    ['chatgptplusplan', 'ChatGPT Plus'],
    ['chatgptteamplan', 'ChatGPT Team'],
  ]);
  const uiModeSelect = createSelect([
    ['custom', '短链接 / custom'],
    ['hosted', '长链接 / hosted'],
  ]);
  const regionSelect = createSelect(REGION_OPTIONS);
  const workspaceInput = createInput('Workspace 名称', 'text');
  const seatsInput = createInput('席位数量', 'number');
  seatsInput.min = '2';
  seatsInput.step = '1';

  const mainGrid = document.createElement('div');
  mainGrid.className = 'opx-grid';
  const planField = createField('套餐类型', planSelect);
  const uiModeField = createField('链接形式', uiModeSelect);
  const regionField = createField('计费区域', regionSelect);
  mainGrid.append(planField, uiModeField, regionField);

  const teamOptions = document.createElement('div');
  teamOptions.className = 'opx-team-options';
  const teamGrid = document.createElement('div');
  teamGrid.className = 'opx-grid';
  teamGrid.append(
    createField('Workspace', workspaceInput),
    createField('席位', seatsInput),
  );
  teamOptions.append(teamGrid);

  const tokenInput = document.createElement('textarea');
  tokenInput.className = 'opx-textarea opx-token-textarea';
  tokenInput.placeholder = '自动读取或手动粘贴 ChatGPT session JSON / Access Token';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;

  const tokenHint = document.createElement('div');
  tokenHint.className = 'opx-hint';
  tokenHint.textContent = '切到提链接 tab 会读取 /api/auth/session；token 只在当前页面内使用。';

  const generateLinkButton = createButton('生成订阅链接');
  const linkOutput = document.createElement('textarea');
  linkOutput.className = 'opx-textarea opx-output';
  linkOutput.placeholder = '生成后的订阅链接';
  linkOutput.readOnly = true;
  linkOutput.spellcheck = false;

  const linkButtonRow = document.createElement('div');
  linkButtonRow.className = 'opx-button-row';
  const copyLinkButton = createButton('复制链接', 'opx-button opx-button-secondary');
  const openLinkButton = createButton('打开链接', 'opx-button opx-button-secondary');
  const clearLinkButton = createButton('清空', 'opx-button opx-button-secondary');
  linkButtonRow.append(copyLinkButton, openLinkButton, clearLinkButton);

  const linkStatus = document.createElement('div');
  linkStatus.className = 'opx-status';
  linkStatus.textContent = '等待读取 ChatGPT session。';

  let generatedLink = '';
  let sessionAccessToken = '';
  let sessionFetchInFlight = false;
  let sessionFetchedOnce = false;

  const update = async () => {
    const saved = await loadLinkExtractorState();
    setCheckoutOptions(saved.checkoutOptions);
  };

  const onShow = async () => {
    await refreshSession();
  };

  const syncLinkOptions = async () => {
    try {
      const options = readCheckoutOptions();
      await saveLinkExtractorState({ checkoutOptions: options });
      setLinkSummary(options);
      setStatus(linkStatus, '本地参数已更新', 'ok');
    } catch (error) {
      setStatus(linkStatus, errorMessage(error), 'error');
    }
  };

  for (const item of [planSelect, uiModeSelect, regionSelect, workspaceInput, seatsInput]) {
    item.addEventListener('change', () => void syncLinkOptions());
    item.addEventListener('input', () => void syncLinkOptions());
  }

  refreshSessionButton.addEventListener('click', () => void refreshSession());

  tokenInput.addEventListener('paste', () => window.setTimeout(() => normalizeTokenInput(false), 0));
  tokenInput.addEventListener('input', () => {
    sessionAccessToken = '';
    if (tokenInput.value.includes('accessToken') || tokenInput.value.length > 900) {
      normalizeTokenInput(false);
    }
  });

  generateLinkButton.addEventListener('click', async () => {
    setStatus(linkStatus, '正在生成订阅链接...', 'pending');
    const token = tokenInput.value.trim() ? normalizeTokenInput(true) : sessionAccessToken;
    if (!token) {
      setStatus(linkStatus, '没有 accessToken，请先读取 session 或手动粘贴。', 'error');
      return;
    }

    let options: CheckoutOptions;
    try {
      options = readCheckoutOptions();
      await saveLinkExtractorState({ checkoutOptions: options });
    } catch (error) {
      setStatus(linkStatus, errorMessage(error), 'error');
      return;
    }

    let response: CheckoutLinkResponse;
    try {
      response = await browser.runtime.sendMessage({
        type: 'opx:create-checkout-link',
        raw: token,
        options,
      });
    } catch (error) {
      setStatus(linkStatus, `生成失败：${String(error)}`, 'error');
      return;
    }

    const link = response?.link || response?.url || '';
    if (!isCheckoutLinkResponse(response) || !response.ok || !link) {
      setStatus(linkStatus, response?.message || '生成失败：返回结果无效', 'error');
      setGeneratedLink('');
      return;
    }

    setGeneratedLink(link);
    setStatus(linkStatus, response.message, 'ok');
  });

  copyLinkButton.addEventListener('click', async () => {
    if (!generatedLink) {
      return;
    }
    await navigator.clipboard.writeText(generatedLink);
    setStatus(linkStatus, '已复制链接', 'ok');
  });

  openLinkButton.addEventListener('click', () => {
    if (generatedLink) {
      window.open(generatedLink, '_blank', 'noopener,noreferrer');
    }
  });

  clearLinkButton.addEventListener('click', () => {
    tokenInput.value = '';
    sessionAccessToken = '';
    tokenHint.textContent = '切到提链接 tab 会读取 /api/auth/session；token 只在当前页面内使用。';
    tokenHint.classList.remove('is-ok');
    setGeneratedLink('');
    setSessionRows('', '', '');
    setStatus(linkStatus, '已清空', 'ok');
    tokenInput.focus();
  });

  container.append(
    linkSummary,
    sessionCard,
    refreshSessionButton,
    mainGrid,
    teamOptions,
    tokenInput,
    tokenHint,
    generateLinkButton,
    createField('订阅链接', linkOutput),
    linkButtonRow,
    linkStatus,
  );
  void update();
  setGeneratedLink('');
  return { update, onShow };

  async function refreshSession(): Promise<void> {
    if (sessionFetchInFlight) {
      return;
    }
    sessionFetchInFlight = true;
    refreshSessionButton.disabled = true;
    setStatus(linkStatus, '正在读取 https://chatgpt.com/api/auth/session ...', 'pending');
    try {
      // Try direct fetch first (works in fingerprint browsers where background can't access cookies)
      let response: ChatGptSessionResponse | undefined;
      if (location.hostname === 'chatgpt.com') {
        response = await fetchChatGptSessionDirect();
      }

      // Fall back to background message if direct fetch failed or not on chatgpt.com
      if (!response || (!response.ok && !response.session?.accessToken)) {
        const bgResponse: ChatGptSessionResponse = await browser.runtime.sendMessage({
          type: 'opx:fetch-chatgpt-session',
        });
        if (isChatGptSessionResponse(bgResponse)) {
          // Use background result if it's better
          if (!response || (bgResponse.ok && bgResponse.session?.accessToken)) {
            response = bgResponse;
          }
        }
      }

      sessionFetchedOnce = true;
      if (!response || !isChatGptSessionResponse(response)) {
        setStatus(linkStatus, 'session 返回结果无效', 'error');
        return;
      }

      const session = response.session;
      setSessionRows(session?.email || '', session?.planType || '', session?.accessToken || '');
      if (session?.accessToken) {
        sessionAccessToken = session.accessToken;
        tokenInput.value = session.accessToken;
        tokenHint.textContent = '已从 ChatGPT session 读取 accessToken。';
        tokenHint.classList.add('is-ok');
      }
      setStatus(linkStatus, response.message, response.ok ? 'ok' : 'error');
    } catch (error) {
      setStatus(linkStatus, `读取 session 失败：${String(error)}`, 'error');
    } finally {
      refreshSessionButton.disabled = false;
      sessionFetchInFlight = false;
    }
  }

  function setCheckoutOptions(optionsInput: unknown): void {
    const options = normalizeCheckoutOptions(optionsInput);
    planSelect.value = options.planName;
    uiModeSelect.value = options.uiMode;
    regionSelect.value = options.region;
    workspaceInput.value = options.workspaceName;
    seatsInput.value = String(options.seatQuantity);
    setLinkSummary(options);
  }

  function readCheckoutOptions(): CheckoutOptions {
    return normalizeCheckoutOptions({
      planName: planSelect.value,
      uiMode: uiModeSelect.value,
      region: regionSelect.value,
      workspaceName: workspaceInput.value,
      seatQuantity: Number(seatsInput.value || 5),
    });
  }

  function setLinkSummary(options: CheckoutOptions): void {
    const planText = options.planName === 'chatgptteamplan' ? `Team · ${options.seatQuantity} seats` : 'Plus';
    const modeText = options.uiMode === 'hosted' ? '长链接 hosted' : '短链接 custom';
    const sessionText = sessionFetchedOnce ? 'session 已请求' : 'session 待读取';
    linkSummary.textContent = `${planText} · ${modeText} · ${options.region} · ${sessionText}`;
    teamOptions.hidden = options.planName !== 'chatgptteamplan';
    regionField.hidden = options.planName === 'chatgptteamplan';
  }

  function normalizeTokenInput(showError: boolean): string {
    try {
      const token = extractAccessToken(tokenInput.value);
      if (tokenInput.value.trim() !== token) {
        tokenInput.value = token;
      }
      tokenHint.textContent = '已本地提取 accessToken。';
      tokenHint.classList.add('is-ok');
      return token;
    } catch (error) {
      tokenHint.classList.remove('is-ok');
      if (showError) {
        setStatus(linkStatus, errorMessage(error), 'error');
      }
      return '';
    }
  }

  function setGeneratedLink(link: string): void {
    generatedLink = link;
    linkOutput.value = link;
    copyLinkButton.disabled = !link;
    openLinkButton.disabled = !link;
  }

  function setSessionRows(email: string, planType: string, accessToken: string): void {
    emailValue.value.textContent = email || '未读取';
    planValue.value.textContent = planType || '未读取';
    tokenValue.value.textContent = accessToken ? '已获取' : '未获取';
  }
}

function createSessionRow(label: string, initialValue: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'opx-session-row';
  const labelElement = document.createElement('span');
  labelElement.textContent = label;
  const value = document.createElement('strong');
  value.textContent = initialValue;
  row.append(labelElement, value);
  return { row, value };
}

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function createInput(placeholder: string, type: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'opx-input';
  input.type = type;
  input.placeholder = placeholder;
  return input;
}

function createSelect(options: string[][]): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'opx-select';
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCheckoutLinkResponse(value: unknown): value is CheckoutLinkResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as CheckoutLinkResponse).ok === 'boolean' &&
      typeof (value as CheckoutLinkResponse).message === 'string',
  );
}

function isChatGptSessionResponse(value: unknown): value is ChatGptSessionResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ChatGptSessionResponse).ok === 'boolean' &&
      typeof (value as ChatGptSessionResponse).message === 'string',
  );
}

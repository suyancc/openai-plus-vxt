import type { ActionResult } from '../../app/types';
import { countryIsoToCallingCode } from '../oauth-phone/country-map';
import { extractOpenAiPhoneChannelSupportFromPage } from '../oauth-phone/openai-channel-support';

const COUNTRY_SEARCH_ROOT_ID = 'opx-oauth-phone-country-search';
const COUNTRY_SEARCH_STYLE_ID = 'opx-oauth-phone-country-search-style';
const COUNTRY_SEARCH_INSTALLED_KEY = '__opx_oauth_phone_country_search_installed__';

export interface OAuthPhoneFillPayload {
  countryIso: string;
  phoneNumber: string;
}

export type OAuthPhonePageStateKind =
  | 'none'
  | 'phone-rejected'
  | 'session-expired'
  | 'whatsapp-verification'
  | 'sms-verification';

export interface OAuthPhonePageState {
  kind: OAuthPhonePageStateKind;
  message: string;
  url: string;
  details?: string;
}

interface CountrySearchOption {
  iso: string;
  name: string;
  englishName: string;
  chineseName: string;
  callingCode: string;
  searchText: string;
}

export function initOAuthPhoneCountrySearch(): void {
  const scope = globalThis as unknown as Record<string, boolean | undefined>;
  if (scope[COUNTRY_SEARCH_INSTALLED_KEY]) {
    return;
  }
  scope[COUNTRY_SEARCH_INSTALLED_KEY] = true;

  installCountrySearchStyle();
  const render = () => {
    if (!isAddPhonePage()) {
      document.getElementById(COUNTRY_SEARCH_ROOT_ID)?.remove();
      return;
    }
    ensureCountrySearch();
  };
  render();
  window.setInterval(render, 700);
}

export async function chooseOAuthExistingAccount(): Promise<ActionResult> {
  if (!isChooseAccountPage()) {
    return fail('当前页面不是选择账号页');
  }
  const button = await waitForExistingAccountButton(15_000);
  if (!button) {
    return fail(`没有找到已有账号按钮，页面状态：${document.readyState}`);
  }
  if (!isClickable(button)) {
    await waitForClickable(button, 3000);
  }
  if (!isClickable(button)) {
    return fail(`已有账号按钮不可点击，页面状态：${document.readyState}`);
  }
  button.click();
  return ok('已点击已有账号');
}

export function getOAuthPhoneChannelSupport(): ActionResult {
  if (!isAddPhonePage()) {
    return fail('当前页面不是手机号添加页');
  }
  const support = extractOpenAiPhoneChannelSupportFromPage();
  return {
    ok: true,
    message: `已读取 OpenAI 手机渠道：SMS 优先 ${support.smsFirstCountries.length} 个，WhatsApp 优先 ${support.whatsappFirstCountries.length} 个`,
    data: support,
  };
}

export function inspectOAuthPhonePageState(): ActionResult {
  const state = readOAuthPhonePageState();
  return {
    ok: true,
    message: state.message,
    data: state,
  };
}

export async function fillOAuthPhoneAndContinue(payload: OAuthPhoneFillPayload): Promise<ActionResult> {
  if (!isAddPhonePage()) {
    return fail('当前页面不是手机号添加页');
  }
  const countryIso = payload.countryIso.trim().toUpperCase();
  if (!countryIso) {
    return fail('缺少 OpenAI 页面国家 ISO');
  }

  const countryResult = await selectCountry(countryIso);
  logOAuthPhonePage('select-country', { countryIso, ok: countryResult.ok, message: countryResult.message });
  if (!countryResult.ok) {
    return countryResult;
  }
  await waitForUiTick(180);

  const expectedCallingCode = countryIsoToCallingCode(countryIso);
  const selectedCallingCode = await waitForSelectedCallingCode(expectedCallingCode, 2200);
  if (expectedCallingCode && selectedCallingCode && selectedCallingCode !== expectedCallingCode) {
    logOAuthPhonePage('country-calling-code-mismatch', {
      countryIso,
      expectedCallingCode,
      selectedCallingCode,
    });
    return fail(`国家 ${countryIso} 区号未切换成功，当前 +${selectedCallingCode}，预期 +${expectedCallingCode}`);
  }

  const callingCode = selectedCallingCode || expectedCallingCode;
  const phone = normalizePhoneForInput(payload.phoneNumber, callingCode);
  logOAuthPhonePage('normalize-phone', {
    countryIso,
    rawPhone: maskPhone(payload.phoneNumber),
    expectedCallingCode,
    selectedCallingCode,
    callingCode,
    inputPhone: maskPhone(phone),
  });
  if (!phone) {
    return fail('接码平台没有返回手机号');
  }

  const input = findPhoneInput();
  if (!input) {
    return fail('没有找到手机号输入框');
  }
  focusInput(input);
  setNativeValue(input, phone);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: phone }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUiTick(160);
  logOAuthPhonePage('phone-input-written', {
    inputValue: input.value,
    selectedCallingCode: readSelectedCallingCode(),
  });

  const button = findSubmitButton();
  if (!button) {
    return fail('没有找到手机号继续按钮');
  }
  if (!isClickable(button)) {
    await waitForClickable(button, 2500);
  }
  if (!isClickable(button)) {
    return fail('手机号继续按钮不可点击');
  }
  button.click();
  logOAuthPhonePage('phone-submit-clicked');
  return ok(`已填写手机号 ${maskPhone(payload.phoneNumber)} 并点击继续`);
}

function readOAuthPhonePageState(): OAuthPhonePageState {
  const sessionExpired = findSessionExpiredMessage();
  if (sessionExpired) {
    return pageState('session-expired', 'OAuth 登录会话已失效，需要重新创建授权链接', sessionExpired);
  }

  if (isAddPhonePage()) {
    const rejection = findPhoneRejectionMessage();
    if (rejection) {
      return pageState('phone-rejected', rejection, rejection);
    }
    return pageState('none', 'add-phone 页面暂无错误');
  }

  if (isPhoneVerificationPage()) {
    const whatsappButton = findWhatsAppResendButton();
    if (whatsappButton) {
      const text = normalizeVisibleText(whatsappButton.textContent || '');
      return pageState('whatsapp-verification', '当前号码进入 WhatsApp 验证页，等待接码超时后重试', text || 'WhatsApp resend');
    }
    if (findPhoneCodeInput()) {
      return pageState('sms-verification', '手机短信验证码页已就绪');
    }
    return pageState('none', '手机验证页已打开，等待验证码输入框渲染');
  }

  return pageState('none', '当前页面没有手机号验证状态');
}

function findSessionExpiredMessage(): string {
  const text = readBodyText();
  const patterns = [
    '您的登录会话已失效',
    '登录会话已失效',
    'login session has expired',
    'session has expired',
  ];
  return findMatchedText(text, patterns);
}

function findPhoneRejectionMessage(): string {
  const patterns = [
    '该电话号码已被使用',
    '此电话号码已关联到可关联的最多账户',
    '请使用其他电话号码',
    '无法向此电话号码发送验证码',
    '虚拟号码',
    '虚拟电话号码',
    '非虚拟电话号码',
    '也称为 voip',
    'maximum number of accounts',
    'phone number has already been linked',
    'unable to send a verification code to this phone number',
    "couldn't send a text message to this phone number",
    'could not send a text message to this phone number',
    'switched to whatsapp',
    'continue to send a verification code on whatsapp',
    'this phone number is already in use',
    'virtual number',
    'virtual phone',
    'virtual phone number',
    'voip',
    'non-virtual phone number',
    'valid non-virtual',
  ];
  const errorText = Array.from(document.querySelectorAll<HTMLElement>('[aria-live] li, [role="alert"], [class*="error"], [class*="Error"]'))
    .filter((element) => isVisible(element))
    .map((element) => normalizeVisibleText(element.textContent || ''))
    .filter(Boolean)
    .join('\n');
  return findMatchedText(errorText, patterns) || findMatchedText(readBodyText(), patterns);
}

function findWhatsAppResendButton(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[name="intent"][value="resend"], button[type="submit"], button'))
    .find((button) => {
      const text = normalizeVisibleText(button.textContent || '');
      return isVisible(button) && /whatsapp/i.test(text) && (
        text.includes('重新发送') ||
        text.toLowerCase().includes('resend')
      );
    }) || null;
}

function findPhoneCodeInput(): HTMLInputElement | null {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'))
    .find((input) => isVisible(input)) || null;
}

function pageState(kind: OAuthPhonePageStateKind, message: string, details = ''): OAuthPhonePageState {
  return {
    kind,
    message,
    details,
    url: location.href,
  };
}

function readBodyText(): string {
  return normalizeVisibleText(document.body?.innerText || document.body?.textContent || '');
}

function findMatchedText(text: string, patterns: string[]): string {
  const normalized = text.toLowerCase();
  const pattern = patterns.find((item) => normalized.includes(item.toLowerCase()));
  if (!pattern) {
    return '';
  }
  if (text.length <= 180) {
    return text;
  }
  const index = Math.max(0, normalized.indexOf(pattern.toLowerCase()));
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + pattern.length + 90);
  return text.slice(start, end).trim();
}

function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function fillOAuthPhoneCodeAndContinue(code: string): Promise<ActionResult> {
  if (!isPhoneVerificationPage()) {
    return fail('当前页面不是手机验证码页');
  }
  const normalized = code.replace(/\D/g, '').slice(0, 8);
  if (!normalized) {
    return fail('手机验证码为空');
  }
  const input = document.querySelector<HTMLInputElement>('input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]');
  if (!input) {
    return fail('没有找到手机验证码输入框');
  }
  focusInput(input);
  setNativeValue(input, normalized);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: normalized }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForUiTick(120);
  logOAuthPhonePage('code-input-written', { code: normalized, inputValueLength: input.value.length });

  const button = findSubmitButton('validate');
  if (!button) {
    return fail('没有找到验证码继续按钮');
  }
  if (!isClickable(button)) {
    await waitForClickable(button, 2500);
  }
  if (!isClickable(button)) {
    return fail('验证码继续按钮不可点击');
  }
  button.click();
  logOAuthPhonePage('code-submit-clicked', { code: normalized });
  return ok(`已提交手机验证码 ${normalized}`);
}

export async function continueOAuthConsent(): Promise<ActionResult> {
  if (!isConsentPage()) {
    return fail('当前页面不是 Codex consent 页');
  }
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"], button')).find((item) => {
    const text = (item.textContent || '').trim().toLowerCase();
    return isVisible(item) && (text === '继续' || text === 'continue');
  }) || null;
  if (!button) {
    return fail('没有找到 consent 继续按钮');
  }
  if (!isClickable(button)) {
    await waitForClickable(button, 2500);
  }
  if (!isClickable(button)) {
    return fail('consent 继续按钮不可点击');
  }
  button.click();
  logOAuthPhonePage('consent-submit-clicked');
  return ok('已点击 Codex consent 继续');
}

function isChooseAccountPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/choose-an-account');
}

async function waitForExistingAccountButton(timeoutMs: number): Promise<HTMLButtonElement | null> {
  const startedAt = Date.now();
  let button = findExistingAccountButton();
  while (!button && Date.now() - startedAt < timeoutMs) {
    await waitForUiTick(200);
    button = findExistingAccountButton();
  }
  return button;
}

function findExistingAccountButton(): HTMLButtonElement | null {
  const selectors = [
    'button[name="session_id"]',
    'button[data-dd-action-name="Select existing session"]',
    'button[value^="us_"]',
  ];
  for (const selector of selectors) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button && isVisible(button)) {
      return button;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const text = normalizeVisibleText(button.textContent || '');
    return isVisible(button) && (
      text.includes('选择帐户') ||
      text.includes('选择账户') ||
      text.toLowerCase().includes('select account')
    );
  }) || null;
}

function isAddPhonePage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/add-phone');
}

function isPhoneVerificationPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/phone-verification');
}

function isConsentPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/sign-in-with-chatgpt/codex/consent');
}

function ensureCountrySearch(): void {
  const selectRoot = document.querySelector<HTMLElement>('.react-aria-Select');
  const selectButton = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  const hiddenSelect = document.querySelector<HTMLSelectElement>('select');
  if (!selectRoot || !selectButton || !hiddenSelect) {
    return;
  }

  let root = document.getElementById(COUNTRY_SEARCH_ROOT_ID) as HTMLElement | null;
  if (!root) {
    root = createCountrySearchRoot();
  }

  if (root.nextElementSibling !== selectRoot) {
    selectRoot.parentElement?.insertBefore(root, selectRoot);
  }
  const input = root.querySelector<HTMLInputElement>('.opx-oauth-phone-country-search-input');
  updateCountrySearchResults(root, input?.value || '', document.activeElement === input);
}

function createCountrySearchRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = COUNTRY_SEARCH_ROOT_ID;
  root.className = 'opx-oauth-phone-country-search';

  const input = document.createElement('input');
  input.className = 'opx-oauth-phone-country-search-input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = '搜索国家 / ISO / +区号';

  const results = document.createElement('div');
  results.className = 'opx-oauth-phone-country-search-results';
  results.hidden = true;

  input.addEventListener('input', () => updateCountrySearchResults(root, input.value, true));
  input.addEventListener('focus', () => updateCountrySearchResults(root, input.value, true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      results.hidden = true;
      input.blur();
    }
  });
  document.addEventListener('click', (event) => {
    if (!root.contains(event.target as Node)) {
      results.hidden = true;
    }
  });

  root.append(input, results);
  return root;
}

function updateCountrySearchResults(root: HTMLElement, query: string, openResults: boolean): void {
  const input = root.querySelector<HTMLInputElement>('.opx-oauth-phone-country-search-input');
  const results = root.querySelector<HTMLElement>('.opx-oauth-phone-country-search-results');
  if (!input || !results) {
    return;
  }
  const options = readCountrySearchOptions();
  const normalizedQuery = normalizeSearchText(query);
  const matches = normalizedQuery
    ? options.filter((option) => option.searchText.includes(normalizedQuery)).slice(0, 8)
    : options.filter((option) => option.iso === getSelectedCountryIso()).slice(0, 1);

  results.textContent = '';
  for (const option of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'opx-oauth-phone-country-search-option';
    button.dataset.iso = option.iso;

    const main = document.createElement('span');
    main.className = 'opx-oauth-phone-country-search-main';
    main.textContent = `${option.name} / ${option.iso}`;

    const meta = document.createElement('span');
    meta.className = 'opx-oauth-phone-country-search-meta';
    meta.textContent = option.callingCode ? `+${option.callingCode}` : '';

    button.append(main, meta);
    button.addEventListener('click', async () => {
      input.value = `${option.name} (+${option.callingCode || ''})`;
      results.hidden = true;
      const selected = await selectCountry(option.iso);
      logOAuthPhonePage('country-search-selected', {
        countryIso: option.iso,
        query,
        ok: selected.ok,
        message: selected.message,
      });
      await waitForUiTick(180);
      const current = readCountrySearchOptions().find((item) => item.iso === option.iso);
      input.value = current ? formatCountrySearchInputValue(current) : input.value;
    });
    results.append(button);
  }

  if (!matches.length && normalizedQuery) {
    const empty = document.createElement('div');
    empty.className = 'opx-oauth-phone-country-search-empty';
    empty.textContent = '没有匹配国家';
    results.append(empty);
  }
  if (!document.activeElement || document.activeElement !== input) {
    const selected = options.find((option) => option.iso === getSelectedCountryIso());
    if (selected) {
      input.value = formatCountrySearchInputValue(selected);
    }
  }
  results.hidden = !openResults || (!normalizedQuery && matches.length <= 1);
}

function readCountrySearchOptions(): CountrySearchOption[] {
  const select = document.querySelector<HTMLSelectElement>('select');
  if (!select) {
    return [];
  }
  return Array.from(select.options)
    .filter((option) => option.value)
    .map((option) => {
      const iso = option.value.trim().toUpperCase();
      const name = (option.textContent || iso).trim();
      const callingCode = countryIsoToCallingCode(iso);
      const englishName = option.getAttribute('aria-label') || '';
      const chineseName = name;
      const searchText = normalizeSearchText([
        iso,
        name,
        englishName,
        chineseName,
        callingCode,
        callingCode ? `+${callingCode}` : '',
      ].filter(Boolean).join(' '));
      return {
        iso,
        name,
        englishName,
        chineseName,
        callingCode,
        searchText,
      };
    });
}

function getSelectedCountryIso(): string {
  const select = document.querySelector<HTMLSelectElement>('select');
  return String(select?.value || '').trim().toUpperCase();
}

function formatCountrySearchInputValue(option: CountrySearchOption): string {
  return option.callingCode ? `${option.name} (+${option.callingCode})` : `${option.name} / ${option.iso}`;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, '');
}

function installCountrySearchStyle(): void {
  if (document.getElementById(COUNTRY_SEARCH_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = COUNTRY_SEARCH_STYLE_ID;
  style.textContent = `
    #${COUNTRY_SEARCH_ROOT_ID} {
      position: relative;
      z-index: 20;
      width: 100%;
      margin: 0 0 8px;
      font-family: inherit;
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-input {
      box-sizing: border-box;
      width: 100%;
      height: 42px;
      padding: 0 12px;
      border: 1px solid rgba(0, 0, 0, 0.14);
      border-radius: 8px;
      background: #fff;
      color: #0f172a;
      font: inherit;
      font-size: 14px;
      outline: none;
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-input:focus {
      border-color: rgba(16, 163, 127, 0.85);
      box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.16);
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 250px;
      overflow-y: auto;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      min-height: 38px;
      padding: 8px 10px;
      border: 0;
      background: transparent;
      color: #0f172a;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-option:hover {
      background: rgba(16, 163, 127, 0.1);
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-main {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-meta {
      flex: 0 0 auto;
      color: #64748b;
      font-variant-numeric: tabular-nums;
    }
    #${COUNTRY_SEARCH_ROOT_ID} .opx-oauth-phone-country-search-empty {
      padding: 10px;
      color: #64748b;
      font-size: 13px;
    }
  `;
  document.documentElement.append(style);
}

async function selectCountry(countryIso: string): Promise<ActionResult> {
  const normalized = countryIso.trim().toUpperCase();
  const hiddenResult = selectHiddenCountry(normalized);
  await waitForUiTick(160);
  const listboxResult = await selectCountryFromListbox(normalized);
  if (listboxResult.ok) {
    return listboxResult;
  }
  logOAuthPhonePage('country-listbox-fallback', {
    countryIso: normalized,
    hiddenOk: hiddenResult.ok,
    listboxMessage: listboxResult.message,
  });
  return hiddenResult.ok ? hiddenResult : listboxResult;
}

function selectHiddenCountry(countryIso: string): ActionResult {
  const select = document.querySelector<HTMLSelectElement>('select');
  if (!select) {
    return fail('没有找到国家下拉框');
  }
  const option = Array.from(select.options).find((item) => item.value.toUpperCase() === countryIso);
  if (!option) {
    return fail(`OpenAI 手机号页面不支持国家 ${countryIso}`);
  }
  select.value = option.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return ok(`已选择国家 ${countryIso}`);
}

async function selectCountryFromListbox(countryIso: string): Promise<ActionResult> {
  const button = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  if (!button) {
    return fail('没有找到国家选择按钮');
  }
  button.click();
  await waitForUiTick(220);

  const clicked = await clickCountryOption(countryIso);
  if (clicked.ok) {
    return clicked;
  }

  button.click();
  return clicked;
}

async function clickCountryOption(countryIso: string): Promise<ActionResult> {
  const select = document.querySelector<HTMLSelectElement>('select');
  const index = select
    ? Array.from(select.options).filter((option) => option.value).findIndex((option) => option.value.toUpperCase() === countryIso)
    : -1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const option = document.querySelector<HTMLElement>(`[role="option"][data-key="${countryIso}"]`);
    if (option) {
      option.scrollIntoView({ block: 'center', inline: 'nearest' });
      option.click();
      await waitForUiTick(180);
      logOAuthPhonePage('country-option-clicked', { countryIso });
      return ok(`已在国家列表选择 ${countryIso}`);
    }

    const scroller = findCountryListScroller();
    if (!scroller || index < 0) {
      break;
    }
    scroller.scrollTop = Math.max(0, (index - 3) * 40);
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitForUiTick(180);
  }

  return fail(`没有在国家列表找到 ${countryIso}`);
}

function findCountryListScroller(): HTMLElement | null {
  const option = document.querySelector('[role="option"]');
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('div')).filter((element) => {
    if (!option || !element.contains(option)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return element.scrollHeight > element.clientHeight + 120 &&
      (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay');
  });
  return candidates.sort((left, right) => left.clientHeight - right.clientHeight)[0] || null;
}

function findPhoneInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input#tel, input[name="__reservedForPhoneNumberInput_tel"], input[autocomplete="tel"], input[type="tel"]');
}

function findSubmitButton(intent?: string): HTMLButtonElement | null {
  if (intent) {
    const byIntent = document.querySelector<HTMLButtonElement>(`button[type="submit"][name="intent"][value="${intent}"]`);
    if (byIntent) {
      return byIntent;
    }
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"], button')).find((button) => {
    const text = (button.textContent || '').trim().toLowerCase();
    return isVisible(button) && (text === '继续' || text === 'continue');
  }) ?? null;
}

function focusInput(input: HTMLInputElement): void {
  input.scrollIntoView({ block: 'center', inline: 'center' });
  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(0, input.value.length);
  } catch {
    // Some phone inputs do not support selection ranges.
  }
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
}

function normalizePhoneForInput(value: string, callingCode = ''): string {
  const digits = value.replace(/[^\d]/g, '');
  const prefix = callingCode.replace(/[^\d]/g, '');
  if (prefix && digits.startsWith(prefix) && digits.length > prefix.length + 4) {
    return digits.slice(prefix.length);
  }
  return digits;
}

function readSelectedCallingCode(): string {
  const input = findPhoneInput();
  const container = input?.closest('div');
  const decoration = container?.querySelector<HTMLElement>('[class*="inputDecorationCountryCode"]');
  const text = decoration?.textContent || '';
  if (text.trim()) {
    return text;
  }
  const selectedText = document.querySelector<HTMLElement>('.react-aria-SelectValue')?.textContent || '';
  const match = selectedText.match(/\+(\d+)/);
  return match?.[1] || '';
}

async function waitForSelectedCallingCode(expectedCallingCode: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let current = readSelectedCallingCode();
  const expected = expectedCallingCode.replace(/[^\d]/g, '');
  while (expected && current !== expected && Date.now() < deadline) {
    await waitForUiTick(120);
    current = readSelectedCallingCode();
  }
  return current;
}

function maskPhone(value: string): string {
  const digits = normalizePhoneForInput(value);
  return digits.length > 4 ? `${digits.slice(0, 3)}***${digits.slice(-4)}` : digits;
}

function isClickable(button: HTMLButtonElement): boolean {
  return isVisible(button) &&
    !button.disabled &&
    button.getAttribute('aria-disabled') !== 'true';
}

function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  const style = window.getComputedStyle(html);
  const rect = html.getBoundingClientRect();
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0;
}

function waitForClickable(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (isClickable(button) || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

function waitForUiTick(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function logOAuthPhonePage(stage: string, data?: Record<string, unknown>): void {
  const prefix = `[OPX OAuthPhone Page] ${stage}`;
  if (data) {
    console.info(prefix, data);
    return;
  }
  console.info(prefix);
}

function ok(message: string): ActionResult {
  return { ok: true, message };
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

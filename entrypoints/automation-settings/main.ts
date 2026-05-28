import './style.css';

import { loadAutomationState } from '../../src/app/state';
import { flashButtonLabel, setButtonPending } from '../../src/app/button-feedback';
import {
  DEFAULT_CHECKOUT_EXTRACT_MODE,
  DEFAULT_CHECKOUT_OPTIONS,
  normalizeCheckoutExtractMode,
  normalizeCheckoutOptions,
} from '../../src/features/link-extractor/checkout';
import {
  clearAutomationGeneratedFiles,
  parseAutomationSettings,
  saveAutomationSettings,
  updateAutomationEmails,
  updateAutomationSmsTargets,
} from '../../src/features/automation/state';
import { runAutomationForEmail } from '../../src/features/automation/runner';
import type {
  AutomationEmailAccount,
  AutomationSettings,
  AutomationSmsTarget,
  AutomationState,
} from '../../src/features/automation/types';
import type { CheckoutExtractMode } from '../../src/features/link-extractor/types';
import { OAUTH_PHONE_PROVIDER_DEFINITIONS } from '../../src/features/oauth-phone/providers';
import {
  formatOpenAiPhoneChannelLabel,
  isOpenAiPhoneSmsFirst,
  isOpenAiPhoneWhatsappFirst,
  resolveOpenAiPhoneOfferCountryIso,
  resolveOpenAiPhoneOfferSupport,
  type OpenAiPhoneChannelSupport,
} from '../../src/features/oauth-phone/openai-channel-support';
import {
  fetchOAuthPhoneOfferMatrix,
  testOAuthPhoneProvider,
} from '../../src/features/oauth-phone/service';
import {
  loadOAuthPhoneSettings,
  maskOAuthPhoneApiKey,
  parseOAuthPhoneApiTargets,
  saveOAuthPhoneSettings,
} from '../../src/features/oauth-phone/state';
import type {
  OAuthPhoneApiTarget,
  OAuthPhonePriceOffer,
  OAuthPhoneProviderId,
  OAuthPhoneProviderSelectionMode,
  OAuthPhoneSelectedOffer,
  OAuthPhoneSettings,
} from '../../src/features/oauth-phone/types';

type PasteImportDialogOptions = {
  title: string;
  description: string;
  placeholder: string;
  confirmText: string;
  onConfirm: (text: string) => void;
};

const app = document.querySelector<HTMLElement>('#app');
let statusTooltipBound = false;

if (app) {
  void render();
}

async function render(): Promise<void> {
  const state = await loadAutomationState();
  const oauthPhone = await loadOAuthPhoneSettings();
  const checkoutOptions = normalizeCheckoutOptions({
    ...DEFAULT_CHECKOUT_OPTIONS,
    ...state.settings.checkoutOptions,
  });
  const checkoutExtractMode = normalizeCheckoutExtractMode(state.settings.checkoutExtractMode || DEFAULT_CHECKOUT_EXTRACT_MODE);
  const generatedFiles = state.generatedFiles;
  const latestGenerated = generatedFiles.records[0] || null;
  const hasSub2api = Boolean(generatedFiles.sub2apiJson.trim());
  const hasCpa = Boolean(generatedFiles.cpaJson.trim());

  app!.innerHTML = `
    <section class="page">
      <div class="topbar">
        <div>
          <h1 class="title">自动化设置</h1>
          <p class="subtitle">邮箱验证码使用 Outlook 本地服务；支付/手机号验证码从接码池选择。</p>
        </div>
        <div class="button-row">
          <button id="btn-copy-diagnostics" class="button secondary" type="button">复制诊断报告</button>
          <button id="btn-save" class="button" type="button">保存设置</button>
          <button id="btn-close" class="button secondary" type="button">关闭</button>
        </div>
      </div>
      <div class="grid settings-accordion">
        <details class="settings-panel" open>
          <summary class="settings-panel-summary">
            <span>
              <strong>邮箱池</strong>
              <em>${state.emails.length} 个邮箱 · ${state.emails.filter((email) => email.status === 'error').length} 个失败</em>
            </span>
            <b>展开</b>
          </summary>
          <div class="settings-panel-body">
          <div class="table-head">
            <div>
              <h3>邮箱池</h3>
              <p class="hint">凭证和 token 在表格中脱敏显示，完整内容只保存在本地设置。</p>
            </div>
            <div class="table-actions">
              <button id="btn-clear-emails" class="button secondary small" type="button">清除全部</button>
              <button id="btn-restore-emails" class="button secondary small" type="button">恢复全部</button>
              <button id="btn-import-emails" class="button secondary small" type="button">导入</button>
              <button id="btn-refresh-emails" class="button secondary small" type="button">刷新</button>
            </div>
          </div>
          <textarea id="raw-emails" class="raw-store" spellcheck="false">${escapeHtml(state.settings.rawEmails)}</textarea>
          <div id="email-summary" class="pool-summary"></div>
          <div id="email-table" class="table-wrap email-table-wrap"></div>
          <div class="row row-three">
            <label class="field">
              <span>邮箱选择</span>
              <select id="email-mode" class="select">
                <option value="next"${state.settings.emailSelectionMode === 'next' ? ' selected' : ''}>自动选择未执行邮箱</option>
                <option value="specified"${state.settings.emailSelectionMode === 'specified' ? ' selected' : ''}>执行指定邮箱</option>
              </select>
            </label>
            <label class="field">
              <span>指定邮箱</span>
              <select id="specified-email" class="select"></select>
            </label>
          </div>
          </div>
        </details>

        <details class="settings-panel">
          <summary class="settings-panel-summary">
            <span>
              <strong>接码池</strong>
              <em>${state.smsTargets.length} 个号码 · ${state.smsTargets.filter((target) => target.disabled).length} 个不可用</em>
            </span>
            <b>展开</b>
          </summary>
          <div class="settings-panel-body">
          <div class="table-head">
            <div>
              <h3>接码池</h3>
              <p class="hint">一般保留 3 个号码即可，API 链接会截断显示。</p>
            </div>
            <div class="table-actions">
              <button id="btn-clear-sms" class="button secondary small" type="button">清除全部</button>
              <button id="btn-import-sms" class="button secondary small" type="button">导入</button>
              <button id="btn-refresh-sms" class="button secondary small" type="button">刷新</button>
            </div>
          </div>
          <textarea id="raw-sms" class="raw-store" spellcheck="false">${escapeHtml(state.settings.rawSms)}</textarea>
          <div id="sms-table" class="table-wrap sms-table-wrap"></div>
          <div class="row compact">
            <label class="field">
              <span>接码选择</span>
              <select id="sms-mode" class="select">
                <option value="random"${state.settings.smsSelectionMode === 'random' ? ' selected' : ''}>随机抽取低频号码</option>
                <option value="next"${state.settings.smsSelectionMode === 'next' ? ' selected' : ''}>按使用次数最少</option>
              </select>
            </label>
          </div>
          </div>
        </details>

        <details class="settings-panel" open>
          <summary class="settings-panel-summary">
            <span>
              <strong>提取设置</strong>
              <em>${checkoutExtractMode === 'server' ? '服务器 API' : '本地提取'} · OAuth ${state.settings.oauthExtractMode === 'direct' ? '直接生成' : '邮箱接码提取'} · 手机接码 ${oauthPhone.enabled ? '启用' : '关闭'}</em>
            </span>
            <b>展开</b>
          </summary>
          <div class="settings-panel-body">
          <div class="row">
            <label class="field">
              <span>支付链接提取模式</span>
              <select id="checkout-extract-mode" class="select">
                ${option('local', '本地提取 （需要本地JP代理）', checkoutExtractMode)}
                ${option('server', '服务器 API （无需任何代理）', checkoutExtractMode)}
              </select>
            </label>
          </div>
          <div class="row">
            <label class="field">
              <span>提取 OAuth 方式</span>
              <select id="oauth-extract-mode" class="select">
                ${option('email', '邮箱接码提取', state.settings.oauthExtractMode)}
                ${option('direct', '直接生成文件', state.settings.oauthExtractMode)}
              </select>
            </label>
            <label class="field">
              <span>执行账号数</span>
              <input id="batch-account-limit" class="input" type="number" min="1" max="999" step="1" value="${state.settings.batchAccountLimit}" />
            </label>
          </div>
          <div id="checkout-options-row" class="row row-three">
            <label class="field">
              <span>套餐</span>
              <select id="checkout-plan" class="select">
                ${option('chatgptplusplan', 'ChatGPT Plus', checkoutOptions.planName)}
                ${option('chatgptteamplan', 'ChatGPT Team', checkoutOptions.planName)}
              </select>
            </label>
            <label class="field">
              <span>链接形式</span>
              <select id="checkout-ui-mode" class="select">
                ${option('hosted', '长链接 / hosted', checkoutOptions.uiMode)}
                ${option('custom', '短链接 / custom', checkoutOptions.uiMode)}
              </select>
            </label>
            <label class="field">
              <span>计费区域</span>
              <select id="checkout-region" class="select">
                ${option('US', '美国 / USD', checkoutOptions.region)}
                ${option('ID', '印尼 / IDR', checkoutOptions.region)}
                ${option('DE', '德国 / EUR', checkoutOptions.region)}
                ${option('JP', '日本 / JPY', checkoutOptions.region)}
              </select>
            </label>
          </div>
          <label class="check-row">
            <input id="stop-on-error" type="checkbox"${state.settings.stopOnError ? ' checked' : ''} />
            <span>步骤失败后停止自动执行</span>
          </label>
          <label class="check-row">
            <input id="auto-open-checkout" type="checkbox"${state.settings.autoOpenCheckout ? ' checked' : ''} />
            <span>生成订阅链接后自动打开</span>
          </label>
          <label class="check-row">
            <input id="debug-mode" type="checkbox"${state.settings.debugMode ? ' checked' : ''} />
            <span>调试模式：记录详细步骤、页面状态和失败诊断</span>
          </label>

          <div id="oauth-phone-section" class="subsection">
            <div class="card-head">
              <div>
                <h3>OAuth 手机接码</h3>
                <p class="hint">独立于 PayPal 接码池，可选择接码平台或 API 接码池用于 OAuth 手机验证。</p>
              </div>
              <button id="btn-save-oauth-phone" class="button secondary small" type="button">保存接码设置</button>
            </div>
            <label class="check-row">
              <input id="oauth-phone-enabled" type="checkbox"${oauthPhone.enabled ? ' checked' : ''} />
              <span>启用 OAuth 手机接码模块</span>
            </label>
            <div class="row oauth-phone-mode-row">
              <label class="field">
                <span>接码模式</span>
                <select id="oauth-phone-source-mode" class="select">
                  ${option('provider', '接码平台接码', oauthPhone.sourceMode)}
                  ${option('api', 'API 接码池', oauthPhone.sourceMode)}
                </select>
              </label>
              <label class="field">
                <span>接码超时</span>
                <input id="oauth-phone-timeout" class="input" type="number" min="15" max="600" step="1" value="${oauthPhone.smsTimeoutSeconds || 120}" />
              </label>
            </div>
            <div class="row row-three oauth-provider-mode-panel">
              <label class="field">
                <span>快速切换平台</span>
                <select id="oauth-phone-active-provider" class="select">
                  ${oauthPhoneProviderOptions(oauthPhone.activeProviderId)}
                </select>
              </label>
              <label class="field">
                <span>平台选择策略</span>
                <select id="oauth-phone-provider-mode" class="select">
                  ${option('priority', '优先当前平台', oauthPhone.providerMode)}
                  ${option('lowest-price', '价格最低优先', oauthPhone.providerMode)}
                  ${option('highest-stock', '库存最多优先', oauthPhone.providerMode)}
                </select>
              </label>
              <label class="field">
                <span>服务代码（OpenAI/ChatGPT 默认 dr）</span>
                <input id="oauth-phone-service-code" class="input" value="${escapeAttr(oauthPhone.serviceCode)}" placeholder="dr" />
              </label>
            </div>
            <div class="row compact oauth-provider-mode-panel">
              <div class="field">
                <span>已选择报价</span>
                <div id="oauth-phone-selected-summary" class="pool-summary">${oauthPhone.selectedOffers.length ? `${oauthPhone.selectedOffers.length} 个报价` : '未选择报价'}</div>
              </div>
            </div>
            <div class="table-wrap oauth-phone-table-wrap oauth-provider-mode-panel">
              <table class="data-table oauth-phone-table">
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>启用</th>
                    <th>API key</th>
                    <th>优先级</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${oauthPhone.providers.map((provider) => `
                    <tr data-provider-id="${escapeAttr(provider.id)}">
                      <td><strong class="email-text">${escapeHtml(providerLabel(provider.id))}</strong></td>
                      <td><input id="oauth-phone-provider-enabled-${provider.id}" type="checkbox"${provider.enabled ? ' checked' : ''} /></td>
                      <td>
                        <input id="oauth-phone-provider-key-${provider.id}" class="input compact-input" type="password" value="${escapeAttr(provider.apiKey)}" placeholder="${escapeAttr(maskOAuthPhoneApiKey(provider.apiKey) || 'API key')}" autocomplete="off" />
                      </td>
                      <td>
                        <input id="oauth-phone-provider-priority-${provider.id}" class="input compact-input" type="number" min="1" max="99" step="1" value="${provider.priority}" />
                      </td>
                      <td><span id="oauth-phone-provider-status-${provider.id}" class="status-pill" data-status="${provider.enabled ? 'idle' : 'error'}">${provider.enabled ? '待测试' : '未启用'}</span></td>
                      <td>
                        <div class="table-action-group">
                          <button id="btn-test-oauth-phone-${provider.id}" class="table-action-button" type="button">测试</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <div class="table-head compact oauth-provider-mode-panel">
              <div>
                <h3>可用报价</h3>
                <p class="hint">自动去除单价为 0 或余量为 0 的报价，价格统一显示为美元；Tiger SMS 会从 ₽ 按默认汇率换算。</p>
              </div>
              <div class="table-actions">
                <button id="btn-refresh-oauth-phone-offers" class="button secondary small" type="button">刷新报价</button>
              </div>
            </div>
            <div class="oauth-offer-controls oauth-provider-mode-panel">
              <label class="field offer-search-field">
                <span>搜索国家</span>
                <input id="oauth-offer-search" class="input" value="" placeholder="国家 / ID / ISO / 平台" />
              </label>
              <label class="field offer-channel-field">
                <span>OpenAI 渠道</span>
                <select id="oauth-offer-channel-filter" class="select">
                  ${option('all', '全部渠道', 'all')}
                  ${option('sms', 'SMS 优先', 'all')}
                  ${option('whatsapp', 'WhatsApp 优先', 'all')}
                </select>
              </label>
              <label class="field offer-filter-field">
                <span>使用状态</span>
                <select id="oauth-offer-use-filter" class="select">
                  ${option('all', '全部报价', 'all')}
                  ${option('selected', '已使用', 'all')}
                  ${option('unselected', '未使用', 'all')}
                </select>
              </label>
              <label class="field offer-sort-field">
                <span>排序方式</span>
                <select id="oauth-offer-sort" class="select">
                  ${option('price-asc', '单价从低到高', 'price-asc')}
                  ${option('price-desc', '单价从高到低', 'price-asc')}
                  ${option('stock-desc', '余量从高到低', 'price-asc')}
                  ${option('stock-asc', '余量从低到高', 'price-asc')}
                </select>
              </label>
              <label class="field offer-price-field">
                <span>最低接受价格</span>
                <input id="oauth-phone-min-price" class="input" type="number" min="0" step="0.0001" value="${oauthPhone.minPrice || ''}" placeholder="0 表示不限制" />
              </label>
              <label class="field offer-price-field">
                <span>最高接受价格</span>
                <input id="oauth-phone-max-price" class="input" type="number" min="0" step="0.0001" value="${oauthPhone.maxPrice || ''}" placeholder="0 表示不限制" />
              </label>
            </div>
            <div id="oauth-phone-offers" class="table-wrap oauth-offer-table-wrap oauth-provider-mode-panel">${renderOAuthPhoneOfferTable(oauthPhone.selectedOffers, oauthPhone.selectedOffers, '点击刷新报价读取平台库存。')}</div>
            <div class="oauth-api-mode-panel">
              <div class="table-head compact">
                <div>
                  <h3>API 接码池</h3>
                  <p class="hint">每行一个号码和接码 API 链接，格式为 号码----API 链接。</p>
                </div>
                <div class="table-actions">
                  <button id="btn-import-oauth-phone-api" class="button secondary small" type="button">导入 API 接码</button>
                  <button id="btn-refresh-oauth-phone-api" class="button secondary small" type="button">刷新预览</button>
                  <button id="btn-clear-oauth-phone-api" class="button danger small" type="button">清空</button>
                </div>
              </div>
              <textarea id="oauth-phone-raw-api-targets" class="raw-store oauth-api-raw-store" spellcheck="false">${escapeHtml(oauthPhone.rawApiTargets)}</textarea>
              <div id="oauth-phone-api-targets" class="table-wrap oauth-api-table-wrap">${renderOAuthPhoneApiTargetTable(oauthPhone.rawApiTargets, oauthPhone.apiTargets)}</div>
            </div>
            <div id="oauth-phone-status" class="status">OAuth 手机接码配置独立保存。</div>
          </div>

          <div id="status" class="status">等待保存。</div>
          </div>
        </details>

        <details class="settings-panel">
          <summary class="settings-panel-summary">
            <span>
              <strong>生成文件</strong>
              <em>${generatedFiles.records.length ? `${generatedFiles.records.length} 个账号已保存` : '暂无生成内容'}</em>
            </span>
            <b>展开</b>
          </summary>
          <div class="settings-panel-body">
          <div class="card-head">
            <div>
              <h2>生成文件</h2>
              <p class="hint">第 19 步会把 sub2api / CPA 保存到这里，多个账号会累积到同一份汇总内容。</p>
            </div>
            <button id="btn-clear-generated" class="button secondary small" type="button"${generatedFiles.records.length ? '' : ' disabled'}>清空文件</button>
          </div>
          <div class="file-meta">
            ${
              latestGenerated
                ? `已保存 ${generatedFiles.records.length} 个账号；最近：${escapeHtml(latestGenerated.email)}，${formatTime(latestGenerated.createdAt)}`
                : '还没有生成文件。运行第 19 步后会自动保存到这里。'
            }
          </div>
          <label class="field">
            <span>sub2api 汇总 JSON</span>
            <textarea id="generated-sub2api" class="textarea output-textarea" spellcheck="false" readonly placeholder="暂无 sub2api 内容">${escapeHtml(generatedFiles.sub2apiJson)}</textarea>
          </label>
          <div class="button-row left">
            <button id="btn-copy-sub2api" class="button secondary small" type="button"${hasSub2api ? '' : ' disabled'}>复制 sub2api</button>
            <button id="btn-download-sub2api" class="button secondary small" type="button"${hasSub2api ? '' : ' disabled'}>下载 sub2api</button>
          </div>
          <label class="field">
            <span>CPA 汇总 JSON（每个账号一条）</span>
            <textarea id="generated-cpa" class="textarea output-textarea" spellcheck="false" readonly placeholder="暂无 CPA 内容">${escapeHtml(generatedFiles.cpaJson)}</textarea>
          </label>
          <div class="button-row left">
            <button id="btn-copy-cpa" class="button secondary small" type="button"${hasCpa ? '' : ' disabled'}>复制 CPA</button>
            <button id="btn-download-cpa" class="button secondary small" type="button"${hasCpa ? '' : ' disabled'}>下载 CPA</button>
          </div>
          <div id="output-status" class="status">生成后的内容保存在浏览器本地存储。</div>
          </div>
        </details>
      </div>
    </section>
  `;

  const status = mustGet('status');
  const rawEmailsInput = mustGet('raw-emails') as HTMLTextAreaElement;
  const rawSmsInput = mustGet('raw-sms') as HTMLTextAreaElement;
  const specifiedEmailSelect = mustGet('specified-email') as HTMLSelectElement;
  const checkoutExtractModeSelect = mustGet('checkout-extract-mode') as HTMLSelectElement;

  renderEmailTable();
  renderSmsTable();
  syncSpecifiedEmails(state.settings.specifiedEmailId);
  syncCheckoutOptionsVisibility();
  setupStatusTooltips();

  const clearEmailsButton = mustGet('btn-clear-emails') as HTMLButtonElement;
  clearEmailsButton.addEventListener('click', () => {
    updateRawEmails('');
    setInlineStatus(status, '邮箱池已清空，点击保存后生效。', 'ok');
    flashButtonLabel(clearEmailsButton, '已清空');
  });
  const restoreEmailsButton = mustGet('btn-restore-emails') as HTMLButtonElement;
  restoreEmailsButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(restoreEmailsButton, '恢复中...');
    try {
      const latest = await loadAutomationState();
      const restorable = latest.emails.filter(isEmailRestorable);
      if (!restorable.length) {
        setInlineStatus(status, '邮箱池没有需要恢复的状态。', 'ok');
        flashButtonLabel(restoreEmailsButton, '无需恢复');
        return;
      }
      const next = await updateAutomationEmails(latest.emails.map((email) => isEmailRestorable(email) ? restoreEmailAccount(email) : email));
      Object.assign(state, next);
      renderEmailTable();
      syncSpecifiedEmails(specifiedEmailSelect.value);
      setInlineStatus(status, `已恢复 ${restorable.length} 个邮箱，可继续使用。`, 'ok');
      flashButtonLabel(restoreEmailsButton, '已恢复');
    } catch (error) {
      setInlineStatus(status, `恢复邮箱失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      restoreButton();
    }
  });
  const refreshEmailsButton = mustGet('btn-refresh-emails') as HTMLButtonElement;
  refreshEmailsButton.addEventListener('click', () => {
    renderEmailTable();
    syncSpecifiedEmails(specifiedEmailSelect.value);
    setInlineStatus(status, '邮箱池预览已刷新。', 'ok');
    flashButtonLabel(refreshEmailsButton, '已刷新');
  });
  const importEmailsButton = mustGet('btn-import-emails') as HTMLButtonElement;
  importEmailsButton.addEventListener('click', () => {
    openPasteImportDialog({
      title: '导入邮箱池',
      description: '每行一个 Outlook 账号，导入后会与当前邮箱池合并并自动去重。',
      placeholder: 'email@outlook.com----password----clientId----refreshToken',
      confirmText: '导入邮箱',
      onConfirm: (text) => {
        updateRawEmails(mergeLines(rawEmailsInput.value, text));
        setInlineStatus(status, `已导入邮箱 ${countRawLines(text)} 行，点击保存后生效。`, 'ok');
      },
    });
    flashButtonLabel(importEmailsButton, '已打开');
  });
  const clearSmsButton = mustGet('btn-clear-sms') as HTMLButtonElement;
  clearSmsButton.addEventListener('click', () => {
    updateRawSms('');
    setInlineStatus(status, '接码池已清空，点击保存后生效。', 'ok');
    flashButtonLabel(clearSmsButton, '已清空');
  });
  const refreshSmsButton = mustGet('btn-refresh-sms') as HTMLButtonElement;
  refreshSmsButton.addEventListener('click', () => {
    renderSmsTable();
    setInlineStatus(status, '接码池预览已刷新。', 'ok');
    flashButtonLabel(refreshSmsButton, '已刷新');
  });
  const importSmsButton = mustGet('btn-import-sms') as HTMLButtonElement;
  importSmsButton.addEventListener('click', () => {
    openPasteImportDialog({
      title: '导入接码池',
      description: '每行一个接码配置，格式为 号码----API 链接，导入后会合并去重。',
      placeholder: '+14642649811----https://mail-api.example.com/api/text-relay/xxxx',
      confirmText: '导入接码',
      onConfirm: (text) => {
        updateRawSms(mergeLines(rawSmsInput.value, text));
        setInlineStatus(status, `已导入接码 ${countRawLines(text)} 行，点击保存后生效。`, 'ok');
      },
    });
    flashButtonLabel(importSmsButton, '已打开');
  });
  checkoutExtractModeSelect.addEventListener('change', syncCheckoutOptionsVisibility);
  wireGeneratedFileActions();
  wireOAuthPhoneActions(oauthPhone);
  mustGet('btn-close').addEventListener('click', () => window.close());
  const copyDiagnosticsButton = mustGet('btn-copy-diagnostics') as HTMLButtonElement;
  copyDiagnosticsButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(copyDiagnosticsButton, '复制中...');
    let copied = false;
    try {
      const latest = await loadAutomationState();
      await navigator.clipboard.writeText(await buildAutomationDiagnosticReport(latest));
      setInlineStatus(status, '诊断报告已复制。', 'ok');
      copied = true;
    } catch (error) {
      setInlineStatus(status, `复制诊断报告失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      restoreButton();
      if (copied) {
        flashButtonLabel(copyDiagnosticsButton, '已复制');
      }
    }
  });
  const saveButton = mustGet('btn-save') as HTMLButtonElement;
  saveButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(saveButton, '保存中...');
    try {
      const next = await saveCurrentSettings();
      setInlineStatus(status, `已保存：${next.emails.length} 个邮箱，${next.smsTargets.length} 个接码。`, 'ok');
      window.setTimeout(() => void render(), 300);
    } catch (error) {
      setInlineStatus(status, error instanceof Error ? error.message : String(error), 'error');
    } finally {
      restoreButton();
    }
  });

  function collectSettingsPatch(overrides: Partial<AutomationSettings> = {}): Partial<AutomationSettings> {
    const rawEmails = valueOf('raw-emails');
    const rawSms = valueOf('raw-sms');
    const emailSelectionMode = valueOf('email-mode') === 'specified' ? 'specified' : 'next';
    const smsSelectionMode = valueOf('sms-mode') === 'next' ? 'next' : 'random';
    const batchAccountLimit = Number(valueOf('batch-account-limit') || 1);
    const specifiedEmailId = valueOf('specified-email');
    const stopOnError = checkedOf('stop-on-error');
    const autoOpenCheckout = checkedOf('auto-open-checkout');
    const debugMode = checkedOf('debug-mode');
    const oauthExtractMode = valueOf('oauth-extract-mode') === 'direct' ? 'direct' : 'email';
    const checkoutExtractMode = valueOf('checkout-extract-mode') as CheckoutExtractMode;

    return {
      rawEmails,
      rawSms,
      emailSelectionMode,
      specifiedEmailId,
      smsSelectionMode,
      batchAccountLimit,
      stopOnError,
      autoOpenCheckout,
      debugMode,
      oauthExtractMode,
      checkoutExtractMode,
      checkoutOptions: {
        planName: valueOf('checkout-plan') as 'chatgptplusplan' | 'chatgptteamplan',
        uiMode: valueOf('checkout-ui-mode') as 'hosted' | 'custom',
        region: valueOf('checkout-region') as 'US' | 'ID' | 'DE' | 'JP',
      },
      ...overrides,
    };
  }

  async function saveCurrentSettings(overrides: Partial<AutomationSettings> = {}) {
    const patch = collectSettingsPatch(overrides);
    const preview = parseAutomationSettings({
      ...state.settings,
      ...patch,
      checkoutOptions: {
        ...state.settings.checkoutOptions,
        ...(patch.checkoutOptions || {}),
      },
    }, state);
    if (preview.emailErrors.length || preview.smsErrors.length) {
      throw new Error([...preview.emailErrors, ...preview.smsErrors].join('；'));
    }
    const selectedStillExists = preview.emails.some((email) => email.id === patch.specifiedEmailId);
    const nextSpecifiedEmailId = patch.emailSelectionMode === 'specified' && selectedStillExists ? patch.specifiedEmailId || '' : '';
    return saveAutomationSettings({
      ...patch,
      specifiedEmailId: nextSpecifiedEmailId,
    });
  }

  async function saveCurrentOAuthPhoneSettings(overrides: Partial<OAuthPhoneSettings> = {}): Promise<OAuthPhoneSettings> {
    return saveOAuthPhoneSettings({
      enabled: checkedOf('oauth-phone-enabled'),
      sourceMode: valueOf('oauth-phone-source-mode') as OAuthPhoneSettings['sourceMode'],
      activeProviderId: valueOf('oauth-phone-active-provider') as OAuthPhoneProviderId,
      providerMode: valueOf('oauth-phone-provider-mode') as OAuthPhoneProviderSelectionMode,
      serviceCode: valueOf('oauth-phone-service-code'),
      countryIds: readSelectedOAuthPhoneOffers().map((offer) => offer.countryId),
      selectedCountries: [],
      selectedOffers: readSelectedOAuthPhoneOffers(),
      minPrice: Number(valueOf('oauth-phone-min-price') || 0),
      maxPrice: Number(valueOf('oauth-phone-max-price') || 0),
      smsTimeoutSeconds: Number(valueOf('oauth-phone-timeout') || 120),
      rawApiTargets: valueOf('oauth-phone-raw-api-targets'),
      apiTargets: parseOAuthPhoneApiTargets(
        valueOf('oauth-phone-raw-api-targets'),
        overrides.apiTargets || oauthPhone.apiTargets,
      ).targets,
      providers: OAUTH_PHONE_PROVIDER_DEFINITIONS.map((definition) => ({
        id: definition.id,
        enabled: checkedOf(`oauth-phone-provider-enabled-${definition.id}`),
        apiKey: valueOf(`oauth-phone-provider-key-${definition.id}`),
        priority: Number(valueOf(`oauth-phone-provider-priority-${definition.id}`) || 99),
        updatedAt: Date.now(),
      })),
      ...overrides,
    });
  }

  function wireOAuthPhoneActions(initialSettings: OAuthPhoneSettings): void {
    const status = mustGet('oauth-phone-status');
    const offersHost = mustGet('oauth-phone-offers');
    const summary = mustGet('oauth-phone-selected-summary');
    const saveButton = mustGet('btn-save-oauth-phone') as HTMLButtonElement;
    const refreshOffersButton = mustGet('btn-refresh-oauth-phone-offers') as HTMLButtonElement;
    const sourceModeSelect = mustGet('oauth-phone-source-mode') as HTMLSelectElement;
    const rawApiTargetsInput = mustGet('oauth-phone-raw-api-targets') as HTMLTextAreaElement;
    const apiTargetsHost = mustGet('oauth-phone-api-targets');
    const importApiButton = mustGet('btn-import-oauth-phone-api') as HTMLButtonElement;
    const refreshApiButton = mustGet('btn-refresh-oauth-phone-api') as HTMLButtonElement;
    const clearApiButton = mustGet('btn-clear-oauth-phone-api') as HTMLButtonElement;
    const offerSearchInput = mustGet('oauth-offer-search') as HTMLInputElement;
    const offerChannelFilterSelect = mustGet('oauth-offer-channel-filter') as HTMLSelectElement;
    const offerUseFilterSelect = mustGet('oauth-offer-use-filter') as HTMLSelectElement;
    const offerSortSelect = mustGet('oauth-offer-sort') as HTMLSelectElement;
    const minPriceInput = mustGet('oauth-phone-min-price') as HTMLInputElement;
    const maxPriceInput = mustGet('oauth-phone-max-price') as HTMLInputElement;
    const timeoutInput = mustGet('oauth-phone-timeout') as HTMLInputElement;
    let selectedOffers = initialSettings.selectedOffers;
    let currentOffers: OAuthPhoneSelectedOffer[] = initialSettings.selectedOffers;
    let currentApiTargets = initialSettings.apiTargets;

    const syncMode = (): void => {
      const isApiMode = sourceModeSelect.value === 'api';
      document.querySelectorAll<HTMLElement>('.oauth-provider-mode-panel').forEach((element) => {
        element.hidden = isApiMode;
      });
      document.querySelectorAll<HTMLElement>('.oauth-api-mode-panel').forEach((element) => {
        element.hidden = !isApiMode;
      });
    };

    const syncOffers = (message = ''): void => {
      summary.textContent = selectedOffers.length ? `${selectedOffers.length} 个报价` : '未选择报价';
      offersHost.innerHTML = renderOAuthPhoneOfferTable(
        currentOffers,
        selectedOffers,
        message,
        readOAuthOfferTableFilter(),
      );
    };
    const syncApiTargets = (): void => {
      const parsed = parseOAuthPhoneApiTargets(rawApiTargetsInput.value, currentApiTargets);
      currentApiTargets = parsed.targets;
      apiTargetsHost.innerHTML = renderOAuthPhoneApiTargetTable(rawApiTargetsInput.value, currentApiTargets);
      const error = parsed.errors.join('；');
      if (error) {
        setInlineStatus(status, error, 'error');
      }
    };
    syncMode();
    syncOffers(initialSettings.selectedOffers.length ? '已加载上次保存的报价选择。' : '点击刷新报价读取平台库存。');
    syncApiTargets();

    const syncFilteredOffers = (): void => syncOffers();
    sourceModeSelect.addEventListener('change', syncMode);
    offerSearchInput.addEventListener('input', syncFilteredOffers);
    offerChannelFilterSelect.addEventListener('change', syncFilteredOffers);
    offerUseFilterSelect.addEventListener('change', syncFilteredOffers);
    offerSortSelect.addEventListener('change', syncFilteredOffers);
    minPriceInput.addEventListener('input', syncFilteredOffers);
    maxPriceInput.addEventListener('input', syncFilteredOffers);
    timeoutInput.addEventListener('change', () => {
      const seconds = Number(timeoutInput.value || 120);
      timeoutInput.value = String(Number.isFinite(seconds) ? Math.max(15, Math.min(600, Math.round(seconds))) : 120);
    });
    rawApiTargetsInput.addEventListener('input', syncApiTargets);

    offersHost.addEventListener('change', (event) => {
      const input = (event.target as Element | null)?.closest<HTMLInputElement>('[data-oauth-offer-key]');
      if (!input) {
        return;
      }
      const offer = currentOffers.find((item) => oauthOfferKey(item) === input.dataset.oauthOfferKey);
      if (!offer) {
        return;
      }
      selectedOffers = input.checked
        ? upsertSelectedOffer(selectedOffers, offer)
        : selectedOffers.filter((item) => oauthOfferKey(item) !== oauthOfferKey(offer));
      syncOffers();
    });

    apiTargetsHost.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-oauth-api-action]');
      if (!button) {
        return;
      }
      const targetId = button.dataset.oauthApiTargetId || '';
      const target = currentApiTargets.find((item) => item.id === targetId);
      if (!target) {
        return;
      }
      if (button.dataset.oauthApiAction === 'delete') {
        rawApiTargetsInput.value = removeRawLine(rawApiTargetsInput.value, target.rawInput);
        syncApiTargets();
        setInlineStatus(status, `已删除 OAuth API 接码：${target.phone}，点击保存后生效。`, 'ok');
        flashButtonLabel(button, '已删除');
        return;
      }
      if (button.dataset.oauthApiAction === 'restore') {
        currentApiTargets = currentApiTargets.map((item) => item.id === targetId
          ? {
              ...item,
              disabled: false,
              disabledAt: 0,
              disabledReason: '',
              lastMessage: '已恢复可用',
            }
          : item);
        apiTargetsHost.innerHTML = renderOAuthPhoneApiTargetTable(rawApiTargetsInput.value, currentApiTargets);
        setInlineStatus(status, `已恢复 OAuth API 接码：${target.phone}，点击保存后生效。`, 'ok');
        flashButtonLabel(button, '已恢复');
      }
    });

    importApiButton.addEventListener('click', () => {
      openPasteImportDialog({
        title: '导入 OAuth API 接码池',
        description: '每行一个 OAuth 手机接码配置，格式为 号码----API 链接，导入后会合并去重。',
        placeholder: '+14642649811----https://mail-api.example.com/api/text-relay/xxxx',
        confirmText: '导入 API 接码',
        onConfirm: (text) => {
          rawApiTargetsInput.value = mergeLines(rawApiTargetsInput.value, text);
          syncApiTargets();
          setInlineStatus(status, `已导入 OAuth API 接码 ${countRawLines(text)} 行，点击保存后生效。`, 'ok');
        },
      });
      flashButtonLabel(importApiButton, '已打开');
    });
    refreshApiButton.addEventListener('click', () => {
      syncApiTargets();
      setInlineStatus(status, 'OAuth API 接码池预览已刷新。', 'ok');
      flashButtonLabel(refreshApiButton, '已刷新');
    });
    clearApiButton.addEventListener('click', () => {
      rawApiTargetsInput.value = '';
      currentApiTargets = [];
      syncApiTargets();
      setInlineStatus(status, 'OAuth API 接码池已清空，点击保存后生效。', 'ok');
      flashButtonLabel(clearApiButton, '已清空');
    });

    refreshOffersButton.addEventListener('click', async () => {
      const restoreButton = setButtonPending(refreshOffersButton, '查询中...');
      offersHost.innerHTML = '<div class="table-empty">正在查询各平台可用报价...</div>';
      try {
        await saveCurrentOAuthPhoneSettings({ selectedOffers, countryIds: selectedOffers.map((offer) => offer.countryId) });
        const result = await fetchOAuthPhoneOfferMatrix();
        currentOffers = mergeSavedOffersIntoMatrix(result.offers.map(toSelectedOAuthPhoneOffer), selectedOffers);
        syncOffers(result.message);
        setInlineStatus(status, result.message, result.ok ? 'ok' : 'error');
      } finally {
        restoreButton();
      }
    });

    saveButton.addEventListener('click', async () => {
      const restoreButton = setButtonPending(saveButton, '保存中...');
      try {
        selectedOffers = readSelectedOAuthPhoneOffers();
        const next = await saveCurrentOAuthPhoneSettings({
          selectedOffers,
          countryIds: selectedOffers.map((offer) => offer.countryId),
          apiTargets: currentApiTargets,
        });
        setInlineStatus(status, `已保存 OAuth 手机接码：平台报价 ${next.selectedOffers.length} 个，API 号码 ${next.apiTargets.length} 个`, 'ok');
      } catch (error) {
        setInlineStatus(status, error instanceof Error ? error.message : String(error), 'error');
      } finally {
        restoreButton();
      }
    });

    for (const definition of OAUTH_PHONE_PROVIDER_DEFINITIONS) {
      const testButton = mustGet(`btn-test-oauth-phone-${definition.id}`) as HTMLButtonElement;
      testButton.addEventListener('click', async () => {
        const restoreButton = setButtonPending(testButton, '测试中...');
        setProviderStatus(definition.id, 'running', '测试中');
        try {
          await saveCurrentOAuthPhoneSettings();
          const result = await testOAuthPhoneProvider(definition.id);
          setProviderStatus(definition.id, result.ok ? 'success' : 'error', result.message);
          setInlineStatus(status, result.message, result.ok ? 'ok' : 'error');
        } finally {
          restoreButton();
        }
      });
    }
  }

  function updateRawEmails(value: string): void {
    rawEmailsInput.value = normalizeRawLines(value);
    renderEmailTable();
    syncSpecifiedEmails(specifiedEmailSelect.value);
  }

  function updateRawSms(value: string): void {
    rawSmsInput.value = normalizeRawLines(value);
    renderSmsTable();
  }

  function renderEmailTable(): void {
    const tableHost = mustGet('email-table');
    const summaryHost = mustGet('email-summary');
    tableHost.textContent = '';
    summaryHost.textContent = '';
    const preview = parseAutomationSettings({
      ...state.settings,
      rawEmails: rawEmailsInput.value,
      rawSms: valueOf('raw-sms'),
    }, state);
    if (preview.emailErrors.length) {
      const errors = document.createElement('div');
      errors.className = 'table-error';
      errors.textContent = preview.emailErrors.join('；');
      tableHost.append(errors);
    }
    if (!preview.emails.length) {
      const empty = document.createElement('div');
      empty.className = 'table-empty';
      empty.textContent = '邮箱池为空，点击导入添加 Outlook 行。';
      tableHost.append(empty);
      return;
    }

    const generatedEmails = new Set(state.generatedFiles.records.map((record) => record.email.toLowerCase()));
    const currentError = state.steps.find((step) => step.status === 'error');
    const rows = preview.emails.map((email) => ({
      email,
      statusInfo: emailStatusInfo(email, generatedEmails, state.run.selectedEmailId, currentError?.message || ''),
    }));
    const successCount = rows.filter((row) => row.statusInfo.kind === 'success').length;
    const errorCount = rows.filter((row) => row.statusInfo.kind === 'error').length;
    summaryHost.textContent = `总数 ${preview.emails.length} · 成功 ${successCount} · 失败 ${errorCount}`;

    const table = document.createElement('table');
    table.className = 'data-table email-pool-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th class="index-cell">序号</th>
          <th>邮箱</th>
          <th>凭证 / Token</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
    `;
    const body = document.createElement('tbody');
    rows.forEach(({ email, statusInfo }, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="index-cell">${index + 1}</td>
        <td><span class="email-text">${escapeHtml(email.email)}</span></td>
        <td><span class="credential-text">${escapeHtml(maskCredentialLine(email.rawInput))}</span></td>
        <td>
          <span
            class="status-pill"
            data-status="${escapeAttr(statusInfo.kind)}"
            data-tooltip="${escapeAttr(statusInfo.detail)}"
            title="${escapeAttr(statusInfo.detail)}"
            aria-label="${escapeAttr(statusInfo.detail)}"
          >${escapeHtml(statusInfo.label)}</span>
        </td>
        <td>
          <div class="table-action-group">
            ${isEmailRestorable(email) ? '<button class="table-action-button" data-action="restore" type="button">恢复</button>' : ''}
            <button class="table-action-button" data-action="run" type="button"${state.run.running ? ' disabled' : ''}>执行</button>
            <button class="table-action-button danger" data-action="delete" type="button">删除</button>
          </div>
        </td>
      `;
      row.querySelector<HTMLButtonElement>('[data-action="restore"]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const restoreButton = setButtonPending(button, '恢复中...');
        try {
          const latest = await loadAutomationState();
          if (!latest.emails.some((item) => item.id === email.id)) {
            setInlineStatus(status, `未找到邮箱：${email.email}，请先保存当前邮箱池。`, 'error');
            return;
          }
          const next = await updateAutomationEmails(latest.emails.map((item) => item.id === email.id ? restoreEmailAccount(item) : item));
          Object.assign(state, next);
          renderEmailTable();
          syncSpecifiedEmails(specifiedEmailSelect.value);
          setInlineStatus(status, `已恢复邮箱：${email.email}`, 'ok');
        } catch (error) {
          setInlineStatus(status, `恢复邮箱失败：${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
          restoreButton();
        }
      });
      const runButton = row.querySelector<HTMLButtonElement>('[data-action="run"]');
      runButton?.addEventListener('click', async () => {
        const restoreButton = setButtonPending(runButton, '执行中...');
        setInlineStatus(status, `正在执行账号：${email.email}`, 'ok');
        try {
          await saveCurrentSettings({
            emailSelectionMode: 'specified',
            specifiedEmailId: email.id,
            batchAccountLimit: 1,
          });
          const result = await runAutomationForEmail(email.id);
          setInlineStatus(status, result.message, result.ok ? 'ok' : 'error');
          window.setTimeout(() => void render(), 300);
        } catch (error) {
          setInlineStatus(status, error instanceof Error ? error.message : String(error), 'error');
        } finally {
          restoreButton();
        }
      });
      row.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', (event) => {
        const deleteButton = event.currentTarget as HTMLButtonElement;
        updateRawEmails(removeRawLine(rawEmailsInput.value, email.rawInput));
        setInlineStatus(status, `已删除：${email.email}，点击保存后生效。`, 'ok');
        flashButtonLabel(deleteButton, '已删除');
      });
      body.append(row);
    });
    table.append(body);
    tableHost.append(table);
  }

  function renderSmsTable(): void {
    const tableHost = mustGet('sms-table');
    tableHost.textContent = '';
    const preview = parseAutomationSettings({
      ...state.settings,
      rawEmails: rawEmailsInput.value,
      rawSms: rawSmsInput.value,
    }, state);
    if (preview.smsErrors.length) {
      const errors = document.createElement('div');
      errors.className = 'table-error';
      errors.textContent = preview.smsErrors.join('；');
      tableHost.append(errors);
    }
    if (!preview.smsTargets.length) {
      const empty = document.createElement('div');
      empty.className = 'table-empty';
      empty.textContent = '接码池为空，点击导入添加 号码----API 链接。';
      tableHost.append(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'data-table sms-pool-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>号码</th>
          <th>API 链接</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
    `;
    const body = document.createElement('tbody');
    for (const target of preview.smsTargets) {
      const statusInfo = smsStatusInfo(target, state.run.selectedSmsId);
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="email-text">${escapeHtml(target.phone)}</span></td>
        <td><span class="credential-text api-text">${escapeHtml(shortUrlText(target.url))}</span></td>
        <td><span class="status-pill" data-status="${escapeAttr(statusInfo.kind)}">${escapeHtml(statusInfo.label)}</span></td>
        <td>
          <div class="table-action-group">
            ${target.disabled ? '<button class="table-action-button" data-action="restore" type="button">恢复</button>' : ''}
            <button class="table-action-button danger" data-action="delete" type="button">删除</button>
          </div>
        </td>
      `;
      row.querySelector<HTMLButtonElement>('[data-action="restore"]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const restoreButton = setButtonPending(button, '恢复中...');
        try {
          const latest = await loadAutomationState();
          if (!latest.smsTargets.some((item) => item.id === target.id)) {
            setInlineStatus(status, `未找到接码：${target.phone}，请先保存当前接码池。`, 'error');
            return;
          }
          const next = await updateAutomationSmsTargets(latest.smsTargets.map((item) => item.id === target.id
            ? {
                ...item,
                disabled: false,
                disabledAt: 0,
                disabledReason: '',
                lastMessage: '已恢复可用',
              }
            : item));
          Object.assign(state, next);
          renderSmsTable();
          setInlineStatus(status, `已恢复接码：${target.phone}`, 'ok');
        } catch (error) {
          setInlineStatus(status, `恢复接码失败：${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
          restoreButton();
        }
      });
      row.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        updateRawSms(removeRawLine(rawSmsInput.value, target.rawInput));
        setInlineStatus(status, `已删除接码：${target.phone}，点击保存后生效。`, 'ok');
        flashButtonLabel(button, '已删除');
      });
      body.append(row);
    }
    table.append(body);
    tableHost.append(table);
  }

  function syncSpecifiedEmails(currentId: string): void {
    const preview = parseAutomationSettings({
      ...state.settings,
      rawEmails: rawEmailsInput.value,
      rawSms: valueOf('raw-sms'),
      specifiedEmailId: currentId,
    }, state);
    specifiedEmailSelect.textContent = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = preview.emails.length ? '未指定' : '先输入邮箱并保存';
    specifiedEmailSelect.append(emptyOption);
    for (const email of preview.emails) {
      const item = document.createElement('option');
      item.value = email.id;
      item.textContent = email.email;
      item.selected = email.id === currentId;
      specifiedEmailSelect.append(item);
    }
  }

  function syncCheckoutOptionsVisibility(): void {
    const optionsRow = mustGet('checkout-options-row');
    optionsRow.hidden = checkoutExtractModeSelect.value === 'server';
  }

  function wireGeneratedFileActions(): void {
    const outputStatus = mustGet('output-status');
    const copySub2apiButton = mustGet('btn-copy-sub2api') as HTMLButtonElement;
    copySub2apiButton.addEventListener('click', async () => {
      await copyText(generatedFiles.sub2apiJson, outputStatus, '已复制 sub2api JSON');
      flashButtonLabel(copySub2apiButton, '已复制');
    });
    const downloadSub2apiButton = mustGet('btn-download-sub2api') as HTMLButtonElement;
    downloadSub2apiButton.addEventListener('click', () => {
      downloadJson(generatedFiles.sub2apiJson, 'sub2api_automation.json');
      outputStatus.textContent = '已下载 sub2api JSON';
      outputStatus.dataset.type = 'ok';
      flashButtonLabel(downloadSub2apiButton, '已下载');
    });
    const copyCpaButton = mustGet('btn-copy-cpa') as HTMLButtonElement;
    copyCpaButton.addEventListener('click', async () => {
      await copyText(generatedFiles.cpaJson, outputStatus, '已复制 CPA JSON');
      flashButtonLabel(copyCpaButton, '已复制');
    });
    const downloadCpaButton = mustGet('btn-download-cpa') as HTMLButtonElement;
    downloadCpaButton.addEventListener('click', () => {
      downloadJson(generatedFiles.cpaJson, 'cpa_automation.json');
      outputStatus.textContent = '已下载 CPA JSON';
      outputStatus.dataset.type = 'ok';
      flashButtonLabel(downloadCpaButton, '已下载');
    });
    const clearGeneratedButton = mustGet('btn-clear-generated') as HTMLButtonElement;
    clearGeneratedButton.addEventListener('click', async () => {
      const restoreButton = setButtonPending(clearGeneratedButton, '清空中...');
      try {
        await clearAutomationGeneratedFiles();
        await render();
      } finally {
        restoreButton();
      }
    });
  }
}

function option(value: string, label: string, current: string): string {
  return `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function oauthPhoneProviderOptions(current: string): string {
  return OAUTH_PHONE_PROVIDER_DEFINITIONS.map((provider) => option(provider.id, provider.label, current)).join('');
}

function providerLabel(providerId: string): string {
  return OAUTH_PHONE_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId)?.label || providerId;
}

function providerBadgeClass(providerId: string): string {
  if (providerId === 'herosms') {
    return 'provider-badge-herosms';
  }
  if (providerId === 'smspool') {
    return 'provider-badge-smspool';
  }
  if (providerId === 'tigersms') {
    return 'provider-badge-tigersms';
  }
  return 'provider-badge-smsbower';
}

function readSelectedOAuthPhoneOffers(): OAuthPhoneSelectedOffer[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('[data-oauth-offer-key]:checked'))
    .map((input) => parseOAuthOfferDataset(input.dataset))
    .filter((offer): offer is OAuthPhoneSelectedOffer => Boolean(offer));
}

function parseOAuthOfferDataset(dataset: DOMStringMap): OAuthPhoneSelectedOffer | null {
  const providerId = dataset.providerId === 'herosms' || dataset.providerId === 'smspool' || dataset.providerId === 'tigersms'
    ? dataset.providerId
    : 'smsbower';
  const countryId = String(dataset.countryId || '').trim();
  const serviceCode = String(dataset.serviceCode || '').trim();
  if (!countryId || !serviceCode) {
    return null;
  }
  return {
    providerId,
    countryId,
    countryName: String(dataset.countryName || countryId),
    serviceCode,
    cost: Number(dataset.cost || 0),
    count: Number(dataset.count || 0),
    operator: String(dataset.operator || ''),
    updatedAt: Number(dataset.updatedAt || Date.now()),
  };
}

function renderOAuthPhoneApiTargetTable(rawInput: string, targets: OAuthPhoneApiTarget[]): string {
  const parsed = parseOAuthPhoneApiTargets(rawInput, targets);
  const displayTargets = targets.length ? targets : parsed.targets;
  const error = parsed.errors.join('；');
  if (!displayTargets.length) {
    return [
      error ? `<div class="table-error">${escapeHtml(error)}</div>` : '',
      '<div class="table-empty">OAuth API 接码池为空，点击导入添加 号码----API 链接。</div>',
    ].join('');
  }
  return `
    ${error ? `<div class="table-error">${escapeHtml(error)}</div>` : ''}
    <table class="data-table oauth-api-table">
      <thead>
        <tr>
          <th>号码</th>
          <th>API 链接</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${displayTargets.map((target) => {
          const statusInfo = oauthApiTargetStatusInfo(target);
          return `
            <tr>
              <td><span class="email-text">${escapeHtml(target.phone)}</span></td>
              <td><span class="credential-text api-text">${escapeHtml(shortUrlText(target.url))}</span></td>
              <td><span class="status-pill" data-status="${escapeAttr(statusInfo.kind)}" data-tooltip="${escapeAttr(statusInfo.detail)}">${escapeHtml(statusInfo.label)}</span></td>
              <td>
                <div class="table-action-group">
                  ${target.disabled ? `<button class="table-action-button" data-oauth-api-action="restore" data-oauth-api-target-id="${escapeAttr(target.id)}" type="button">恢复</button>` : ''}
                  <button class="table-action-button danger" data-oauth-api-action="delete" data-oauth-api-target-id="${escapeAttr(target.id)}" type="button">删除</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function oauthApiTargetStatusInfo(target: OAuthPhoneApiTarget): { kind: string; label: string; detail: string } {
  const detail = [
    `号码：${target.phone}`,
    `API：${redactSensitiveText(target.url)}`,
    target.lastMessage ? `消息：${redactSensitiveText(target.lastMessage)}` : '',
    target.useCount ? `使用次数：${target.useCount}` : '',
    target.lastCodeAt ? `最后收码：${formatTime(target.lastCodeAt)}` : '',
  ].filter(Boolean).join('\n');
  if (target.disabled) {
    return {
      kind: 'error',
      label: target.disabledReason ? `不可用：${shortText(target.disabledReason, 18)}` : '号码不可用',
      detail,
    };
  }
  if (target.lastCodeAt) {
    return { kind: 'success', label: '已收码', detail };
  }
  if (target.lastMessage) {
    return { kind: 'idle', label: shortText(target.lastMessage, 18), detail };
  }
  if (target.useCount > 0) {
    return { kind: 'idle', label: `已用 ${target.useCount} 次`, detail };
  }
  return { kind: 'idle', label: '未使用', detail };
}

interface OAuthOfferTableFilter {
  query: string;
  channelFilter: string;
  useFilter: string;
  sort: string;
  minPrice: number;
  maxPrice: number;
}

interface OAuthOfferCountryGroup {
  key: string;
  providerId: OAuthPhoneProviderId;
  countryId: string;
  countryName: string;
  countryIso: string;
  channelSupport: OpenAiPhoneChannelSupport;
  offers: OAuthPhoneSelectedOffer[];
  minCost: number;
  maxCost: number;
  totalCount: number;
  hasUnknownCount: boolean;
  selectedCount: number;
}

function readOAuthOfferTableFilter(): OAuthOfferTableFilter {
  return {
    query: valueOf('oauth-offer-search').trim().toLowerCase(),
    channelFilter: valueOf('oauth-offer-channel-filter'),
    useFilter: valueOf('oauth-offer-use-filter'),
    sort: valueOf('oauth-offer-sort'),
    minPrice: Number(valueOf('oauth-phone-min-price') || 0),
    maxPrice: Number(valueOf('oauth-phone-max-price') || 0),
  };
}

function renderOAuthPhoneOfferTable(
  offers: OAuthPhoneSelectedOffer[],
  selectedOffers: OAuthPhoneSelectedOffer[],
  message: string,
  filter: OAuthOfferTableFilter = {
    query: '',
    channelFilter: 'all',
    useFilter: 'all',
    sort: 'price-asc',
    minPrice: 0,
    maxPrice: 0,
  },
): string {
  const selectedKeys = new Set(selectedOffers.map(oauthOfferKey));
  const availableOffers = offers.filter(isVisibleOAuthPhoneOffer);
  const visibleOffers = filterOAuthPhoneOffers(offers, selectedKeys, filter);
  const visibleGroups = groupOAuthPhoneOffers(visibleOffers, selectedKeys, filter.sort);
  if (!offers.length) {
    return `<div class="table-empty">${escapeHtml(message)}</div>`;
  }
  if (!visibleOffers.length) {
    const priceMessage = formatOfferFilterPriceMessage(filter);
    return `<div class="table-empty">没有符合筛选条件的报价。${priceMessage ? ` ${escapeHtml(priceMessage)}。` : ''}</div>`;
  }
  const note = [
    `显示 ${visibleGroups.length} 个国家 / ${visibleOffers.length}/${availableOffers.length} 条报价`,
    formatVisibleOfferChannelSummary(visibleGroups),
    filter.channelFilter !== 'all' ? `渠道：${formatOpenAiPhoneChannelFilterLabel(filter.channelFilter)}` : '',
    filter.minPrice > 0 ? `最低价 >= ${formatPrice(filter.minPrice)}` : '',
    filter.maxPrice > 0 ? `最高价 <= ${formatPrice(filter.maxPrice)}` : '',
    filter.query ? `搜索：${filter.query}` : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="oauth-offer-table-note">${escapeHtml(note)}</div>
    <table class="data-table oauth-offer-table">
      <thead>
        <tr>
          <th>国家 / ID</th>
          <th>OpenAI 渠道</th>
          <th>单价 ($)</th>
          <th>余量 (个)</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${visibleGroups.map((group) => renderOAuthPhoneOfferCountryGroup(group, selectedKeys, filter.sort)).join('')}
      </tbody>
    </table>
  `;
}

function renderOAuthPhoneOfferCountryGroup(
  group: OAuthOfferCountryGroup,
  selectedKeys: Set<string>,
  sort: string,
): string {
  const offers = [...group.offers].sort((left, right) => sortOAuthPhoneOffers(left, right, sort));
  const priceRange = group.minCost === group.maxCost
    ? `$${formatPrice(group.minCost)}`
    : `$${formatPrice(group.minCost)} - $${formatPrice(group.maxCost)}`;
  const selectedText = group.selectedCount ? ` · 已选 ${group.selectedCount}` : '';
  return `
    <tr class="oauth-country-row">
      <td colspan="5">
        <div class="offer-country-head">
          <div>
            <strong class="offer-country-title">${escapeHtml(group.countryName || group.countryId)} / ${escapeHtml(group.countryId)}</strong>
            <span class="provider-badge ${providerBadgeClass(group.providerId)}">${escapeHtml(providerLabel(group.providerId))}</span>
            ${renderOpenAiPhoneChannelBadge(group.channelSupport)}
          </div>
          <span class="offer-country-meta">${escapeHtml(group.countryIso || 'ISO?')} · ${offers.length} 个定价选项 · ${escapeHtml(priceRange)} · 余量 ${escapeHtml(formatOfferCount(group))}${escapeHtml(selectedText)}</span>
        </div>
      </td>
    </tr>
    ${offers.map((offer) => renderOAuthPhoneOfferOptionRow(offer, selectedKeys)).join('')}
  `;
}

function renderOAuthPhoneOfferOptionRow(
  offer: OAuthPhoneSelectedOffer,
  selectedKeys: Set<string>,
): string {
  const key = oauthOfferKey(offer);
  const optionLabel = offer.operator ? `定价选项 ${offer.operator}` : '默认定价';
  const support = resolveOpenAiPhoneOfferSupport(offer);
  return `
    <tr class="oauth-price-option-row">
      <td>
        <span class="offer-option-label">${escapeHtml(optionLabel)}</span>
      </td>
      <td>${renderOpenAiPhoneChannelBadge(support)}</td>
      <td>${formatPrice(offer.cost)}</td>
      <td>${escapeHtml(formatOfferCount(offer))}</td>
      <td>
        <label class="mini-check">
          <input
            type="checkbox"
            data-oauth-offer-key="${escapeAttr(key)}"
            data-provider-id="${escapeAttr(offer.providerId)}"
            data-country-id="${escapeAttr(offer.countryId)}"
            data-country-name="${escapeAttr(offer.countryName)}"
            data-service-code="${escapeAttr(offer.serviceCode)}"
            data-cost="${escapeAttr(offer.cost)}"
            data-count="${escapeAttr(offer.count)}"
            data-operator="${escapeAttr(offer.operator)}"
            data-updated-at="${offer.updatedAt || Date.now()}"
            ${selectedKeys.has(key) ? 'checked' : ''}
          />
          <span>使用</span>
        </label>
      </td>
    </tr>
  `;
}

function renderOpenAiPhoneChannelBadge(support: OpenAiPhoneChannelSupport): string {
  const label = formatOpenAiPhoneChannelLabel(support);
  const className = isOpenAiPhoneSmsFirst(support)
    ? 'openai-channel-sms'
    : isOpenAiPhoneWhatsappFirst(support)
      ? 'openai-channel-whatsapp'
      : 'openai-channel-unknown';
  const detail = support.channels.length
    ? `${support.countryIso || '未知 ISO'}：${support.channels.join(' > ')}`
    : `${support.countryIso || '未知 ISO'}：OpenAI 渠道未知`;
  return `<span class="openai-channel-badge ${className}" title="${escapeAttr(detail)}">${escapeHtml(label)}</span>`;
}

function formatVisibleOfferChannelSummary(groups: OAuthOfferCountryGroup[]): string {
  if (!groups.length) {
    return '';
  }
  const smsFirst = groups.filter((group) => isOpenAiPhoneSmsFirst(group.channelSupport)).length;
  const whatsappFirst = groups.filter((group) => isOpenAiPhoneWhatsappFirst(group.channelSupport)).length;
  const unknown = groups.length - smsFirst - whatsappFirst;
  return [
    `SMS 优先 ${smsFirst}`,
    `WhatsApp 优先 ${whatsappFirst}`,
    unknown ? `未知 ${unknown}` : '',
  ].filter(Boolean).join(' / ');
}

function matchesOpenAiPhoneChannelFilter(offer: OAuthPhoneSelectedOffer, channelFilter: string): boolean {
  if (channelFilter === 'sms') {
    return isOpenAiPhoneSmsFirst(resolveOpenAiPhoneOfferSupport(offer));
  }
  if (channelFilter === 'whatsapp') {
    return isOpenAiPhoneWhatsappFirst(resolveOpenAiPhoneOfferSupport(offer));
  }
  return true;
}

function formatOpenAiPhoneChannelFilterLabel(channelFilter: string): string {
  if (channelFilter === 'sms') {
    return 'SMS 优先';
  }
  if (channelFilter === 'whatsapp') {
    return 'WhatsApp 优先';
  }
  return '全部渠道';
}

function groupOAuthPhoneOffers(
  offers: OAuthPhoneSelectedOffer[],
  selectedKeys: Set<string>,
  sort: string,
): OAuthOfferCountryGroup[] {
  const byCountry = new Map<string, OAuthOfferCountryGroup>();
  for (const offer of offers) {
    const key = [offer.providerId, offer.countryId, offer.countryName || ''].join('|');
    const selected = selectedKeys.has(oauthOfferKey(offer)) ? 1 : 0;
    const channelSupport = resolveOpenAiPhoneOfferSupport(offer);
    const existing = byCountry.get(key);
    if (existing) {
      existing.offers.push(offer);
      existing.minCost = Math.min(existing.minCost, offer.cost);
      existing.maxCost = Math.max(existing.maxCost, offer.cost);
      existing.totalCount += normalizedOfferCount(offer.count);
      existing.hasUnknownCount = existing.hasUnknownCount || offer.count < 0;
      existing.selectedCount += selected;
      continue;
    }
    byCountry.set(key, {
      key,
      providerId: offer.providerId,
      countryId: offer.countryId,
      countryName: offer.countryName || offer.countryId,
      countryIso: channelSupport.countryIso,
      channelSupport,
      offers: [offer],
      minCost: offer.cost,
      maxCost: offer.cost,
      totalCount: normalizedOfferCount(offer.count),
      hasUnknownCount: offer.count < 0,
      selectedCount: selected,
    });
  }
  return [...byCountry.values()].sort((left, right) => sortOAuthPhoneOfferGroups(left, right, sort));
}

function filterOAuthPhoneOffers(
  offers: OAuthPhoneSelectedOffer[],
  selectedKeys: Set<string>,
  filter: OAuthOfferTableFilter,
): OAuthPhoneSelectedOffer[] {
  return offers
    .filter(isVisibleOAuthPhoneOffer)
    .filter((offer) => matchesOpenAiPhoneChannelFilter(offer, filter.channelFilter))
    .filter((offer) => filter.minPrice > 0 ? offer.cost >= filter.minPrice : true)
    .filter((offer) => filter.maxPrice > 0 ? offer.cost <= filter.maxPrice : true)
    .filter((offer) => {
      if (!filter.query) {
        return true;
      }
      return [
        offer.countryName,
        offer.countryId,
        providerLabel(offer.providerId),
        resolveOpenAiPhoneOfferCountryIso(offer),
      ].some((value) => String(value || '').toLowerCase().includes(filter.query));
    })
    .filter((offer) => {
      const selected = selectedKeys.has(oauthOfferKey(offer));
      if (filter.useFilter === 'selected') {
        return selected;
      }
      if (filter.useFilter === 'unselected') {
        return !selected;
      }
      return true;
    })
    .sort((left, right) => sortOAuthPhoneOffers(left, right, filter.sort));
}

function formatOfferFilterPriceMessage(filter: OAuthOfferTableFilter): string {
  const parts = [
    filter.minPrice > 0 ? `当前最低价为 ${formatPrice(filter.minPrice)}` : '',
    filter.maxPrice > 0 ? `当前最高价为 ${formatPrice(filter.maxPrice)}` : '',
  ].filter(Boolean);
  return parts.join('，');
}

function sortOAuthPhoneOffers(
  left: OAuthPhoneSelectedOffer,
  right: OAuthPhoneSelectedOffer,
  sort: string,
): number {
  if (sort === 'price-desc') {
    return right.cost - left.cost || compareOfferStock(left, right, 'desc');
  }
  if (sort === 'stock-desc') {
    return compareOfferStock(left, right, 'desc') || left.cost - right.cost;
  }
  if (sort === 'stock-asc') {
    return compareOfferStock(left, right, 'asc') || left.cost - right.cost;
  }
  return left.cost - right.cost || compareOfferStock(left, right, 'desc');
}

function sortOAuthPhoneOfferGroups(
  left: OAuthOfferCountryGroup,
  right: OAuthOfferCountryGroup,
  sort: string,
): number {
  if (sort === 'price-desc') {
    return right.maxCost - left.maxCost || compareGroupStock(left, right, 'desc') || compareCountryGroupName(left, right);
  }
  if (sort === 'stock-desc') {
    return compareGroupStock(left, right, 'desc') || left.minCost - right.minCost || compareCountryGroupName(left, right);
  }
  if (sort === 'stock-asc') {
    return compareGroupStock(left, right, 'asc') || left.minCost - right.minCost || compareCountryGroupName(left, right);
  }
  return left.minCost - right.minCost || compareGroupStock(left, right, 'desc') || compareCountryGroupName(left, right);
}

function compareCountryGroupName(left: OAuthOfferCountryGroup, right: OAuthOfferCountryGroup): number {
  return `${left.countryName} ${left.countryId}`.localeCompare(`${right.countryName} ${right.countryId}`);
}

function compareOfferStock(
  left: Pick<OAuthPhoneSelectedOffer, 'count'>,
  right: Pick<OAuthPhoneSelectedOffer, 'count'>,
  direction: 'asc' | 'desc',
): number {
  if (left.count < 0 && right.count < 0) {
    return 0;
  }
  if (left.count < 0) {
    return 1;
  }
  if (right.count < 0) {
    return -1;
  }
  return direction === 'asc' ? left.count - right.count : right.count - left.count;
}

function compareGroupStock(
  left: OAuthOfferCountryGroup,
  right: OAuthOfferCountryGroup,
  direction: 'asc' | 'desc',
): number {
  const leftUnknownOnly = left.hasUnknownCount && left.totalCount <= 0;
  const rightUnknownOnly = right.hasUnknownCount && right.totalCount <= 0;
  if (leftUnknownOnly && rightUnknownOnly) {
    return 0;
  }
  if (leftUnknownOnly) {
    return 1;
  }
  if (rightUnknownOnly) {
    return -1;
  }
  return direction === 'asc' ? left.totalCount - right.totalCount : right.totalCount - left.totalCount;
}

function isVisibleOAuthPhoneOffer(offer: Pick<OAuthPhoneSelectedOffer, 'cost' | 'count'>): boolean {
  return offer.cost > 0 && offer.count !== 0;
}

function normalizedOfferCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatOfferCount(value: Pick<OAuthPhoneSelectedOffer, 'count'> | OAuthOfferCountryGroup): string {
  if ('hasUnknownCount' in value) {
    if (value.hasUnknownCount && value.totalCount > 0) {
      return `${value.totalCount}+ / 未知`;
    }
    return value.hasUnknownCount ? '未知' : String(value.totalCount);
  }
  return value.count < 0 ? '未知' : String(value.count);
}

function toSelectedOAuthPhoneOffer(
  offer: OAuthPhonePriceOffer & { countryName?: string },
): OAuthPhoneSelectedOffer {
  return {
    providerId: offer.providerId,
    countryId: offer.countryId,
    countryName: offer.countryName || offer.countryId,
    serviceCode: offer.serviceCode,
    cost: offer.cost,
    count: offer.count,
    operator: offer.operator,
    updatedAt: Date.now(),
  };
}

function upsertSelectedOffer(
  current: OAuthPhoneSelectedOffer[],
  offer: OAuthPhoneSelectedOffer,
): OAuthPhoneSelectedOffer[] {
  return [...current.filter((item) => oauthOfferKey(item) !== oauthOfferKey(offer)), offer];
}

function mergeSavedOffersIntoMatrix(
  offers: OAuthPhoneSelectedOffer[],
  selectedOffers: OAuthPhoneSelectedOffer[],
): OAuthPhoneSelectedOffer[] {
  const byKey = new Map(offers.map((offer) => [oauthOfferKey(offer), offer]));
  for (const selected of selectedOffers) {
    if (!byKey.has(oauthOfferKey(selected))) {
      byKey.set(oauthOfferKey(selected), selected);
    }
  }
  return [...byKey.values()];
}

function oauthOfferKey(offer: OAuthPhoneSelectedOffer): string {
  return [
    offer.providerId,
    offer.countryId,
    offer.serviceCode,
    offer.operator,
    formatPrice(offer.cost),
  ].join('|');
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return String(Math.round(value * 10000) / 10000);
}

function setProviderStatus(providerId: string, kind: string, message: string): void {
  const element = mustGet(`oauth-phone-provider-status-${providerId}`);
  element.textContent = message;
  element.dataset.status = kind;
  element.dataset.tooltip = message;
}

function buildOAuthPhoneSummary(settings: OAuthPhoneSettings): string {
  const modeLabel = settings.sourceMode === 'api' ? 'API 接码池' : '接码平台接码';
  const apiDisabled = settings.apiTargets.filter((target) => target.disabled).length;
  const apiUsable = settings.apiTargets.length - apiDisabled;
  if (settings.sourceMode === 'api') {
    return [
      `状态：${settings.enabled ? '已启用' : '未启用'}`,
      `模式：${modeLabel}`,
      `API 号码：总数 ${settings.apiTargets.length} / 可用 ${apiUsable} / 不可用 ${apiDisabled}`,
      `接码超时：${settings.smsTimeoutSeconds || 120} 秒`,
    ].join('\n');
  }
  const enabledProviders = settings.providers.filter((provider) => provider.enabled);
  const keyCount = enabledProviders.filter((provider) => provider.apiKey.trim()).length;
  const offerSummary = settings.selectedOffers.length
    ? settings.selectedOffers.map((offer) => `${offer.countryName}/${offer.countryId} ${formatPrice(offer.cost)}`).join(', ')
    : '未选择报价';
  const service = settings.serviceCode || '未配置服务代码';
  const priceRange = [
    `最低价：${settings.minPrice > 0 ? settings.minPrice : '不限制'}`,
    `最高价：${settings.maxPrice > 0 ? settings.maxPrice : '不限制'}`,
  ].join(' / ');
  return [
    `状态：${settings.enabled ? '已启用' : '未启用'}`,
    `模式：${modeLabel}`,
    `平台：${providerLabel(settings.activeProviderId)} / 已启用 ${enabledProviders.length} 个 / 已填 key ${keyCount} 个`,
    `服务：${service}`,
    `报价：${offerSummary}`,
    priceRange,
    `接码超时：${settings.smsTimeoutSeconds || 120} 秒`,
  ].join('\n');
}

function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`missing element: ${id}`);
  }
  return element;
}

function valueOf(id: string): string {
  const element = mustGet(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  return element.value;
}

function checkedOf(id: string): boolean {
  return Boolean((mustGet(id) as HTMLInputElement).checked);
}

function setInlineStatus(element: HTMLElement, message: string, type: 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

function setupStatusTooltips(): void {
  ensureStatusTooltip();
  if (statusTooltipBound) {
    return;
  }
  statusTooltipBound = true;

  const hide = (): void => {
    const tooltip = ensureStatusTooltip();
    tooltip.hidden = true;
    tooltip.textContent = '';
  };
  const show = (target: HTMLElement): void => {
    const text = target.dataset.tooltip || target.title || '';
    if (!text) {
      hide();
      return;
    }
    const tooltip = ensureStatusTooltip();
    tooltip.textContent = text;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - tooltipRect.width - margin),
    );
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + tooltipRect.height + margin > window.innerHeight
      ? Math.max(margin, rect.top - tooltipRect.height - 8)
      : preferredTop;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  document.addEventListener('mouseover', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('.status-pill[data-tooltip]');
    if (target) {
      show(target);
    }
  });
  document.addEventListener('focusin', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('.status-pill[data-tooltip]');
    if (target) {
      show(target);
    }
  });
  document.addEventListener('mouseout', (event) => {
    if ((event.target as Element | null)?.closest('.status-pill[data-tooltip]')) {
      hide();
    }
  });
  document.addEventListener('focusout', (event) => {
    if ((event.target as Element | null)?.closest('.status-pill[data-tooltip]')) {
      hide();
    }
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

function ensureStatusTooltip(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('.status-tooltip');
  if (existing) {
    return existing;
  }
  const tooltip = document.createElement('div');
  tooltip.className = 'status-tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);
  return tooltip;
}

function openPasteImportDialog(options: PasteImportDialogOptions): void {
  document.querySelector('.import-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'import-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'import-dialog-title');

  const title = document.createElement('h2');
  title.id = 'import-dialog-title';
  title.textContent = options.title;

  const description = document.createElement('p');
  description.className = 'import-description';
  description.textContent = options.description;

  const textarea = document.createElement('textarea');
  textarea.className = 'import-textarea';
  textarea.placeholder = options.placeholder;
  textarea.spellcheck = false;

  const error = document.createElement('div');
  error.className = 'import-error';
  error.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'import-actions';

  const cancel = document.createElement('button');
  cancel.className = 'button secondary';
  cancel.type = 'button';
  cancel.textContent = '取消';

  const confirm = document.createElement('button');
  confirm.className = 'button';
  confirm.type = 'button';
  confirm.textContent = options.confirmText;

  actions.append(cancel, confirm);
  dialog.append(title, description, textarea, error, actions);
  overlay.append(dialog);
  document.body.append(overlay);

  const close = (): void => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const submit = (): void => {
    const text = textarea.value.trim();
    if (!text) {
      error.textContent = '请先粘贴需要导入的内容。';
      error.hidden = false;
      textarea.focus();
      return;
    }
    options.onConfirm(text);
    close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      submit();
    }
  };

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', submit);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  textarea.addEventListener('input', () => {
    error.hidden = true;
  });
  document.addEventListener('keydown', onKeyDown);
  window.setTimeout(() => textarea.focus(), 0);
}

async function copyText(content: string, status: HTMLElement, successMessage: string): Promise<void> {
  if (!content.trim()) {
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    status.textContent = successMessage;
    status.dataset.type = 'ok';
  } catch (error) {
    status.textContent = `复制失败：${error instanceof Error ? error.message : String(error)}`;
    status.dataset.type = 'error';
  }
}

function downloadJson(content: string, filename: string): void {
  if (!content.trim()) {
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

async function buildAutomationDiagnosticReport(state: AutomationState): Promise<string> {
  const manifest = browser.runtime.getManifest();
  const oauthPhone = await loadOAuthPhoneSettings();
  const targetTab = await getDiagnosticTargetTab(state);
  const generatedEmails = new Set(state.generatedFiles.records.map((record) => record.email.toLowerCase()));
  const emailTotal = state.emails.length;
  const emailSuccess = state.emails.filter((email) => !isRestoredEmail(email) && (generatedEmails.has(email.email.toLowerCase()) || email.status === 'used')).length;
  const emailError = state.emails.filter((email) => email.status === 'error').length;
  const smsDisabled = state.smsTargets.filter((target) => target.disabled).length;
  const currentEmail = state.emails.find((email) => email.id === state.run.selectedEmailId) || null;
  const currentSms = state.smsTargets.find((target) => target.id === state.run.selectedSmsId) || null;
  const latestError = state.steps.find((step) => step.status === 'error') || null;
  const lines: string[] = [];

  lines.push('# OPX 自动化诊断报告');
  lines.push(`生成时间：${formatTime(Date.now())}`);
  lines.push(`插件版本：${manifest.version || 'unknown'}`);
  lines.push(`调试模式：${state.settings.debugMode ? '开启' : '关闭'}`);
  lines.push('');
  lines.push('## 当前任务');
  lines.push(`运行状态：${state.run.running ? '运行中' : state.run.paused ? '已暂停' : '未运行'}`);
  lines.push(`当前步骤：${state.run.currentStepId || '无'}`);
  lines.push(`开始时间：${formatTime(state.run.startedAt)}`);
  lines.push(`结束时间：${formatTime(state.run.finishedAt)}`);
  lines.push(`目标标签页：tab=${state.run.targetTabId || '-'} window=${state.run.targetWindowId || '-'}`);
  lines.push(`目标页面：${targetTab ? redactSensitiveText(String(targetTab.url || '')) : '未读取到目标标签页'}`);
  lines.push(`目标状态：${targetTab?.status || '未知'}`);
  lines.push(`当前邮箱：${currentEmail?.email || '未选择'}`);
  lines.push(`当前接码：${currentSms?.phone || '未选择'}`);
  lines.push(`订阅链接：${state.run.checkoutUrl ? redactSensitiveText(state.run.checkoutUrl) : '无'}`);
  lines.push('');
  lines.push('## 设置摘要');
  lines.push(`邮箱选择：${state.settings.emailSelectionMode}${state.settings.specifiedEmailId ? ` / 指定 ${state.settings.specifiedEmailId}` : ''}`);
  lines.push(`接码选择：${state.settings.smsSelectionMode}`);
  lines.push(`执行账号数：${state.settings.batchAccountLimit}`);
  lines.push(`失败停止：${state.settings.stopOnError ? '是' : '否'}`);
  lines.push(`自动打开订阅链接：${state.settings.autoOpenCheckout ? '是' : '否'}`);
  lines.push(`提取模式：${state.settings.checkoutExtractMode || 'local'}`);
  lines.push(`OAuth 方式：${state.settings.oauthExtractMode}`);
  lines.push(`邮箱池：总数 ${emailTotal} / 成功 ${emailSuccess} / 失败 ${emailError}`);
  lines.push(`接码池：总数 ${state.smsTargets.length} / 不可用 ${smsDisabled}`);
  const oauthPhoneMode = oauthPhone.sourceMode === 'api' ? 'API 接码池' : '接码平台接码';
  const oauthPhoneApiDisabled = oauthPhone.apiTargets.filter((target) => target.disabled).length;
  lines.push(`OAuth 手机接码：${oauthPhone.enabled ? '启用' : '关闭'} / 模式 ${oauthPhoneMode} / 超时 ${oauthPhone.smsTimeoutSeconds || 120}s`);
  lines.push(`OAuth 手机接码 API 池：总数 ${oauthPhone.apiTargets.length} / 可用 ${oauthPhone.apiTargets.length - oauthPhoneApiDisabled} / 不可用 ${oauthPhoneApiDisabled}`);
  oauthPhone.apiTargets.slice(0, 80).forEach((target, index) => {
    const disabled = target.disabled ? `不可用：${redactSensitiveText(target.disabledReason || '-')}` : '可用';
    lines.push(`- OAuth API ${index + 1}. ${target.phone}；${disabled}；次数=${target.useCount}；最后收码=${formatTime(target.lastCodeAt)}；API=${redactSensitiveText(target.url)}；消息=${redactSensitiveText(target.lastMessage || '-')}`);
  });
  if (oauthPhone.apiTargets.length > 80) {
    lines.push(`- OAuth API 还有 ${oauthPhone.apiTargets.length - 80} 个号码未展开`);
  }
  lines.push(`OAuth 手机接码平台模式：平台 ${providerLabel(oauthPhone.activeProviderId)} / 策略 ${oauthPhone.providerMode}`);
  const oauthPhoneOffers = oauthPhone.selectedOffers.length
    ? oauthPhone.selectedOffers.map((offer) => `${providerLabel(offer.providerId)} ${offer.countryName}/${offer.countryId} $${formatPrice(offer.cost)} stock=${offer.count}`).join('；')
    : '-';
  lines.push(`OAuth 手机接码条件：服务 ${oauthPhone.serviceCode || '-'} / 报价 ${oauthPhoneOffers} / 最低价 ${oauthPhone.minPrice || '不限制'} / 最高价 ${oauthPhone.maxPrice || '不限制'}`);
  lines.push(`OAuth 手机接码平台：${oauthPhone.providers.map((provider) => `${providerLabel(provider.id)}=${provider.enabled ? '启用' : '关闭'},key=${provider.apiKey ? '[REDACTED]' : '空'},priority=${provider.priority}`).join('；')}`);
  lines.push('');
  lines.push('## 步骤状态');
  for (const step of state.steps) {
    const started = step.startedAt ? formatTime(step.startedAt) : '-';
    const finished = step.finishedAt ? formatTime(step.finishedAt) : '-';
    const elapsed = step.startedAt && step.finishedAt ? `${Math.max(0, step.finishedAt - step.startedAt)}ms` : '-';
    lines.push(`- ${step.id} [${step.status}] ${redactSensitiveText(step.message || '')}；开始=${started}；结束=${finished}；耗时=${elapsed}`);
  }
  lines.push('');
  lines.push('## 邮箱池状态');
  state.emails.slice(0, 120).forEach((email, index) => {
    const success = generatedEmails.has(email.email.toLowerCase()) ? '开通成功' : email.status;
    lines.push(`- ${index + 1}. ${email.email}；状态=${success}；次数=${email.useCount}；最后=${redactSensitiveText(email.lastMessage || '-')}`);
  });
  if (state.emails.length > 120) {
    lines.push(`- 还有 ${state.emails.length - 120} 个邮箱未展开`);
  }
  lines.push('');
  lines.push('## 接码池状态');
  state.smsTargets.forEach((target, index) => {
    const api = redactSensitiveText(target.url);
    const disabled = target.disabled ? `不可用：${redactSensitiveText(target.disabledReason || '-')}` : '可用';
    lines.push(`- ${index + 1}. ${target.phone}；${disabled}；次数=${target.useCount}；最后收码=${formatTime(target.lastCodeAt)}；API=${api}；消息=${redactSensitiveText(target.lastMessage || '-')}`);
  });
  lines.push('');
  lines.push('## 最近错误');
  lines.push(latestError ? `${latestError.id}: ${redactSensitiveText(latestError.message)}` : '无');
  lines.push('');
  lines.push('## 最近日志');
  state.logs.slice(0, 160).reverse().forEach((entry) => {
    lines.push(`${formatTime(entry.time)} [${entry.level}] ${entry.stepId || '-'} ${redactSensitiveText(entry.message)}`);
  });

  return lines.join('\n');
}

async function getDiagnosticTargetTab(state: AutomationState): Promise<{ url?: string; status?: string } | null> {
  if (!state.run.targetTabId) {
    return null;
  }
  try {
    return await browser.tabs.get(state.run.targetTabId);
  } catch {
    return null;
  }
}

function redactSensitiveText(value: string): string {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>，。；)]+/gi, (match) => redactUrl(match))
    .replace(/\b(access[_-]?token|id[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|authorization|bearer)\b([="'\s:]+)([^\s,;，。]+)/gi, '$1$2[REDACTED]')
    .replace(/\b(token|ba_token|setup_intent_client_secret)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]');
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.length > 18 ? `${segment.slice(0, 6)}...${segment.slice(-4)}` : segment)
      .join('/');
    const query = url.search ? '?[REDACTED]' : '';
    const hash = url.hash ? '#[REDACTED]' : '';
    return `${url.origin}${path ? `/${path}` : ''}${query}${hash}`;
  } catch {
    return '[URL_REDACTED]';
  }
}

function formatTime(value: number): string {
  if (!value) {
    return '未知时间';
  }
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
  });
}

function normalizeRawLines(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n');
}

function countRawLines(value: string): number {
  const normalized = normalizeRawLines(value);
  return normalized ? normalized.split('\n').length : 0;
}

function mergeLines(current: string, incoming: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of `${current}\n${incoming}`.split(/\r?\n/)) {
    const item = line.trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    lines.push(item);
  }
  return lines.join('\n');
}

function removeRawLine(rawValue: string, rawInput: string): string {
  const target = rawInput.trim();
  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== target)
    .join('\n');
}

function maskCredentialLine(rawInput: string): string {
  const parts = rawInput.split('----').map((item) => item.trim());
  if (parts.length < 2) {
    return '手动邮箱';
  }
  const labels = ['密码', 'Client', 'Token'];
  return parts.slice(1, 4).map((part, index) => `${labels[index]} ${maskSecret(part)}`).join(' / ');
}

function maskSecret(value: string): string {
  if (!value) {
    return '-';
  }
  if (value.length <= 10) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function emailStatusInfo(
  email: AutomationEmailAccount,
  generatedEmails: Set<string>,
  selectedEmailId: string,
  currentErrorMessage: string,
): { kind: string; label: string; detail: string } {
  if (isRestoredEmail(email)) {
    return { kind: 'idle', label: '已恢复可用', detail: emailStatusDetail(email, '已恢复可用') };
  }
  if (generatedEmails.has(email.email.toLowerCase())) {
    return { kind: 'success', label: '开通成功', detail: emailStatusDetail(email, '开通成功') };
  }
  if (email.status === 'error') {
    const detail = emailStatusDetail(email, email.lastMessage || '失败');
    return { kind: 'error', label: email.lastMessage ? `失败：${shortText(email.lastMessage, 22)}` : '失败', detail };
  }
  if (email.id === selectedEmailId && currentErrorMessage) {
    return {
      kind: 'error',
      label: `失败：${shortText(currentErrorMessage, 22)}`,
      detail: emailStatusDetail(email, currentErrorMessage),
    };
  }
  if (email.status === 'used') {
    return { kind: 'success', label: '流程完成', detail: emailStatusDetail(email, email.lastMessage || '流程完成') };
  }
  if (email.status === 'running') {
    return { kind: 'running', label: '执行中', detail: emailStatusDetail(email, email.lastMessage || '执行中') };
  }
  return { kind: 'idle', label: '未执行', detail: emailStatusDetail(email, email.lastMessage || '未执行') };
}

function emailStatusDetail(email: AutomationEmailAccount, statusText: string): string {
  const parts = [
    `邮箱：${email.email}`,
    `状态：${redactSensitiveText(statusText)}`,
    `使用次数：${email.useCount}`,
  ];
  if (email.lastUsedAt) {
    parts.push(`最后执行：${formatTime(email.lastUsedAt)}`);
  }
  if (email.lastMessage && email.lastMessage !== statusText) {
    parts.push(`消息：${redactSensitiveText(email.lastMessage)}`);
  }
  return parts.join('\n');
}

function isEmailRestorable(email: AutomationEmailAccount): boolean {
  if (isRestoredEmail(email)) {
    return false;
  }
  return email.status !== 'idle' || Boolean(email.lastUsedAt || email.useCount || email.lastMessage);
}

function restoreEmailAccount(email: AutomationEmailAccount): AutomationEmailAccount {
  return {
    ...email,
    status: 'idle',
    useCount: 0,
    lastUsedAt: 0,
    lastMessage: '已恢复可用',
  };
}

function isRestoredEmail(email: AutomationEmailAccount): boolean {
  return email.status === 'idle' && email.lastMessage === '已恢复可用';
}

function smsStatusInfo(target: AutomationSmsTarget, selectedSmsId: string): { kind: string; label: string } {
  if (target.disabled) {
    return { kind: 'error', label: target.disabledReason ? `不可用：${shortText(target.disabledReason, 18)}` : '号码不可用' };
  }
  if (target.id === selectedSmsId) {
    return { kind: 'running', label: '当前使用' };
  }
  if (target.lastCodeAt) {
    return { kind: 'success', label: '已收码' };
  }
  if (target.lastMessage) {
    return { kind: 'idle', label: shortText(target.lastMessage, 18) };
  }
  if (target.useCount > 0) {
    return { kind: 'idle', label: `已用 ${target.useCount} 次` };
  }
  return { kind: 'idle', label: '未使用' };
}

function shortUrlText(value: string): string {
  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}`.replace(/\/$/, '');
    return `${url.hostname}${path ? shortText(path, 42) : ''}`;
  } catch {
    return shortText(value, 56);
  }
}

function shortText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

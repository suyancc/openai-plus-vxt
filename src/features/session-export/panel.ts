import type { FeaturePanelHandle } from '../../app/types';
import type { ConvertedAccount, ExportFormat } from './types';
import { buildFileName, buildOutputDocument, parseAndConvert } from './converter';
import { fetchChatGptSessionDirect } from '../link-extractor/session-direct';

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'cpa', label: 'CPA' },
  { value: 'sub2api', label: 'sub2api' },
  { value: 'cockpit', label: 'Cockpit' },
  { value: '9router', label: '9router' },
];

export function createSessionExportPanel(container: HTMLElement): FeaturePanelHandle {
  let currentFormat: ExportFormat = 'cpa';
  let converted: ConvertedAccount[] = [];
  let outputText = '';

  // ─── Format selector ────────────────────────────────────────────────────────
  const formatRow = document.createElement('div');
  formatRow.className = 'opx-button-row';
  formatRow.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
  formatRow.style.marginBottom = '8px';

  const formatButtons: HTMLButtonElement[] = FORMAT_OPTIONS.map(({ value, label }) => {
    const btn = document.createElement('button');
    btn.className = 'opx-button opx-button-secondary';
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.format = value;
    btn.style.margin = '0';
    btn.style.height = '30px';
    btn.style.fontSize = '12px';
    if (value === currentFormat) {
      btn.style.background = '#2fd17c';
      btn.style.color = '#04130a';
      btn.style.border = '0';
    }
    btn.addEventListener('click', () => {
      currentFormat = value as ExportFormat;
      syncFormatButtons();
      rebuildOutput();
    });
    formatRow.append(btn);
    return btn;
  });

  // ─── Guide section ──────────────────────────────────────────────────────────
  const guide = document.createElement('div');
  guide.className = 'opx-summary';
  guide.textContent = '粘贴 ChatGPT Web session JSON 或点击「读取 Session」自动获取，然后选择格式下载。';

  // ─── Fetch session button ───────────────────────────────────────────────────
  const fetchSessionBtn = createButton('读取当前 Session', 'opx-button opx-button-secondary');
  fetchSessionBtn.style.marginBottom = '8px';

  // ─── Textarea input ─────────────────────────────────────────────────────────
  const inputLabel = document.createElement('span');
  inputLabel.className = 'opx-label';
  inputLabel.textContent = 'Session JSON';

  const input = document.createElement('textarea');
  input.className = 'opx-textarea';
  input.style.minHeight = '100px';
  input.placeholder = '粘贴 ChatGPT session JSON（含 accessToken、user.email 等字段）';
  input.spellcheck = false;

  // ─── Status ─────────────────────────────────────────────────────────────────
  const status = document.createElement('div');
  status.className = 'opx-status';
  status.textContent = '等待输入 Session JSON。';

  // ─── Account preview ────────────────────────────────────────────────────────
  const accountPreview = document.createElement('div');
  accountPreview.className = 'opx-session-card';
  accountPreview.style.display = 'none';

  // ─── Output ─────────────────────────────────────────────────────────────────
  const outputLabel = document.createElement('span');
  outputLabel.className = 'opx-label';
  outputLabel.textContent = '转换结果';

  const output = document.createElement('textarea');
  output.className = 'opx-textarea opx-output';
  output.style.minHeight = '100px';
  output.placeholder = '转换后的 JSON 将显示在此处。';
  output.readOnly = true;
  output.spellcheck = false;

  // ─── Action buttons ─────────────────────────────────────────────────────────
  const actionRow = document.createElement('div');
  actionRow.className = 'opx-button-row';

  const downloadBtn = createButton('下载 JSON', 'opx-button');
  downloadBtn.disabled = true;
  const copyBtn = createButton('复制', 'opx-button opx-button-secondary');
  copyBtn.disabled = true;
  const clearBtn = createButton('清空', 'opx-button opx-button-secondary');
  actionRow.append(downloadBtn, copyBtn, clearBtn);

  // ─── Event handlers ─────────────────────────────────────────────────────────

  input.addEventListener('input', () => {
    doConvert();
  });

  fetchSessionBtn.addEventListener('click', async () => {
    setStatus('正在读取 session...', 'pending');
    fetchSessionBtn.disabled = true;
    try {
      // Try direct fetch first (works in fingerprint browsers)
      let response: { ok: boolean; message?: string; session?: { accessToken?: string; email?: string; planType?: string; raw?: Record<string, unknown> } } | undefined;
      if (location.hostname === 'chatgpt.com') {
        response = await fetchChatGptSessionDirect();
      }

      // Fall back to background message
      if (!response || (!response.ok && !response.session?.accessToken)) {
        try {
          const bgResponse = await browser.runtime.sendMessage({ type: 'opx:fetch-chatgpt-session' });
          if (bgResponse?.ok && bgResponse?.session?.accessToken) {
            response = bgResponse;
          } else if (!response) {
            response = bgResponse;
          }
        } catch {
          // background unavailable, use direct result
        }
      }

      if (response?.ok && response?.session?.accessToken) {
        const sessionJson = JSON.stringify(response.session.raw || buildSessionObject(response.session as { email?: string; planType?: string; accessToken?: string }), null, 2);
        input.value = sessionJson;
        doConvert();
        setStatus('已成功读取 Session。', 'ok');
      } else {
        setStatus(response?.message || '读取 session 失败，请手动从 chatgpt.com/api/auth/session 复制粘贴', 'error');
      }
    } catch (error) {
      setStatus(`读取失败：${String(error)}`, 'error');
    } finally {
      fetchSessionBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!outputText) return;
    const fileName = buildFileName(converted, currentFormat);
    const blob = new Blob([outputText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`已下载 ${fileName}`, 'ok');
  });

  copyBtn.addEventListener('click', async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      setStatus('已复制到剪贴板。', 'ok');
    } catch {
      output.select();
      document.execCommand('copy');
      setStatus('已复制到剪贴板。', 'ok');
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    converted = [];
    outputText = '';
    output.value = '';
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    accountPreview.style.display = 'none';
    accountPreview.innerHTML = '';
    setStatus('已清空。', 'ok');
  });

  // ─── Internal helpers ───────────────────────────────────────────────────────

  function syncFormatButtons(): void {
    for (const btn of formatButtons) {
      if (btn.dataset.format === currentFormat) {
        btn.style.background = '#2fd17c';
        btn.style.color = '#04130a';
        btn.style.border = '0';
      } else {
        btn.style.background = '#182235';
        btn.style.color = '#93e4bd';
        btn.style.border = '1px solid rgba(47, 209, 124, 0.36)';
      }
    }
  }

  function doConvert(): void {
    const text = input.value.trim();
    if (!text) {
      converted = [];
      outputText = '';
      output.value = '';
      downloadBtn.disabled = true;
      copyBtn.disabled = true;
      accountPreview.style.display = 'none';
      accountPreview.innerHTML = '';
      setStatus('等待输入 Session JSON。', 'pending');
      return;
    }

    try {
      const result = parseAndConvert(text);
      converted = result.converted;

      if (converted.length > 0) {
        rebuildOutput();
        renderAccountPreview();
        setStatus(`已转换 ${converted.length} 个账号${result.skipped.length ? `，跳过 ${result.skipped.length} 项` : ''}。`, 'ok');
      } else {
        outputText = '';
        output.value = '';
        downloadBtn.disabled = true;
        copyBtn.disabled = true;
        accountPreview.style.display = 'none';
        const reason = result.skipped[0]?.reason || '未找到可转换的 session';
        setStatus(reason, 'error');
      }
    } catch (error) {
      converted = [];
      outputText = '';
      output.value = '';
      downloadBtn.disabled = true;
      copyBtn.disabled = true;
      accountPreview.style.display = 'none';
      setStatus(error instanceof Error ? error.message : 'JSON 解析失败', 'error');
    }
  }

  function rebuildOutput(): void {
    if (!converted.length) {
      outputText = '';
      output.value = '';
      downloadBtn.disabled = true;
      copyBtn.disabled = true;
      return;
    }
    const doc = buildOutputDocument(converted, currentFormat);
    outputText = JSON.stringify(doc, null, 2);
    output.value = outputText;
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
  }

  function renderAccountPreview(): void {
    if (!converted.length) {
      accountPreview.style.display = 'none';
      accountPreview.innerHTML = '';
      return;
    }
    accountPreview.style.display = 'grid';
    accountPreview.innerHTML = converted.map((item) => {
      const expiry = item.expiresAt ? formatDisplayDate(item.expiresAt) : '未知';
      return `
        <div class="opx-session-row"><span>邮箱</span><strong>${escapeHtml(item.email || '-')}</strong></div>
        <div class="opx-session-row"><span>名称</span><strong>${escapeHtml(item.name || '-')}</strong></div>
        <div class="opx-session-row"><span>过期</span><strong>${escapeHtml(expiry)}</strong></div>
      `;
    }).join('<hr style="border:none;border-top:1px solid rgba(148,163,184,0.16);margin:4px 0;">');
  }

  function setStatus(message: string, type: 'pending' | 'ok' | 'error'): void {
    status.textContent = message;
    status.dataset.type = type;
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  container.append(
    guide,
    formatRow,
    fetchSessionBtn,
    inputLabel,
    input,
    accountPreview,
    outputLabel,
    output,
    actionRow,
    status,
  );

  const update = async () => { /* no-op for now */ };
  const onShow = async () => { /* could auto-fetch session here */ };

  return { update, onShow };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDisplayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildSessionObject(session: { email?: string; planType?: string; accessToken?: string }): Record<string, unknown> {
  return {
    user: { email: session.email },
    account: { planType: session.planType },
    accessToken: session.accessToken,
  };
}

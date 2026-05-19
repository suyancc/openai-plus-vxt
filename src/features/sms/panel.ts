import { loadSmsRelayState, saveSmsRelayState } from '../../app/state';
import type { FeaturePanelHandle } from '../../app/types';
import { parseSmsRelayTargets } from './parser';
import { fetchSmsRelayCode } from './poller';
import type { SmsCodeRecord, SmsRelayState, SmsRelayTarget } from './types';

const POLL_INTERVAL_MS = 3_000;

interface TargetRuntime {
  target: SmsRelayTarget;
  status: 'waiting' | 'found' | 'error';
  message: string;
  code: string;
  lastCheckedAt: number;
  inFlight: boolean;
}

export function createSmsPanel(container: HTMLElement): FeaturePanelHandle {
  const summary = document.createElement('div');
  summary.className = 'opx-summary';

  const input = document.createElement('textarea');
  input.className = 'opx-textarea opx-sms-input';
  input.placeholder = '+14642649811----https://xxxx.com/xxx\n每行一个号码和 API 链接';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const buttonRow = document.createElement('div');
  buttonRow.className = 'opx-button-row opx-sms-actions';
  const saveButton = createButton('保存并开始');
  const pollNowButton = createButton('立即获取', 'opx-button opx-button-secondary');
  const clearHistoryButton = createButton('清空历史', 'opx-button opx-button-secondary');
  buttonRow.append(saveButton, pollNowButton, clearHistoryButton);

  const targetTitle = createTitle('当前号码');
  const targetList = document.createElement('div');
  targetList.className = 'opx-sms-targets';

  const historyTitle = createTitle('验证码历史');
  const historyTable = document.createElement('div');
  historyTable.className = 'opx-sms-table';

  const status = document.createElement('div');
  status.className = 'opx-status';

  const runtimeById = new Map<string, TargetRuntime>();
  let currentState: SmsRelayState | null = null;
  let pollTimer: number | null = null;
  let lastSavedInput = '';
  let inputSaveTimer: number | null = null;
  let inputFocused = false;

  container.append(
    summary,
    createField('接码信息', input),
    buttonRow,
    targetTitle,
    targetList,
    historyTitle,
    historyTable,
    status,
  );

  input.addEventListener('input', () => {
    scheduleInputSave();
    renderTargetsFromInput();
  });
  input.addEventListener('focus', () => {
    inputFocused = true;
  });
  input.addEventListener('blur', () => {
    inputFocused = false;
    void persistInputNow();
  });

  saveButton.addEventListener('click', async () => {
    await persistInputNow();
    renderTargetsFromInput();
    await pollAllTargets();
  });

  pollNowButton.addEventListener('click', async () => {
    await persistInputNow();
    renderTargetsFromInput();
    await pollAllTargets();
  });

  clearHistoryButton.addEventListener('click', async () => {
    const next = await saveSmsRelayState({ history: [] });
    currentState = next;
    renderHistory(next.history);
    setStatus(status, '验证码历史已清空，输入内容已保留。', 'ok');
  });

  const update = async () => {
    const state = await loadSmsRelayState();
    currentState = state;
    if (!inputFocused && input.value !== state.rawInput) {
      input.value = state.rawInput;
      lastSavedInput = state.rawInput;
      renderTargetsFromInput();
    }
    renderHistory(state.history);
    renderSummary();
  };

  const onShow = async () => {
    await update();
    ensurePolling();
  };

  void update();
  return { update, onShow };

  function scheduleInputSave(): void {
    if (inputSaveTimer) {
      window.clearTimeout(inputSaveTimer);
    }
    inputSaveTimer = window.setTimeout(() => void persistInputNow(), 450);
  }

  async function persistInputNow(): Promise<void> {
    if (inputSaveTimer) {
      window.clearTimeout(inputSaveTimer);
      inputSaveTimer = null;
    }
    const rawInput = input.value;
    if (rawInput === lastSavedInput) {
      return;
    }
    currentState = await saveSmsRelayState({ rawInput });
    lastSavedInput = rawInput;
    renderSummary();
  }

  function ensurePolling(): void {
    if (pollTimer !== null) {
      return;
    }
    pollTimer = window.setInterval(() => void pollAllTargets(), POLL_INTERVAL_MS);
  }

  function renderTargetsFromInput(): void {
    const parsed = parseSmsRelayTargets(input.value);
    const nextIds = new Set(parsed.targets.map((target) => target.id));

    for (const [id] of runtimeById) {
      if (!nextIds.has(id)) {
        runtimeById.delete(id);
      }
    }

    for (const target of parsed.targets) {
      const current = runtimeById.get(target.id);
      if (current) {
        current.target = target;
      } else {
        runtimeById.set(target.id, {
          target,
          status: 'waiting',
          message: '等待获取',
          code: '',
          lastCheckedAt: 0,
          inFlight: false,
        });
      }
    }

    targetList.textContent = '';
    if (!parsed.targets.length) {
      targetList.append(createEmpty(parsed.errors[0] || '暂无号码，按每行“号码----API链接”输入。'));
    } else {
      for (const target of parsed.targets) {
        const runtime = runtimeById.get(target.id);
        if (runtime) {
          targetList.append(createTargetRow(runtime));
        }
      }
    }

    if (parsed.errors.length) {
      setStatus(status, parsed.errors.join('；'), 'error');
    } else if (parsed.targets.length) {
      setStatus(status, `已加载 ${parsed.targets.length} 个接码链接，每 3 秒自动获取。`, 'pending');
    } else {
      setStatus(status, '输入内容会自动保存。', 'pending');
    }
    renderSummary();
  }

  function renderSummary(): void {
    const parsed = parseSmsRelayTargets(input.value);
    const historyCount = currentState?.history.length || 0;
    const foundCount = [...runtimeById.values()].filter((item) => item.code).length;
    summary.textContent = `${parsed.targets.length} 个接码链接 · ${foundCount} 个当前验证码 · ${historyCount} 条历史`;
  }

  async function pollAllTargets(): Promise<void> {
    const parsed = parseSmsRelayTargets(input.value);
    if (!parsed.targets.length || parsed.errors.length) {
      return;
    }

    await persistInputNow();
    await Promise.all(parsed.targets.map((target) => pollTarget(target)));
    renderTargetsFromInput();
    renderHistory(currentState?.history || []);
  }

  async function pollTarget(target: SmsRelayTarget): Promise<void> {
    const runtime = runtimeById.get(target.id);
    if (!runtime || runtime.inFlight) {
      return;
    }

    runtime.inFlight = true;
    runtime.status = runtime.code ? 'found' : 'waiting';
    runtime.message = '正在获取...';
    renderTargetsFromInput();

    const result = await fetchSmsRelayCode(target);
    runtime.inFlight = false;
    runtime.lastCheckedAt = Date.now();

    if (result.kind === 'code') {
      runtime.status = 'found';
      runtime.code = result.code;
      runtime.message = result.message;
      await appendCodeHistory(target.phone, result.code, result.message);
      setStatus(status, `${target.phone} 收到验证码 ${result.code}`, 'ok');
      return;
    }

    if (result.kind === 'error') {
      runtime.status = 'error';
      runtime.message = result.message;
      setStatus(status, `${target.phone} 获取失败：${result.message}`, 'error');
      return;
    }

    runtime.status = 'waiting';
    runtime.message = result.message;
  }

  async function appendCodeHistory(phone: string, code: string, message: string): Promise<void> {
    const state = currentState || await loadSmsRelayState();
    const exists = state.history.some((item) => item.phone === phone && item.code === code && item.message === message);
    if (exists) {
      currentState = state;
      return;
    }

    const record: SmsCodeRecord = {
      id: `${phone}-${code}-${Date.now()}`,
      phone,
      code,
      message,
      receivedAt: Date.now(),
    };
    const nextHistory = [record, ...state.history].slice(0, 80);
    currentState = await saveSmsRelayState({ history: nextHistory });
  }

  function createTargetRow(runtime: TargetRuntime): HTMLElement {
    const row = document.createElement('div');
    row.className = 'opx-sms-target-row';
    row.dataset.status = runtime.status;

    const main = document.createElement('div');
    main.className = 'opx-sms-target-main';
    const phone = document.createElement('strong');
    phone.textContent = runtime.target.phone;
    const detail = document.createElement('span');
    detail.textContent = runtime.code ? runtime.message : runtime.message || '等待获取';
    main.append(phone, detail);

    const codeButton = document.createElement('button');
    codeButton.className = 'opx-sms-code-chip';
    codeButton.type = 'button';
    codeButton.textContent = runtime.code || (runtime.inFlight ? '...' : '等待');
    codeButton.disabled = !runtime.code;
    codeButton.title = runtime.code ? '点击复制验证码' : '尚未收到验证码';
    codeButton.addEventListener('click', () => void copyCode(runtime.code, codeButton));

    row.append(main, codeButton);
    return row;
  }

  function renderHistory(history: SmsCodeRecord[]): void {
    historyTable.textContent = '';
    const header = document.createElement('div');
    header.className = 'opx-sms-table-row opx-sms-table-head';
    header.append(createCell('号码'), createCell('验证码'), createCell('时间'));
    historyTable.append(header);

    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'opx-empty-inline';
      empty.textContent = '暂无验证码历史。';
      historyTable.append(empty);
      return;
    }

    for (const item of history) {
      const row = document.createElement('div');
      row.className = 'opx-sms-table-row';
      const codeButton = document.createElement('button');
      codeButton.className = 'opx-sms-code-chip';
      codeButton.type = 'button';
      codeButton.textContent = item.code;
      codeButton.title = item.message || '点击复制验证码';
      codeButton.addEventListener('click', () => void copyCode(item.code, codeButton));
      row.append(
        createCell(item.phone),
        wrapCell(codeButton),
        createCell(formatTime(item.receivedAt)),
      );
      historyTable.append(row);
    }
  }

  async function copyCode(code: string, button: HTMLButtonElement): Promise<void> {
    if (!code) {
      return;
    }
    await navigator.clipboard.writeText(code);
    const original = button.textContent || code;
    button.textContent = '已复制';
    button.classList.add('is-copied');
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1200);
  }
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

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function createTitle(text: string): HTMLElement {
  const title = document.createElement('div');
  title.className = 'opx-section-title';
  title.textContent = text;
  return title;
}

function createEmpty(text: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'opx-empty-inline';
  item.textContent = text;
  return item;
}

function createCell(text: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'opx-sms-table-cell';
  cell.textContent = text;
  return cell;
}

function wrapCell(content: HTMLElement): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'opx-sms-table-cell';
  cell.append(content);
  return cell;
}

function setStatus(element: HTMLElement, message: string, type: 'pending' | 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

function formatTime(value: number): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

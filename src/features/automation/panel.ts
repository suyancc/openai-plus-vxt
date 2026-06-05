import type { FeaturePanelHandle } from '../../app/types';
import { loadAutomationState } from '../../app/state';
import { setButtonPending } from '../../app/button-feedback';
import {
  clearAutomationLogs,
  findStepRecord,
} from './state';
import {
  resetAutomationRun,
  runAutomationFrom,
  runAutomationStageFrom,
  runAutomationStep,
  stopAutomationRun,
} from './runner';
import { visibleAutomationSteps } from './steps';
import type { AutomationLogEntry, AutomationState, AutomationStepId, AutomationStepStatus } from './types';

const STATUS_LABELS: Record<AutomationStepStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '完成',
  error: '失败',
  skipped: '跳过',
};

interface AutomationStageDefinition {
  id: string;
  title: string;
  startStepId: AutomationStepId;
  stepIds: AutomationStepId[];
}

const AUTOMATION_STAGES: AutomationStageDefinition[] = [
  {
    id: 'register',
    title: '注册',
    startStepId: 'cleanup-environment',
    stepIds: [
      'cleanup-environment',
      'select-email',
      'open-register',
      'fill-register-email',
      'wait-register-email-code',
      'fill-profile',
    ],
  },
  {
    id: 'payment',
    title: '支付',
    startStepId: 'read-chatgpt-session',
    stepIds: [
      'read-chatgpt-session',
      'create-checkout-link',
      'open-checkout-link',
      'submit-openai-checkout',
      'open-paypal-account',
      'fill-paypal-email',
      'select-sms',
      'fill-payment-profile',
      'wait-payment-sms',
    ],
  },
  {
    id: 'oauth',
    title: '提取 OAuth',
    startStepId: 'create-oauth-session',
    stepIds: [
      'create-oauth-session',
      'fill-oauth-email',
      'wait-oauth-email-code',
      'export-oauth-files',
      'generate-direct-files',
    ],
  },
];

export function createAutomationPanel(container: HTMLElement): FeaturePanelHandle {
  let lastLogSignature: string | null = null;
  const expandedStages = new Set<string>();

  const header = document.createElement('div');
  header.className = 'opx-automation-header';

  const summary = document.createElement('div');
  summary.className = 'opx-summary opx-automation-summary';

  const settingsButton = createSmallButton('设置');
  settingsButton.className = 'opx-automation-settings-button';
  settingsButton.title = '打开自动化配置页面';
  header.append(summary, settingsButton);

  const controls = document.createElement('div');
  controls.className = 'opx-button-row opx-automation-controls';
  const runButton = createButton('自动执行');
  const stopButton = createButton('停止', 'opx-button opx-button-danger');
  const resetButton = createButton('重置', 'opx-button opx-button-secondary');
  controls.append(runButton, stopButton, resetButton);

  const stepsHeader = document.createElement('div');
  stepsHeader.className = 'opx-automation-section-header';
  const stepsTitle = document.createElement('span');
  stepsTitle.textContent = '流程';
  const stepsProgress = document.createElement('strong');
  stepsHeader.append(stepsTitle, stepsProgress);

  const stagesList = document.createElement('div');
  stagesList.className = 'opx-automation-stages';

  const logHeader = document.createElement('div');
  logHeader.className = 'opx-automation-section-header';
  const logTitle = document.createElement('span');
  logTitle.textContent = '日志';
  const clearLogButton = createSmallButton('清空');
  logHeader.append(logTitle, clearLogButton);

  const logArea = document.createElement('div');
  logArea.className = 'opx-automation-log';

  const status = document.createElement('div');
  status.className = 'opx-status';
  status.dataset.toast = 'off';

  container.append(header, controls, stepsHeader, stagesList, logHeader, logArea, status);

  settingsButton.addEventListener('click', () => openSettingsPage());
  runButton.addEventListener('click', async () => {
    setStatus(status, '自动执行已启动...', 'pending');
    const restoreButton = setButtonPending(runButton, '执行中...');
    setBusy(true);
    try {
      const result = await runAutomationFrom();
      setStatus(status, result.message, result.ok ? 'ok' : 'error');
    } finally {
      restoreButton();
      setBusy(false);
      await update();
    }
  });
  stopButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(stopButton, '停止中...');
    setStatus(status, '正在停止自动化...', 'pending');
    try {
      const result = await stopAutomationRun();
      setStatus(status, result.message, 'ok');
    } finally {
      restoreButton();
      await update();
    }
  });
  resetButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(resetButton, '重置中...');
    setStatus(status, '正在重置流程状态...', 'pending');
    try {
      const result = await resetAutomationRun();
      setStatus(status, result.message, 'ok');
    } finally {
      restoreButton();
      await update();
    }
  });
  clearLogButton.addEventListener('click', async () => {
    const restoreButton = setButtonPending(clearLogButton, '清空中...');
    setStatus(status, '正在清空日志...', 'pending');
    try {
      await clearAutomationLogs();
      setStatus(status, '日志已清空', 'ok');
    } finally {
      restoreButton();
      await update();
    }
  });

  const update = async () => {
    const state = await loadAutomationState();
    render(state);
  };

  void update();
  return { update, onShow: update };

  function render(state: AutomationState): void {
    const email = state.emails.find((item) => item.id === state.run.selectedEmailId);
    const sms = state.smsTargets.find((item) => item.id === state.run.selectedSmsId);
    const visibleSteps = visibleAutomationSteps(state.settings.oauthExtractMode, state.settings.registrationMode);
    const visibleIds = new Set(visibleSteps.map((step) => step.id));
    const successCount = state.steps.filter((step) => visibleIds.has(step.id) && step.status === 'success').length;
    const runningStep = state.steps.find((step) => visibleIds.has(step.id) && step.status === 'running');
    summary.textContent = [
      `${successCount} / ${visibleSteps.length} 步`,
      state.settings.registrationMode === 'phone' ? '手机号注册' : `${state.emails.length} 个邮箱`,
      `${state.smsTargets.length} 个接码`,
      state.settings.registrationMode === 'phone'
        ? (state.run.registerPhoneNumber ? `当前：${state.run.registerPhoneNumber}` : '未取手机号')
        : (email ? `当前：${email.email}` : '未选邮箱'),
      sms ? `接码：${sms.phone}` : '',
    ].filter(Boolean).join(' · ');
    stepsProgress.textContent = runningStep ? `执行中：${runningStep.id}` : `${successCount} / ${visibleSteps.length}`;
    runButton.disabled = state.run.running;
    stopButton.disabled = !state.run.running;
    renderStages(state);
    renderLogs(state.logs);
  }

  function renderStages(state: AutomationState): void {
    stagesList.textContent = '';
    const visibleDefinitions = visibleAutomationSteps(state.settings.oauthExtractMode, state.settings.registrationMode);
    const visibleById = new Map(visibleDefinitions.map((definition) => [definition.id, definition]));
    const visibleOrder = new Map(visibleDefinitions.map((definition, index) => [definition.id, index]));
    for (const stage of AUTOMATION_STAGES) {
      const definitions = stage.stepIds
        .map((stepId) => visibleById.get(stepId))
        .filter((definition): definition is typeof visibleDefinitions[number] => Boolean(definition))
        .sort((left, right) => (visibleOrder.get(left.id) ?? 0) - (visibleOrder.get(right.id) ?? 0));
      if (!definitions.length) {
        continue;
      }
      const records = definitions.map((definition) => findStepRecord(state, definition.id));
      const expanded = expandedStages.has(stage.id);
      const stageElement = document.createElement('section');
      stageElement.className = 'opx-automation-stage';
      stageElement.dataset.status = stageStatus(records);
      stageElement.dataset.expanded = expanded ? 'true' : 'false';

      const stageHeader = document.createElement('button');
      stageHeader.className = 'opx-automation-stage-header';
      stageHeader.type = 'button';
      const caret = document.createElement('span');
      caret.className = 'opx-automation-stage-caret';
      caret.textContent = expanded ? '▾' : '▸';
      const title = document.createElement('strong');
      title.textContent = stage.title;
      const summary = document.createElement('span');
      summary.textContent = stageSummary(records);
      const detail = document.createElement('em');
      detail.textContent = stageDetail(definitions, records);
      stageHeader.append(caret, title, summary, detail);
      stageHeader.addEventListener('click', () => {
        if (expandedStages.has(stage.id)) {
          expandedStages.delete(stage.id);
        } else {
          expandedStages.add(stage.id);
        }
        renderStages(state);
      });

      const runStageButton = createSmallButton('重跑本阶段');
      runStageButton.classList.add('opx-automation-stage-run');
      runStageButton.disabled = state.run.running;
      runStageButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        const startStep = firstVisibleStageStep(stage, visibleById);
        if (!startStep) {
          setStatus(status, '当前模式下没有可执行的阶段步骤', 'error');
          return;
        }
        setStatus(status, `正在重跑：${stage.title}`, 'pending');
        const restoreButton = setButtonPending(runStageButton, '重跑中...');
        setBusy(true);
        try {
          const result = await runAutomationStageFrom(startStep.id, stage.title);
          setStatus(status, result.message, result.ok ? 'ok' : 'error');
        } finally {
          restoreButton();
          setBusy(false);
          await update();
        }
      });

      const top = document.createElement('div');
      top.className = 'opx-automation-stage-top';
      top.append(stageHeader, runStageButton);
      stageElement.append(top);

      if (expanded) {
        const stepsList = document.createElement('div');
        stepsList.className = 'opx-automation-steps';
        for (const definition of definitions) {
          stepsList.append(createStepRow(state, definition));
        }
        stageElement.append(stepsList);
      }
      stagesList.append(stageElement);
    }
  }

  function createStepRow(
    state: AutomationState,
    definition: ReturnType<typeof visibleAutomationSteps>[number],
  ): HTMLElement {
    const record = findStepRecord(state, definition.id);
    const row = document.createElement('div');
    row.className = 'opx-automation-step';
    row.dataset.status = record.status;

    const indicator = document.createElement('span');
    indicator.className = 'opx-automation-step-indicator';
    indicator.textContent = statusIcon(record.status);

    const main = document.createElement('div');
    main.className = 'opx-automation-step-main';
    const title = document.createElement('strong');
    title.textContent = `${definition.order / 10}. ${definition.title}`;
    const detail = document.createElement('span');
    detail.textContent = record.message || definition.description;
    main.append(title, detail);

    const meta = document.createElement('div');
    meta.className = 'opx-automation-step-meta';
    const label = document.createElement('span');
    label.textContent = STATUS_LABELS[record.status];
    const button = createSmallButton(record.status === 'error' ? '重试' : record.status === 'success' ? '重跑' : '执行');
    button.disabled = state.run.running || record.status === 'running';
    button.addEventListener('click', async () => {
      setStatus(status, `正在执行：${definition.title}`, 'pending');
      const restoreButton = setButtonPending(button, '执行中...');
      try {
        const result = await runAutomationStep(definition.id);
        setStatus(status, result.message, result.ok ? 'ok' : 'error');
      } finally {
        restoreButton();
        await update();
      }
    });
    meta.append(label, button);

    row.append(indicator, main, meta);
    return row;
  }

  function renderLogs(logs: AutomationLogEntry[]): void {
    const signature = logs.slice(0, 80).map((entry) => `${entry.id}:${entry.time}:${entry.level}:${entry.message}`).join('|');
    if (lastLogSignature !== null && signature === lastLogSignature) {
      return;
    }
    if (hasSelectionInside(logArea)) {
      return;
    }
    lastLogSignature = signature;
    logArea.textContent = '';
    if (!logs.length) {
      const empty = document.createElement('div');
      empty.className = 'opx-empty-inline';
      empty.textContent = '暂无日志。';
      logArea.append(empty);
      return;
    }
    for (const entry of logs.slice(0, 80)) {
      const line = document.createElement('div');
      line.className = 'opx-automation-log-line';
      line.dataset.level = entry.level;
      const time = document.createElement('span');
      time.textContent = formatTime(entry.time);
      const message = document.createElement('strong');
      message.textContent = entry.message;
      line.append(time, message);
      logArea.append(line);
    }
  }

  function setBusy(busy: boolean): void {
    runButton.disabled = busy;
    resetButton.disabled = busy;
  }
}

function firstVisibleStageStep(
  stage: AutomationStageDefinition,
  visibleById: Map<AutomationStepId, ReturnType<typeof visibleAutomationSteps>[number]>,
): ReturnType<typeof visibleAutomationSteps>[number] | null {
  const configuredStart = visibleById.get(stage.startStepId);
  if (configuredStart) {
    return configuredStart;
  }
  return stage.stepIds.map((stepId) => visibleById.get(stepId)).find(Boolean) || null;
}

function stageStatus(records: ReturnType<typeof findStepRecord>[]): AutomationStepStatus {
  if (records.some((record) => record.status === 'running')) {
    return 'running';
  }
  if (records.some((record) => record.status === 'error')) {
    return 'error';
  }
  if (records.length && records.every((record) => record.status === 'success')) {
    return 'success';
  }
  if (records.some((record) => record.status === 'success')) {
    return 'skipped';
  }
  return 'pending';
}

function stageSummary(records: ReturnType<typeof findStepRecord>[]): string {
  const successCount = records.filter((record) => record.status === 'success').length;
  const errorCount = records.filter((record) => record.status === 'error').length;
  const running = records.find((record) => record.status === 'running');
  if (running) {
    return `执行中 · ${successCount}/${records.length}`;
  }
  if (errorCount) {
    return `失败 ${errorCount} 项 · ${successCount}/${records.length}`;
  }
  if (successCount === records.length && records.length > 0) {
    return `完成 · ${successCount}/${records.length}`;
  }
  if (successCount > 0) {
    return `进行中 · ${successCount}/${records.length}`;
  }
  return `未开始 · 0/${records.length}`;
}

function stageDetail(
  definitions: ReturnType<typeof visibleAutomationSteps>,
  records: ReturnType<typeof findStepRecord>[],
): string {
  const active = records.find((record) => record.status === 'running') ||
    records.find((record) => record.status === 'error') ||
    [...records].reverse().find((record) => record.message);
  if (!active) {
    return definitions[0]?.description || '';
  }
  const definition = definitions.find((item) => item.id === active.id);
  return `${definition?.title || active.id}：${active.message || STATUS_LABELS[active.status]}`;
}

function openSettingsPage(): void {
  const url = browser.runtime.getURL('/automation-settings.html' as Parameters<typeof browser.runtime.getURL>[0]);
  void browser.tabs.create({ url, active: true });
}

function statusIcon(status: AutomationStepStatus): string {
  if (status === 'success') {
    return '✓';
  }
  if (status === 'error') {
    return '!';
  }
  if (status === 'running') {
    return '…';
  }
  if (status === 'skipped') {
    return '跳';
  }
  return '';
}

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function createSmallButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'opx-mini-button opx-mini-button-secondary';
  button.type = 'button';
  button.textContent = label;
  return button;
}

function setStatus(element: HTMLElement, message: string, type: 'pending' | 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

function formatTime(time: number): string {
  const date = new Date(time || Date.now());
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':');
}

function hasSelectionInside(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return element.contains(range.startContainer) || element.contains(range.endContainer);
}

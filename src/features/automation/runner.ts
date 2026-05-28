import { getBrowserTab, type BrowserTabInfo } from '../../app/active-tab';
import {
  loadAutomationState,
  saveRegisterState,
  saveSmsRelayState,
} from '../../app/state';
import type { ActionResult } from '../../app/types';
import {
  checkCurrentPaymentPageReady,
  fetchRandomAddressFromSettings,
  fillCurrentPaymentPageWithAddress,
  fillCurrentPaypalCheckoutEmail,
  openCurrentPaypalAccountEntry,
  submitCurrentOpenAiCheckout,
} from '../address-autofill/service';
import type { AddressProfile } from '../address-autofill/types';
import {
  CHATGPT_REGISTER_URL,
  fillRegisterEmailFromCurrentInput,
  stopOutlookOtp,
} from '../register/service';
import type { AutomationFinishCleanupResponse, CookieClearTarget } from '../settings/types';
import { AUTOMATION_STEPS, nextVisibleAutomationStepId } from './steps';
import {
  appendAutomationLog,
  markAutomationStep,
  resetAutomationFromStep,
  resetAutomationProgress,
  saveAutomationSettings,
  setAutomationRunning,
  updateAutomationEmails,
  updateAutomationRun,
  updateAutomationSmsTargets,
} from './state';
import type {
  AutomationSmsTarget,
  AutomationState,
  AutomationStepId,
} from './types';
import {
  actionDataStatus,
  debugPayloadText,
  delay,
  isRecord,
  parseUrl,
  sanitizeDebugData,
  shortFailureReason,
  shortUrl,
  summarizeActionData,
} from './runner-format';
import {
  accountUnavailableFailureLabel,
  isPaymentProfileComplete,
  isPhoneNumberRejectedFailure,
  isRetryableOpenAiCheckoutAddressFailure,
  isRetryablePaypalProfileFailure,
  isSmsNumberRejectedStep,
  shouldRefreshPaymentAddress,
  shouldRetryPaymentProfile,
  type PaymentProfileResult,
} from './runner-errors';
import {
  isChatGptHomeUrl,
  isOpenAiCheckoutUrl,
  isPaypalCheckoutFlowUrl,
  isPaypalSignupUrl,
  isRegisterUrl,
} from './runner-url';
import {
  availableSmsTargets,
  currentEmail,
  currentSmsTarget,
  ensureSelectedEmail,
  hasNextBatchEmail,
  markSelectedEmailError,
  markSelectedEmailUsed,
  markSelectedSmsDisabled,
  normalizeBatchAccountLimit,
  selectEmail,
  selectSmsTarget,
} from './runner-state';
import {
  resolveAutomationStartStep,
  stepNumber,
  stepTitle,
} from './runner-progress';
import {
  waitOutlookCodeStep as waitOutlookCodeStepModule,
} from './runner-email-otp';
import {
  fillProfileStep as fillProfileStepModule,
} from './runner-profile';
import {
  waitForPaymentPageReady as waitForPaymentPageReadyModule,
  waitForPaypalAfterAccountEntry as waitForPaypalAfterAccountEntryModule,
  waitForPaypalEmailReadyOrClickEntry as waitForPaypalEmailReadyOrClickEntryModule,
} from './runner-payment-ready';
import {
  waitPaymentSmsStep as waitPaymentSmsStepModule,
} from './runner-payment-sms';
import {
  createCheckoutLinkStep as createCheckoutLinkStepModule,
  openCheckoutLinkStep as openCheckoutLinkStepModule,
  readSessionStep as readSessionStepModule,
} from './runner-checkout';
import {
  createOAuthSessionStep as createOAuthSessionStepModule,
  exportOAuthFilesStep as exportOAuthFilesStepModule,
  fillOAuthEmailStep as fillOAuthEmailStepModule,
  generateDirectFilesStep as generateDirectFilesStepModule,
  waitOAuthEmailCodeStep as waitOAuthEmailCodeStepModule,
} from './runner-oauth';
import { cancelOAuthPhoneVerification } from '../oauth/service';

const CHATGPT_HOME_LOAD_TIMEOUT_MS = 30_000;
const PAYMENT_PAGE_LOAD_TIMEOUT_MS = 45_000;
const PAYMENT_PROFILE_ATTEMPTS = 5;
const PAYMENT_PROFILE_RETRY_DELAY_MS = 3_000;
const PAYPAL_STEP_TIMEOUT_MS = 90_000;
const AUTOMATION_START_STEP: AutomationStepId = 'cleanup-environment';
const PAYMENT_STAGE_START_STEP: AutomationStepId = 'read-chatgpt-session';
const PAYMENT_PROFILE_STEP: AutomationStepId = 'fill-payment-profile';
const BATCH_NEXT_ACCOUNT_DELAY_MS = 3_600;
const AUTOMATION_STOP_CODE = 'automation-stopped';
const STOP_SIDE_EFFECT_TIMEOUT_MS = 3_000;

let autoRunActive = false;
let stopRequested = false;
let stopSignalId = 0;
const stopWaiters = new Set<(result: ActionResult) => void>();

async function bindAutomationTargetTab(tab: BrowserTabInfo | null, reason: string): Promise<number> {
  if (!tab || typeof tab.id !== 'number') {
    throw new Error(`${reason}失败：没有可绑定的浏览器标签页`);
  }
  await updateAutomationRun({
    targetTabId: tab.id,
    targetWindowId: typeof tab.windowId === 'number' ? tab.windowId : 0,
  });
  await appendAutomationLog('info', `已锁定自动化标签页：${shortUrl(tab.url || '') || `tab ${tab.id}`}`, '');
  return tab.id;
}

async function clearAutomationTargetTab(): Promise<void> {
  await updateAutomationRun({ targetTabId: 0, targetWindowId: 0 });
}

async function appendAutomationDebugLog(
  stepId: AutomationStepId | '',
  event: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const state = await loadAutomationState();
    if (!state.settings.debugMode) {
      return;
    }
    let tabInfo: Record<string, unknown> = {};
    if (state.run.targetTabId > 0) {
      try {
        const tab = await getBrowserTab(state.run.targetTabId);
        tabInfo = {
          targetTabId: tab?.id || state.run.targetTabId,
          targetWindowId: tab?.windowId || state.run.targetWindowId,
          targetUrl: tab?.url || '',
          targetStatus: tab?.status || '',
        };
      } catch (error) {
        tabInfo = {
          targetTabId: state.run.targetTabId,
          targetWindowId: state.run.targetWindowId,
          targetError: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const payload = sanitizeDebugData({
      event,
      stepId,
      runStartedAt: state.run.startedAt,
      selectedEmailId: state.run.selectedEmailId,
      selectedSmsId: state.run.selectedSmsId,
      ...tabInfo,
      ...data,
    });
    console.debug('[OPX Automation Debug]', payload);
    await appendAutomationLog('info', `调试：${event} ${debugPayloadText(payload)}`, stepId);
  } catch (error) {
    console.debug('[OPX Automation Debug] append skipped', error);
  }
}

async function getAutomationTargetTab(): Promise<BrowserTabInfo | null> {
  const state = await loadAutomationState();
  if (state.run.targetTabId > 0) {
    return getBrowserTab(state.run.targetTabId);
  }
  return null;
}

async function ensureAutomationTargetTab(): Promise<BrowserTabInfo> {
  const state = await loadAutomationState();
  if (state.run.targetTabId > 0) {
    const target = await getBrowserTab(state.run.targetTabId);
    if (!target || typeof target.id !== 'number') {
      await clearAutomationTargetTab();
      await appendAutomationLog('warn', '自动化目标标签页已关闭，重新锁定当前活动页面', '');
      const active = await getBrowserTab();
      await bindAutomationTargetTab(active, '重新锁定当前页面');
      if (!active || typeof active.id !== 'number') {
        throw new Error('自动化目标标签页不存在或已关闭，请切到正确页面后重跑当前步骤');
      }
      return active;
    }
    return target;
  }

  const active = await getBrowserTab();
  await bindAutomationTargetTab(active, '锁定当前页面');
  if (!active || typeof active.id !== 'number') {
    throw new Error('没有可操作的当前标签页');
  }
  return active;
}

async function automationTargetTabId(): Promise<number> {
  const target = await ensureAutomationTargetTab();
  if (typeof target.id !== 'number') {
    throw new Error('自动化目标标签页无效');
  }
  return target.id;
}

export async function runAutomationStep(stepId: AutomationStepId): Promise<ActionResult> {
  const wasAutoRunning = autoRunActive;
  if (stopRequested) {
    return stoppedResult();
  }
  if (!wasAutoRunning) {
    await setAutomationRunning(true, false);
  }
  await markAutomationStep(stepId, 'running', '执行中');
  await appendAutomationLog('info', `开始：${stepTitle(stepId)}`, stepId);
  const startedAt = Date.now();
  await appendAutomationDebugLog(stepId, 'step-start', { wasAutoRunning });
  try {
    const result = await runInterruptibleStep(stepId);
    await appendAutomationDebugLog(stepId, 'step-result', {
      ok: result.ok,
      elapsedMs: Date.now() - startedAt,
      result,
    });
    if (result.code === AUTOMATION_STOP_CODE) {
      await markAutomationStep(stepId, 'error', result.message);
      await appendAutomationLog('warn', result.message, stepId);
      await setAutomationRunning(false, true);
      return result;
    }
    if (!wasAutoRunning && !result.ok) {
      const accountUnavailable = await handleAccountUnavailableResult(stepId, result);
      if (accountUnavailable) {
        await setAutomationRunning(false, accountUnavailable.paused);
        return accountUnavailable.result;
      }
    }
    if (!wasAutoRunning && !result.ok && isSmsNumberRejectedStep(stepId) && isPhoneNumberRejectedFailure(result)) {
      const disabled = await markSelectedSmsDisabled(result.message);
      const latestAfterDisable = await loadAutomationState();
      if (!availableSmsTargets(latestAfterDisable).length) {
        const message = disabled
          ? `接码号码不可用：${disabled.phone}；号码池没有其他可用号码，任务已暂停`
          : `接码号码不可用；号码池没有其他可用号码，任务已暂停：${result.message}`;
        await markAutomationStep(stepId, 'error', message);
        await appendAutomationLog('error', message, stepId);
        await setAutomationRunning(false, true);
        return { ...result, ok: false, message };
      }

      const message = disabled
        ? `接码号码不可用，已禁用 ${disabled.phone}，切换号码后从第 12 步重新执行`
        : `接码号码不可用，切换号码后从第 12 步重新执行：${result.message}`;
      await resetAutomationFromStep('select-sms');
      await updateAutomationRun({ selectedSmsId: '' });
      await markAutomationStep(stepId, 'error', message);
      await appendAutomationLog('warn', message, stepId);
      await setAutomationRunning(false, false);
      return runAutomationFrom('select-sms');
    }
    if (result.ok) {
      await markAutomationStep(stepId, 'success', result.message);
      await appendAutomationLog('success', result.message, stepId);
      if (!wasAutoRunning) {
        const state = await loadAutomationState();
        await updateAutomationRun({ currentStepId: nextVisibleAutomationStepId(stepId, state.settings.oauthExtractMode) });
      }
    } else {
      await markAutomationStep(stepId, 'error', result.message);
      await appendAutomationLog('error', result.message, stepId);
    }
    return result;
  } catch (error) {
    if (isAutomationStopError(error)) {
      const result = stoppedResult();
      await markAutomationStep(stepId, 'error', result.message);
      await appendAutomationLog('warn', result.message, stepId);
      await setAutomationRunning(false, true);
      return result;
    }
    const message = error instanceof Error ? error.message : String(error);
    await appendAutomationDebugLog(stepId, 'step-exception', {
      elapsedMs: Date.now() - startedAt,
      message,
      stack: error instanceof Error ? error.stack : '',
    });
    await markAutomationStep(stepId, 'error', message);
    await appendAutomationLog('error', message, stepId);
    return { ok: false, message };
  } finally {
    if (!wasAutoRunning && !stopRequested) {
      await setAutomationRunning(false, false);
    }
  }
}

async function runInterruptibleStep(stepId: AutomationStepId): Promise<ActionResult> {
  if (stopRequested) {
    return stoppedResult();
  }
  const stopWait = createStopWaiter(stopSignalId);
  try {
    return await Promise.race([
      executeStep(stepId),
      stopWait.promise,
    ]);
  } finally {
    stopWait.dispose();
  }
}

function requestAutomationStop(): ActionResult {
  stopRequested = true;
  stopSignalId += 1;
  const result = stoppedResult();
  for (const waiter of [...stopWaiters]) {
    waiter(result);
  }
  stopWaiters.clear();
  return result;
}

function createStopWaiter(signalAtStart: number): { promise: Promise<ActionResult>; dispose(): void } {
  if (stopRequested || stopSignalId !== signalAtStart) {
    return {
      promise: Promise.resolve(stoppedResult()),
      dispose: () => undefined,
    };
  }
  let waiter: ((result: ActionResult) => void) | null = null;
  const promise = new Promise<ActionResult>((resolve) => {
    waiter = (result: ActionResult) => {
      if (!waiter) {
        return;
      }
      stopWaiters.delete(waiter);
      waiter = null;
      resolve(result);
    };
    stopWaiters.add(waiter);
  });
  return {
    promise,
    dispose: () => {
      if (waiter) {
        stopWaiters.delete(waiter);
        waiter = null;
      }
    },
  };
}

function stoppedResult(): ActionResult {
  return {
    ok: false,
    message: '自动执行已暂停',
    code: AUTOMATION_STOP_CODE,
  };
}

class AutomationStopError extends Error {
  constructor() {
    super('自动执行已暂停');
    this.name = 'AutomationStopError';
  }
}

function assertAutomationNotStopped(): void {
  if (stopRequested) {
    throw new AutomationStopError();
  }
}

function isAutomationStopError(error: unknown): error is AutomationStopError {
  return error instanceof AutomationStopError;
}

async function interruptibleDelay(ms: number): Promise<void> {
  const stopWait = createStopWaiter(stopSignalId);
  try {
    await Promise.race([
      delay(ms),
      stopWait.promise.then(() => undefined),
    ]);
    assertAutomationNotStopped();
  } finally {
    stopWait.dispose();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  }
}

export async function runAutomationFrom(stepId?: AutomationStepId): Promise<ActionResult> {
  if (autoRunActive) {
    return { ok: false, message: '自动化流程正在运行' };
  }
  autoRunActive = true;
  stopRequested = false;

  const initialState = await loadAutomationState();
  const explicitStartStep = Boolean(stepId);
  let currentId: AutomationStepId | '' = resolveAutomationStartStep(initialState, stepId);
  const allowBatch = !explicitStartStep && initialState.settings.emailSelectionMode !== 'specified';
  const batchLimit = allowBatch ? normalizeBatchAccountLimit(initialState.settings.batchAccountLimit) : 1;
  let completedAccounts = 0;
  await setAutomationRunning(true, false);
  await appendAutomationLog('info', `自动执行开始：${stepTitle(currentId)}`, currentId);
  await appendAutomationDebugLog(currentId, 'flow-start', {
    requestedStepId: stepId || '',
    resolvedStepId: currentId,
    batchLimit,
    allowBatch,
  });

  try {
    while (currentId && completedAccounts < batchLimit) {
      const result = await runAutomationFlow(currentId);
      if (!result.ok || !result.completed) {
        return { ok: result.ok, message: result.message, code: result.code, url: result.url, data: result.data };
      }

      completedAccounts += 1;
      if (completedAccounts >= batchLimit) {
        break;
      }

      const latest = await loadAutomationState();
      if (!hasNextBatchEmail(latest)) {
        break;
      }

      await appendAutomationLog('info', `准备执行下一个邮箱：${completedAccounts + 1}/${batchLimit}`, AUTOMATION_START_STEP);
      await interruptibleDelay(BATCH_NEXT_ACCOUNT_DELAY_MS);
      await resetAutomationProgress();
      await updateAutomationRun({
        currentStepId: AUTOMATION_START_STEP,
        selectedEmailId: '',
        selectedSmsId: '',
        checkoutUrl: '',
        sessionEmail: '',
      });
      await setAutomationRunning(true, false);
      currentId = AUTOMATION_START_STEP;
    }

    const message = allowBatch
      ? `自动执行完成：已完成 ${completedAccounts} 个账号`
      : '自动执行完成';
    await resetAutomationProgress();
    await appendAutomationLog('success', message);
    return { ok: true, message };
  } finally {
    autoRunActive = false;
  }
}

export async function runAutomationForEmail(emailId: string): Promise<ActionResult> {
  if (autoRunActive) {
    return { ok: false, message: '自动化流程正在运行' };
  }
  const state = await loadAutomationState();
  const email = state.emails.find((item) => item.id === emailId);
  if (!email) {
    return { ok: false, message: '邮箱不存在，请先刷新或保存邮箱池' };
  }
  await saveAutomationSettings({
    emailSelectionMode: 'specified',
    specifiedEmailId: email.id,
    batchAccountLimit: 1,
  });
  await resetAutomationProgress();
  await appendAutomationLog('info', `准备执行指定邮箱：${email.email}`, AUTOMATION_START_STEP);
  return runAutomationFrom(AUTOMATION_START_STEP);
}

interface AutomationFlowResult extends ActionResult {
  completed: boolean;
}

async function runAutomationFlow(startStepId: AutomationStepId): Promise<AutomationFlowResult> {
  let currentId: AutomationStepId | '' = startStepId;
  while (currentId) {
    if (stopRequested) {
      await setAutomationRunning(false, true);
      await appendAutomationLog('warn', '自动执行已暂停', currentId);
      return { ok: false, completed: false, message: '自动执行已暂停' };
    }

    const result = await runAutomationStep(currentId);
    if (result.code === AUTOMATION_STOP_CODE || stopRequested) {
      await setAutomationRunning(false, true);
      return { ...result, ok: false, completed: false, message: result.message || '自动执行已暂停' };
    }
    const latest = await loadAutomationState();
    if (!result.ok && isSmsNumberRejectedStep(currentId) && isPhoneNumberRejectedFailure(result)) {
      const disabled = await markSelectedSmsDisabled(result.message);
      const latestAfterDisable = await loadAutomationState();
      if (!availableSmsTargets(latestAfterDisable).length) {
        const message = disabled
          ? `接码号码不可用：${disabled.phone}；号码池没有其他可用号码，任务已暂停`
          : `接码号码不可用；号码池没有其他可用号码，任务已暂停：${result.message}`;
        await appendAutomationLog('error', message, currentId);
        await setAutomationRunning(false, true);
        return { ...result, ok: false, completed: false, message };
      }

      await appendAutomationLog(
        'warn',
        disabled
          ? `接码号码不可用，已禁用 ${disabled.phone}，切换号码后重试`
          : `接码号码不可用，切换号码后重试：${result.message}`,
        currentId,
      );
      await resetAutomationFromStep('select-sms');
      await updateAutomationRun({ selectedSmsId: '' });
      currentId = 'select-sms';
      await setAutomationRunning(true, false);
      continue;
    }
    const accountUnavailable = !result.ok ? await handleAccountUnavailableResult(currentId, result) : null;
    if (accountUnavailable) {
      if (accountUnavailable.paused) {
        await setAutomationRunning(false, true);
        return { ...accountUnavailable.result, completed: false };
      }
      await setAutomationRunning(true, false);
      currentId = AUTOMATION_START_STEP;
      continue;
    }
    if (!result.ok && latest.settings.stopOnError) {
      if (currentId === 'wait-payment-sms' && isRetryablePaypalProfileFailure(result)) {
        await appendAutomationLog('warn', 'PayPal 返回资料不可用，回到第 13 步重新填写支付资料', currentId);
        await resetAutomationFromStep(PAYMENT_PROFILE_STEP);
        currentId = PAYMENT_PROFILE_STEP;
        await setAutomationRunning(true, false);
        continue;
      }
      await setAutomationRunning(false, false);
      await markSelectedEmailError(result.message);
      return { ...result, completed: false };
    }
    currentId = nextVisibleAutomationStepId(currentId, latest.settings.oauthExtractMode);
    await updateAutomationRun({ currentStepId: currentId });
  }

  await markSelectedEmailUsed('流程完成');
  return { ok: true, completed: true, message: '当前账号自动执行完成' };
}

async function handleAccountUnavailableResult(
  stepId: AutomationStepId,
  result: ActionResult,
): Promise<{ result: ActionResult; paused: boolean } | null> {
  const accountUnavailableLabel = accountUnavailableFailureLabel(stepId, result);
  if (!accountUnavailableLabel) {
    return null;
  }

  await markSelectedEmailError(result.message);
  const cleanup = await triggerAutomationCookieCleanupOnly();
  await appendAutomationLog(
    cleanup.ok ? 'warn' : 'error',
    cleanup.ok
      ? `${accountUnavailableLabel}，已标记失败并清理 Cookie：${result.message}；${cleanup.message}`
      : `${accountUnavailableLabel}，已标记失败；Cookie 清理失败：${cleanup.message}；原始错误：${result.message}`,
    stepId,
  );

  await resetAutomationProgress();
  await clearAutomationTargetTab();
  const latestAfterReset = await loadAutomationState();
  if (!hasNextBatchEmail(latestAfterReset)) {
    const message = `${accountUnavailableLabel}且没有下一个可用邮箱，任务已暂停：${result.message}`;
    await appendAutomationLog('error', message, stepId);
    return {
      result: { ...result, ok: false, message },
      paused: true,
    };
  }

  await updateAutomationRun({
    currentStepId: AUTOMATION_START_STEP,
    selectedEmailId: '',
    selectedSmsId: '',
    checkoutUrl: '',
    sessionEmail: '',
  });
  await appendAutomationLog('info', '已切换到下一个邮箱，重新从第 1 步开始', AUTOMATION_START_STEP);
  return {
    result: {
      ...result,
      ok: false,
      message: `${accountUnavailableLabel}，已切换到下一个邮箱重新执行：${result.message}`,
    },
    paused: false,
  };
}

export async function stopAutomationRun(): Promise<ActionResult> {
  requestAutomationStop();
  void withTimeout(stopOutlookOtp(), STOP_SIDE_EFFECT_TIMEOUT_MS, '停止 Outlook 验证码接收超时')
    .catch((error) => appendAutomationLog('warn', `停止 Outlook 验证码接收失败：${error instanceof Error ? error.message : String(error)}`));
  void withTimeout(cancelOAuthPhoneVerification(), STOP_SIDE_EFFECT_TIMEOUT_MS, '停止 OAuth 手机接码超时')
    .catch((error) => appendAutomationLog('warn', `停止 OAuth 手机接码失败：${error instanceof Error ? error.message : String(error)}`));
  await setAutomationRunning(false, true);
  await appendAutomationLog('warn', '已发送停止指令');
  return { ok: true, message: '已停止自动化流程' };
}

export async function resetAutomationRun(): Promise<ActionResult> {
  requestAutomationStop();
  await resetAutomationProgress();
  await appendAutomationLog('info', '流程状态已重置');
  return { ok: true, message: '流程状态已重置' };
}

export async function runPaymentStageFromSession(): Promise<ActionResult> {
  return runAutomationStageFrom(PAYMENT_STAGE_START_STEP, '支付阶段');
}

export async function runAutomationStageFrom(
  startStepId: AutomationStepId,
  stageLabel = '当前阶段',
): Promise<ActionResult> {
  requestAutomationStop();
  await resetAutomationFromStep(startStepId);
  await clearAutomationTargetTab();
  await appendAutomationLog('info', `${stageLabel}状态已重置，从第 ${stepNumber(startStepId)} 步开始执行`, startStepId);
  stopRequested = false;
  return runAutomationFrom(startStepId);
}

function oauthStepContext() {
  return {
    ensureSelectedEmail,
    automationTargetTabId,
    bindAutomationTargetTab,
    waitForAutomationTabUrl,
    waitForAutomationTabComplete,
    isRegisterUrl,
    isStopRequested: () => stopRequested,
  };
}

function emailOtpStepContext() {
  return {
    automationTargetTabId,
    waitForAutomationTabUrl,
    isStopRequested: () => stopRequested,
  };
}

function checkoutStepContext() {
  return {
    bindAutomationTargetTab,
    waitForAutomationTabUrl,
    waitForAutomationTabComplete,
    waitForChatGptHomeReady,
    waitForPaymentPageReady,
    isStopRequested: () => stopRequested,
  };
}

function profileStepContext() {
  return {
    automationTargetTabId,
    waitForAutomationTabUrl,
    waitForAutomationTabComplete,
    isStopRequested: () => stopRequested,
  };
}

function paymentReadyContext() {
  return {
    automationTargetTabId,
    getAutomationTargetTab,
    appendAutomationDebugLog,
    isStopRequested: () => stopRequested,
  };
}

function waitForPaymentPageReady(
  kind: 'openai-checkout' | 'paypal-account-entry' | 'paypal-email' | 'paypal-profile',
  timeoutMs: number,
): Promise<ActionResult> {
  return waitForPaymentPageReadyModule(paymentReadyContext(), kind, timeoutMs);
}

function waitForPaypalAfterAccountEntry(timeoutMs: number): Promise<ActionResult> {
  return waitForPaypalAfterAccountEntryModule(paymentReadyContext(), timeoutMs);
}

function waitForPaypalEmailReadyOrClickEntry(timeoutMs: number): Promise<ActionResult> {
  return waitForPaypalEmailReadyOrClickEntryModule(paymentReadyContext(), timeoutMs);
}

function paymentSmsStepContext() {
  return {
    automationTargetTabId,
    ensureAutomationTargetTab,
    appendAutomationDebugLog,
    isStopRequested: () => stopRequested,
  };
}

async function executeStep(stepId: AutomationStepId): Promise<ActionResult> {
  switch (stepId) {
    case 'cleanup-environment':
      return cleanupEnvironmentStep();
    case 'select-email':
      return selectEmailStep();
    case 'open-register':
      return openRegisterStep();
    case 'fill-register-email':
      return fillRegisterEmailStep();
    case 'wait-register-email-code':
      return waitOutlookCodeStepModule(emailOtpStepContext());
    case 'fill-profile':
      return fillProfileStepModule(profileStepContext());
    case 'read-chatgpt-session':
      return readSessionStepModule(checkoutStepContext());
    case 'create-checkout-link':
      return createCheckoutLinkStepModule(checkoutStepContext());
    case 'open-checkout-link':
      return openCheckoutLinkStepModule(checkoutStepContext());
    case 'select-sms':
      return selectSmsStep();
    case 'submit-openai-checkout':
      return submitOpenAiCheckoutStep();
    case 'open-paypal-account':
      return openPaypalAccountStep();
    case 'fill-paypal-email':
      return fillPaypalEmailStep();
    case 'fill-payment-profile':
      return fillPaymentProfileStep();
    case 'wait-payment-sms':
      return waitPaymentSmsStepModule(paymentSmsStepContext());
    case 'create-oauth-session':
      return createOAuthSessionStepModule(oauthStepContext());
    case 'fill-oauth-email':
      return fillOAuthEmailStepModule(oauthStepContext());
    case 'wait-oauth-email-code':
      return waitOAuthEmailCodeStepModule(oauthStepContext());
    case 'export-oauth-files':
      return exportOAuthFilesStepModule(oauthStepContext());
    case 'generate-direct-files':
      return generateDirectFilesStepModule(oauthStepContext());
    default:
      return { ok: false, message: '未知自动化步骤' };
  }
}

async function selectEmailStep(): Promise<ActionResult> {
  const state = await loadAutomationState();
  const selected = selectEmail(state);
  if (!selected) {
    return { ok: false, message: '没有可用邮箱，请先在自动化设置页添加邮箱' };
  }

  const emails = state.emails.map((email) => email.id === selected.id
    ? {
        ...email,
        status: 'running' as const,
        useCount: email.useCount + 1,
        lastUsedAt: Date.now(),
        lastMessage: '当前流程正在使用',
      }
    : email);
  await updateAutomationEmails(emails);
  await saveRegisterState({
    rawInput: selected.rawInput,
    email: selected.email,
    accountLine: selected.rawInput.includes('----') ? selected.rawInput : '',
    inputMode: selected.rawInput.includes('----') ? 'outlook-line' : 'email',
    autoOtp: selected.rawInput.includes('----'),
    otpRequestedAt: 0,
    otpAutoPending: false,
    otpAutoRunning: false,
    otpJobId: '',
    otpLastMessage: '',
  });
  await updateAutomationRun({
    selectedEmailId: selected.id,
    sessionEmail: selected.email,
  });
  return { ok: true, message: `已选择邮箱：${selected.email}` };
}

async function openRegisterStep(): Promise<ActionResult> {
  const tab = await browser.tabs.create({ url: CHATGPT_REGISTER_URL, active: true });
  await bindAutomationTargetTab(tab, '打开 ChatGPT 注册页');
  await waitForAutomationTabUrl((url) => isRegisterUrl(url), 12_000);
  return { ok: true, message: '已打开 ChatGPT 注册页' };
}

async function fillRegisterEmailStep(): Promise<ActionResult> {
  const email = await ensureSelectedEmail();
  const tabId = await automationTargetTabId();
  const url = await waitForAutomationTabUrl((currentUrl) => isRegisterUrl(currentUrl), 20_000);
  await appendAutomationLog('info', `填邮箱准备：${email.email} @ ${shortUrl(url.href)}`, 'fill-register-email');
  const result = await fillRegisterEmailFromCurrentInput(tabId);
  const debug = summarizeActionData(result.data);
  if (debug) {
    await appendAutomationLog(result.ok ? 'info' : 'warn', `填邮箱诊断：${debug}`, 'fill-register-email');
  }
  return result;
}

async function selectSmsStep(): Promise<ActionResult> {
  const state = await loadAutomationState();
  const selected = selectSmsTarget(state);
  if (!selected) {
    const disabledCount = state.smsTargets.filter((target) => target.disabled).length;
    if (disabledCount > 0) {
      return { ok: false, message: `没有可用接码链接，号码池已有 ${disabledCount} 个号码被标记不可用，请补充号码后继续` };
    }
    return { ok: false, message: '没有可用接码链接，请先在自动化设置页添加接码信息' };
  }
  const now = Date.now();
  const smsTargets = state.smsTargets.map((target) => target.id === selected.id
    ? {
        ...target,
        useCount: target.useCount + 1,
        lastUsedAt: now,
        lastMessage: '当前流程正在使用',
      }
    : target);
  await updateAutomationSmsTargets(smsTargets);
  await saveSmsRelayState({ rawInput: selected.rawInput });
  await updateAutomationRun({ selectedSmsId: selected.id });
  return { ok: true, message: `已选择接码号码：${selected.phone}` };
}

async function submitOpenAiCheckoutStep(): Promise<ActionResult> {
  const tabId = await automationTargetTabId();
  await waitForAutomationTabUrl((url) => isOpenAiCheckoutUrl(url), 60_000);
  await waitForAutomationTabComplete(PAYMENT_PAGE_LOAD_TIMEOUT_MS);

  const ready = await waitForPaymentPageReady('openai-checkout', 45_000);
  if (!ready.ok) {
    return ready;
  }
  await appendAutomationLog('info', `OpenAI 订阅页准备提交：${summarizeActionData(ready.data)}`, 'submit-openai-checkout');

  let lastResult: ActionResult = { ok: false, message: '尚未提交 OpenAI 订阅页' };
  for (let attempt = 1; attempt <= PAYMENT_PROFILE_ATTEMPTS; attempt += 1) {
    if (stopRequested) {
      return { ok: false, message: '提交 OpenAI 订阅页已停止' };
    }

    const address = await fetchPaymentAddress();
    if (!address.ok || !address.address) {
      return { ok: false, message: address.message || '获取随机地址失败' };
    }

    const result = await submitCurrentOpenAiCheckout(address.address, tabId);
    lastResult = result;
    await appendAutomationLog(
      result.ok ? 'info' : 'warn',
      `OpenAI 订阅提交尝试 ${attempt}/${PAYMENT_PROFILE_ATTEMPTS}：${address.address.city} ${address.address.postalCode}；${result.message}`,
      'submit-openai-checkout',
    );

    if (!result.ok) {
      if (isRetryableOpenAiCheckoutAddressFailure(result) && attempt < PAYMENT_PROFILE_ATTEMPTS) {
        await appendAutomationLog(
          'warn',
          `OpenAI 支付页暂不可提交，${Math.round(PAYMENT_PROFILE_RETRY_DELAY_MS / 1000)} 秒后重试 ${attempt + 1}/${PAYMENT_PROFILE_ATTEMPTS}`,
          'submit-openai-checkout',
        );
        await interruptibleDelay(PAYMENT_PROFILE_RETRY_DELAY_MS);
        continue;
      }
      return result;
    }

    try {
      const paypalUrl = await waitForAutomationTabUrl((url) => isPaypalCheckoutFlowUrl(url), PAYPAL_STEP_TIMEOUT_MS);
      return { ok: true, message: `${result.message}；已进入 PayPal：${shortUrl(paypalUrl.href)}`, data: result.data };
    } catch (error) {
      lastResult = { ok: false, message: error instanceof Error ? error.message : String(error), data: result.data };
      throw error;
    }
  }

  return {
    ...lastResult,
    ok: false,
    message: `OpenAI 订阅页重试 ${PAYMENT_PROFILE_ATTEMPTS} 次后仍失败：${lastResult.message}`,
  };
}

async function openPaypalAccountStep(): Promise<ActionResult> {
  const tabId = await automationTargetTabId();
  await waitForAutomationTabUrl((url) => isPaypalCheckoutFlowUrl(url), PAYPAL_STEP_TIMEOUT_MS);
  await waitForAutomationTabComplete(PAYMENT_PAGE_LOAD_TIMEOUT_MS);
  const ready = await waitForPaymentPageReady('paypal-account-entry', PAYPAL_STEP_TIMEOUT_MS);
  if (!ready.ok) {
    return ready;
  }
  await appendAutomationLog('info', `PayPal 创建账户入口：${summarizeActionData(ready.data)}`, 'open-paypal-account');
  const result = await openCurrentPaypalAccountEntry(tabId);
  if (!result.ok) {
    return result;
  }

  const nextReady = await waitForPaypalAfterAccountEntry(PAYPAL_STEP_TIMEOUT_MS);
  return {
    ok: nextReady.ok,
    message: nextReady.ok ? `${result.message}；${nextReady.message}` : nextReady.message,
    data: nextReady.data || result.data,
  };
}

async function fillPaypalEmailStep(): Promise<ActionResult> {
  const tabId = await automationTargetTabId();
  await waitForAutomationTabUrl((url) => isPaypalCheckoutFlowUrl(url), PAYPAL_STEP_TIMEOUT_MS);
  await waitForAutomationTabComplete(PAYMENT_PAGE_LOAD_TIMEOUT_MS);
  const ready = await waitForPaypalEmailReadyOrClickEntry(PAYPAL_STEP_TIMEOUT_MS);
  if (!ready.ok) {
    return ready;
  }
  await appendAutomationLog('info', `PayPal 邮箱页：${summarizeActionData(ready.data)}`, 'fill-paypal-email');
  const result = await fillCurrentPaypalCheckoutEmail(tabId);
  if (!result.ok) {
    return result;
  }

  const nextReady = await waitForPaymentPageReady('paypal-profile', PAYPAL_STEP_TIMEOUT_MS);
  return {
    ok: nextReady.ok,
    message: nextReady.ok ? `${result.message}；${nextReady.message}` : nextReady.message,
    data: nextReady.data || result.data,
  };
}

async function fillPaymentProfileStep(): Promise<ActionResult> {
  const tabId = await automationTargetTabId();
  await waitForAutomationTabUrl((url) => isPaypalSignupUrl(url), PAYPAL_STEP_TIMEOUT_MS);
  await waitForAutomationTabComplete(PAYMENT_PAGE_LOAD_TIMEOUT_MS);
  const ready = await waitForPaymentPageReady('paypal-profile', PAYPAL_STEP_TIMEOUT_MS);
  if (!ready.ok) {
    return ready;
  }
  await appendAutomationLog('info', `PayPal 支付资料页：${summarizeActionData(ready.data)}`, 'fill-payment-profile');
  const state = await loadAutomationState();
  const sms = state.run.selectedSmsId
    ? state.smsTargets.find((target) => target.id === state.run.selectedSmsId) || null
    : null;
  if (state.run.selectedSmsId) {
    if (sms) {
      await saveSmsRelayState({ rawInput: sms.rawInput });
    }
  }
  if (!sms) {
    return { ok: false, message: '没有当前接码号码，请先执行“选择接码号码”' };
  }

  let address = await fetchPaymentAddress(sms.phone);
  if (!address.ok || !address.address) {
    return { ok: false, message: address.message || '获取随机地址失败' };
  }

  let lastResult: ActionResult = { ok: false, message: '尚未尝试填写支付资料' };
  for (let attempt = 1; attempt <= PAYMENT_PROFILE_ATTEMPTS; attempt += 1) {
    if (stopRequested) {
      return { ok: false, message: '填写支付资料已停止' };
    }

    if (attempt > 1 && shouldRefreshPaymentAddress(lastResult)) {
      address = await fetchPaymentAddress(sms.phone);
      if (!address.ok || !address.address) {
        return { ok: false, message: address.message || '重新获取随机地址失败' };
      }
    }

    const result = await fillCurrentPaymentPageWithAddress(address.address, tabId);
    lastResult = result;
    await appendAutomationDebugLog('fill-payment-profile', 'payment-profile-attempt', {
      attempt,
      maxAttempts: PAYMENT_PROFILE_ATTEMPTS,
      phone: sms.phone,
      address: {
        city: address.address.city,
        state: address.address.state,
        postalCode: address.address.postalCode,
        countryCode: address.address.countryCode,
      },
      result,
    });
    await appendAutomationLog(
      result.ok ? 'info' : 'warn',
      `支付资料尝试 ${attempt}/${PAYMENT_PROFILE_ATTEMPTS}：${address.address.city} ${address.address.postalCode}，手机号 ${sms.phone}；${result.message}`,
      'fill-payment-profile',
    );

    if (isPhoneNumberRejectedFailure(result)) {
      return {
        ...result,
        ok: false,
        message: result.message,
        data: {
          ...(isRecord(result.data) ? result.data : {}),
          phoneNumberRejected: true,
          smsId: sms.id,
          phone: sms.phone,
        },
      };
    }

    if (isPaymentProfileComplete(result)) {
      return {
        ok: true,
        message: `${address.message}；手机号 ${sms.phone}；${result.message}`,
      };
    }

    if (!shouldRetryPaymentProfile(result) || attempt >= PAYMENT_PROFILE_ATTEMPTS) {
      return {
        ...result,
        ok: false,
        message: result.ok
          ? `支付资料未完成：${result.message}`
        : result.message,
      };
    }

    if ((result as PaymentProfileResult).countryChanged === true) {
      const readyAgain = await waitForPaymentPageReady('paypal-profile', PAYMENT_PAGE_LOAD_TIMEOUT_MS);
      if (!readyAgain.ok) {
        return readyAgain;
      }
      await appendAutomationLog('info', `PayPal 国家切换后页面已就绪：${summarizeActionData(readyAgain.data)}`, 'fill-payment-profile');
    }
    await interruptibleDelay(PAYMENT_PROFILE_RETRY_DELAY_MS);
  }

  return lastResult;
}

async function cleanupEnvironmentStep(): Promise<ActionResult> {
  return triggerStartCleanup();
}

async function triggerStartCleanup(): Promise<{ ok: boolean; message: string }> {
  try {
    const [state, targetTab] = await Promise.all([loadAutomationState(), getAutomationTargetTab()]);
    const windowId = targetTab?.windowId || (state.run.targetWindowId > 0 ? state.run.targetWindowId : undefined);
    const response = await browser.runtime.sendMessage({
      type: 'opx:automation-finish-cleanup',
      cookieTargets: ['paypal', 'chatgpt'],
      closeTabs: true,
      windowId,
      closeDelayMs: 0,
    }) as AutomationFinishCleanupResponse;
    if (!response?.message) {
      return { ok: false, message: '开始前清理已触发，但没有返回状态' };
    }
    if (response.ok && response.closeTabsScheduled) {
      await interruptibleDelay(900);
    }
    return {
      ok: Boolean(response.ok),
      message: response.ok ? `开始前${response.message}` : `开始前清理部分失败：${response.message}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `开始前清理触发失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function triggerAutomationCookieCleanupOnly(cookieTargets: CookieClearTarget[] = ['paypal', 'chatgpt']): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'opx:automation-finish-cleanup',
      cookieTargets,
      closeTabs: false,
    }) as AutomationFinishCleanupResponse;
    if (!response?.message) {
      return { ok: false, message: 'Cookie 清理没有返回状态' };
    }
    return {
      ok: Boolean(response.ok),
      message: response.ok ? response.message : `Cookie 清理部分失败：${response.message}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Cookie 清理触发失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function waitForAutomationTabUrl(predicate: (url: URL) => boolean, timeoutMs: number): Promise<URL> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  while (Date.now() <= deadline) {
    assertAutomationNotStopped();
    const tab = await ensureAutomationTargetTab();
    lastUrl = tab?.url || '';
    const parsed = parseUrl(tab?.url || '');
    if (parsed && predicate(parsed)) {
      await appendAutomationDebugLog('', 'url-wait-match', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        url: parsed.href,
      });
      return parsed;
    }
    await interruptibleDelay(450);
  }
  await appendAutomationDebugLog('', 'url-wait-timeout', {
    timeoutMs,
    lastUrl,
  });
  throw new Error(`等待目标页面加载超时，最后页面：${lastUrl ? shortUrl(lastUrl) : '未知'}`);
}

async function waitForChatGptHomeReady(timeoutMs: number): Promise<ActionResult> {
  const startedAt = Date.now();
  const url = await waitForAutomationTabUrl((currentUrl) => isChatGptHomeUrl(currentUrl), timeoutMs);
  const load = await waitForAutomationTabComplete(CHATGPT_HOME_LOAD_TIMEOUT_MS);
  if (!load.ok) {
    return {
      ok: false,
      message: `已跳转到 ChatGPT 首页，但页面加载未完成：${load.message}`,
      data: {
        url: url.href,
        tabStatus: actionDataStatus(load.data),
        navigationMs: Date.now() - startedAt,
        loadMessage: load.message,
      },
    };
  }
  return {
    ok: true,
    message: `ChatGPT 首页已就绪：${shortUrl(url.href)}`,
    data: {
      url: url.href,
      tabStatus: actionDataStatus(load.data),
      navigationMs: Date.now() - startedAt,
      loadMessage: load.message,
    },
  };
}

async function waitForAutomationTabComplete(timeoutMs: number): Promise<ActionResult> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  while (Date.now() <= deadline) {
    assertAutomationNotStopped();
    const tab = await ensureAutomationTargetTab();
    lastStatus = tab?.status || '';
    if (!lastStatus) {
      return { ok: true, message: '浏览器未返回加载状态', data: { status: lastStatus } };
    }
    if (lastStatus === 'complete') {
      await appendAutomationDebugLog('', 'tab-complete', {
        elapsedMs: Date.now() - (deadline - timeoutMs),
        status: lastStatus,
      });
      return { ok: true, message: '页面加载完成', data: { status: lastStatus } };
    }
    await interruptibleDelay(250);
  }

  await appendAutomationDebugLog('', 'tab-complete-timeout', {
    timeoutMs,
    status: lastStatus,
  });
  return {
    ok: false,
    message: `等待页面加载完成超时，最后状态：${lastStatus || '未知'}`,
    data: { status: lastStatus },
  };
}

async function fetchPaymentAddress(phone?: string): Promise<{ ok: boolean; message: string; address?: AddressProfile }> {
  const response = await fetchRandomAddressFromSettings();
  if (!response.ok || !response.address) {
    return response;
  }
  if (!phone) {
    return response;
  }
  return {
    ...response,
    address: {
      ...response.address,
      phone,
    },
  };
}


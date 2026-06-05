import type { AutomationRunState } from '../automation/types';
import { createOAuthPhoneProvider } from '../oauth-phone/providers';
import { countryIdToIso } from '../oauth-phone/country-map';
import {
  fetchOAuthPhoneOfferMatrixFromSettings,
  selectOAuthPhoneOfferForRuntimeFromSettings,
  testOAuthPhoneProviderWithSettings,
} from '../oauth-phone/service';
import type {
  OAuthPhoneApiTarget,
  OAuthPhoneOrder,
  OAuthPhoneProviderId,
  OAuthPhoneProviderSettings,
  OAuthPhoneSelectedOffer,
  OAuthPhoneSettings,
} from '../oauth-phone/types';
import { fetchSmsRelayCode } from '../sms/poller';
import type { SmsRelayTarget } from '../sms/types';
import {
  loadOAuthPhoneSettings,
  saveOAuthPhoneSettings,
  updateOAuthPhoneTrackedOrder,
  upsertOAuthPhoneOrder,
} from '../oauth-phone/state';

export interface RegisterPhoneSelection {
  id: string;
  source: 'api' | OAuthPhoneProviderId;
  phone: string;
  countryId: string;
  countryIso: string;
  serviceCode: string;
  activationId: string;
  operator: string;
  cost: number;
  timeoutSeconds: number;
  apiTarget?: OAuthPhoneApiTarget;
  provider?: OAuthPhoneProviderSettings;
  offer?: OAuthPhoneSelectedOffer;
  order?: OAuthPhoneOrder;
}

export type RegisterPhoneSmsPollResult =
  | { kind: 'code'; code: string; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string };

export interface RegisterPhoneLogContext {
  log?(message: string, level?: 'info' | 'warn' | 'error'): Promise<void>;
  isStopRequested?(): boolean;
}

export async function fetchRegisterPhoneOfferMatrix() {
  return fetchOAuthPhoneOfferMatrixFromSettings(await loadOAuthPhoneSettings());
}

export async function testRegisterPhoneProvider(providerId: OAuthPhoneProviderId) {
  return testOAuthPhoneProviderWithSettings(await loadOAuthPhoneSettings(), providerId);
}

export async function requestRegisterPhoneNumber(context: RegisterPhoneLogContext = {}): Promise<RegisterPhoneSelection> {
  const settings = await loadOAuthPhoneSettings();
  if (!settings.enabled) {
    throw new Error('OpenAI 手机接码未启用，请先在自动化设置页启用 OAuth 手机接码并保存');
  }
  if (settings.sourceMode === 'api') {
    return requestRegisterPhoneApiTarget(settings);
  }
  return requestRegisterPhoneProviderNumber(settings, context);
}

export async function loadRegisterPhoneSelectionFromRun(run: AutomationRunState): Promise<RegisterPhoneSelection | null> {
  if (!run.selectedRegisterPhoneId || !run.registerPhoneNumber || !run.registerPhoneSource) {
    return null;
  }
  const settings = await loadOAuthPhoneSettings();
  const timeoutSeconds = settings.smsTimeoutSeconds || 120;
  if (run.registerPhoneSource === 'api') {
    const target = settings.apiTargets.find((item) => item.id === run.selectedRegisterPhoneId) || null;
    if (!target) {
      return null;
    }
    return {
      id: target.id,
      source: 'api',
      phone: target.phone,
      countryId: run.registerPhoneCountryId,
      countryIso: run.registerPhoneCountryIso,
      serviceCode: run.registerPhoneServiceCode,
      activationId: '',
      operator: '',
      cost: 0,
      timeoutSeconds,
      apiTarget: target,
    };
  }

  const providerId = normalizeProviderId(run.registerPhoneSource);
  if (!providerId || !run.registerPhoneActivationId) {
    return null;
  }
  const provider = settings.providers.find((item) => item.id === providerId) || null;
  if (!provider) {
    return null;
  }
  const order: OAuthPhoneOrder = {
    providerId,
    activationId: run.registerPhoneActivationId,
    phoneNumber: run.registerPhoneNumber,
    countryId: run.registerPhoneCountryId,
    serviceCode: run.registerPhoneServiceCode,
    cost: run.registerPhoneCost,
    operator: run.registerPhoneOperator,
    status: 'waiting',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    raw: null,
  };
  return {
    id: `${providerId}:${run.registerPhoneActivationId}`,
    source: providerId,
    phone: run.registerPhoneNumber,
    countryId: run.registerPhoneCountryId,
    countryIso: run.registerPhoneCountryIso,
    serviceCode: run.registerPhoneServiceCode,
    activationId: run.registerPhoneActivationId,
    operator: run.registerPhoneOperator,
    cost: run.registerPhoneCost,
    timeoutSeconds,
    provider,
    order,
  };
}

export async function pollRegisterPhoneSms(
  selection: RegisterPhoneSelection,
  context: RegisterPhoneLogContext = {},
): Promise<RegisterPhoneSmsPollResult> {
  if (selection.source === 'api') {
    return pollRegisterPhoneApiSms(selection);
  }
  return pollRegisterPhoneProviderSms(selection, context);
}

export async function waitRegisterPhoneSmsCode(
  selection: RegisterPhoneSelection,
  context: RegisterPhoneLogContext = {},
): Promise<RegisterPhoneSmsPollResult> {
  const timeoutMs = Math.max(15, selection.timeoutSeconds || 120) * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;
  let last: RegisterPhoneSmsPollResult = { kind: 'empty', message: '等待短信验证码中...' };
  while (Date.now() <= deadline) {
    if (context.isStopRequested?.()) {
      return { kind: 'error', message: '接收注册手机验证码已停止' };
    }
    last = await pollRegisterPhoneSms(selection, context);
    if (last.kind === 'code' || last.kind === 'error') {
      return last;
    }
    if (Date.now() - lastLogAt >= 10_000) {
      lastLogAt = Date.now();
      await context.log?.(`注册手机接码：${last.message}`, 'info');
    }
    await delay(5_000);
  }
  if (selection.source !== 'api' && selection.provider && selection.order) {
    const client = createOAuthPhoneProvider(selection.source);
    await client.setStatus(selection.provider, selection.order, 'cancel').catch(() => undefined);
    await updateOAuthPhoneTrackedOrder(selection.source, selection.activationId, {
      status: 'canceled',
      lastCancelAt: Date.now(),
      lastCancelMessage: '等待注册短信超时，已尝试取消号码',
    }).catch(() => undefined);
  }
  return { kind: 'error', message: `等待注册手机验证码超时：${last.message}` };
}

export async function completeRegisterPhoneSelection(
  selection: RegisterPhoneSelection,
  message = '注册手机验证码已提交',
): Promise<void> {
  if (selection.source === 'api') {
    await updateRegisterPhoneApiTarget(selection.id, 'code', message);
    return;
  }
  if (!selection.provider || !selection.order) {
    return;
  }
  const client = createOAuthPhoneProvider(selection.source);
  await client.setStatus(selection.provider, selection.order, 'complete').catch(() => undefined);
  await updateOAuthPhoneTrackedOrder(selection.source, selection.activationId, {
    status: 'completed',
    completedAt: Date.now(),
    lastCancelMessage: message,
  }).catch(() => undefined);
}

export function buildRegisterPhoneRunPatch(selection: RegisterPhoneSelection): Partial<AutomationRunState> {
  return {
    selectedRegisterPhoneId: selection.id,
    registerPhoneSource: selection.source,
    registerPhoneNumber: selection.phone,
    registerPhoneCountryId: selection.countryId,
    registerPhoneCountryIso: selection.countryIso,
    registerPhoneServiceCode: selection.serviceCode,
    registerPhoneActivationId: selection.activationId,
    registerPhoneOperator: selection.operator,
    registerPhoneCost: selection.cost,
    sessionEmail: selection.phone,
  };
}

async function requestRegisterPhoneApiTarget(settings: OAuthPhoneSettings): Promise<RegisterPhoneSelection> {
  const targets = settings.apiTargets.filter((target) => !target.disabled);
  if (!targets.length) {
    throw new Error(settings.apiTargets.length ? 'OpenAI API 接码池没有可用号码' : 'OpenAI API 接码池为空');
  }
  const target = [...targets].sort((left, right) => left.useCount - right.useCount || left.lastUsedAt - right.lastUsedAt)[0];
  const now = Date.now();
  await saveOAuthPhoneSettings({
    apiTargets: settings.apiTargets.map((item) => item.id === target.id
      ? {
          ...item,
          useCount: item.useCount + 1,
          lastUsedAt: now,
          lastMessage: '当前注册流程正在使用',
        }
      : item),
  });
  return {
    id: target.id,
    source: 'api',
    phone: target.phone,
    countryId: '',
    countryIso: countryIdToIso('', '', target.phone),
    serviceCode: '',
    activationId: '',
    operator: '',
    cost: 0,
    timeoutSeconds: settings.smsTimeoutSeconds || 120,
    apiTarget: target,
  };
}

async function requestRegisterPhoneProviderNumber(
  settings: OAuthPhoneSettings,
  context: RegisterPhoneLogContext,
): Promise<RegisterPhoneSelection> {
  const selected = await selectOAuthPhoneOfferForRuntimeFromSettings(settings, '注册手机接码');
  if (!selected.ok || !selected.provider || !selected.offer) {
    throw new Error(selected.message);
  }
  const candidates = selected.candidates?.length
    ? selected.candidates
    : [{ provider: selected.provider, offer: selected.offer }];
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (context.isStopRequested?.()) {
      throw new Error('获取注册手机号已停止');
    }
    const provider = candidate.provider;
    const offer = candidate.offer;
    const client = createOAuthPhoneProvider(provider.id);
    await context.log?.(`注册手机接码：使用 ${client.definition.label} ${offer.countryName || offer.countryId} $${offer.cost} 索号`, 'info');
    try {
      const order = await client.requestNumber(provider, {
        countryId: offer.countryId,
        countryName: offer.countryName,
        serviceCode: offer.serviceCode,
        maxPrice: settings.maxPrice || offer.cost || undefined,
        operator: offer.operator,
        expectedCost: offer.cost,
        debug: (stage, data) => {
          void context.log?.(`注册手机接码：${provider.id}/${stage} ${compactJson(data)}`, 'info');
        },
      });
      const countryIso = provider.id === 'smspool'
        ? countryIdToIso('', offer.countryName, order.phoneNumber)
        : countryIdToIso(order.countryId || offer.countryId, offer.countryName, order.phoneNumber);
      await upsertOAuthPhoneOrder(order, {
        status: 'requested',
        countryName: offer.countryName,
        countryIso,
        timeoutSeconds: settings.smsTimeoutSeconds || 120,
      });
      await client.setStatus(provider, order, 'ready').catch(() => undefined);
      return {
        id: `${provider.id}:${order.activationId}`,
        source: provider.id,
        phone: order.phoneNumber,
        countryId: order.countryId || offer.countryId,
        countryIso,
        serviceCode: order.serviceCode || offer.serviceCode,
        activationId: order.activationId,
        operator: order.operator || offer.operator,
        cost: order.cost || offer.cost,
        timeoutSeconds: settings.smsTimeoutSeconds || 120,
        provider,
        offer,
        order,
      };
    } catch (error) {
      const message = `${provider.id}/${offer.countryName || offer.countryId}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(message);
      await context.log?.(`注册手机接码索号失败：${message}`, 'warn');
    }
  }
  throw new Error(`全部注册手机接码候选索号失败：${errors.slice(0, 6).join('；') || '无可用候选'}`);
}

async function pollRegisterPhoneApiSms(selection: RegisterPhoneSelection): Promise<RegisterPhoneSmsPollResult> {
  if (!selection.apiTarget) {
    return { kind: 'error', message: '注册 API 接码目标不存在' };
  }
  const target: SmsRelayTarget = {
    id: selection.apiTarget.id,
    phone: selection.apiTarget.phone,
    url: selection.apiTarget.url,
  };
  const result = await fetchSmsRelayCode(target);
  if (result.kind === 'code') {
    await updateRegisterPhoneApiTarget(selection.apiTarget.id, 'code', result.message);
    return { kind: 'code', code: result.code, message: result.message };
  }
  await updateRegisterPhoneApiTarget(selection.apiTarget.id, result.kind, result.message);
  return { kind: result.kind === 'error' ? 'error' : 'empty', message: result.message };
}

async function pollRegisterPhoneProviderSms(
  selection: RegisterPhoneSelection,
  context: RegisterPhoneLogContext,
): Promise<RegisterPhoneSmsPollResult> {
  if (!selection.provider || !selection.order || selection.source === 'api') {
    return { kind: 'error', message: '注册接码平台订单不存在' };
  }
  const client = createOAuthPhoneProvider(selection.source);
  const result = await client.getSms(selection.provider, selection.order).catch((error) => ({
    status: 'waiting' as const,
    code: '',
    text: '',
    message: error instanceof Error ? error.message : String(error),
    raw: null,
  }));
  if (result.code) {
    const code = result.code.replace(/\D/g, '').slice(0, 8) || result.code;
    await updateOAuthPhoneTrackedOrder(selection.source, selection.activationId, {
      status: 'received',
      completedAt: Date.now(),
    }).catch(() => undefined);
    return { kind: 'code', code, message: result.message || '已收到注册手机验证码' };
  }
  await updateOAuthPhoneTrackedOrder(selection.source, selection.activationId, {
    status: 'waiting',
    lastCancelMessage: result.message || '等待短信验证码中...',
  }).catch(() => undefined);
  await context.log?.(`注册手机接码：${selection.source} ${result.message || '等待短信'}`, 'info');
  return { kind: 'empty', message: result.message || '等待短信验证码中...' };
}

async function updateRegisterPhoneApiTarget(
  targetId: string,
  status: 'code' | 'empty' | 'error',
  message: string,
): Promise<void> {
  const settings = await loadOAuthPhoneSettings();
  await saveOAuthPhoneSettings({
    apiTargets: settings.apiTargets.map((target) => target.id === targetId
      ? {
          ...target,
          lastCodeAt: status === 'code' ? Date.now() : target.lastCodeAt,
          lastMessage: message,
        }
      : target),
  });
}

function normalizeProviderId(value: string): OAuthPhoneProviderId | '' {
  return value === 'smsbower' || value === 'herosms' || value === 'smspool' || value === 'tigersms' || value === 'foxsms' ? value : '';
}

function compactJson(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

import type { BrowserTabInfo } from '../../app/active-tab';
import { loadAutomationState, saveLinkExtractorState } from '../../app/state';
import type { ActionResult } from '../../app/types';
import { DEFAULT_CHECKOUT_OPTIONS, normalizeCheckoutExtractMode, normalizeCheckoutOptions } from '../link-extractor/checkout';
import { createCheckoutLinkFromCurrentSession, readCurrentChatGptSession } from '../link-extractor/service';
import { updateAutomationRun, appendAutomationLog } from './state';
import {
  delay,
  shortUrl,
  summarizeActionData,
} from './runner-format';
import { isOpenAiCheckoutUrl } from './runner-url';

const CHATGPT_HOME_TIMEOUT_MS = 120_000;
const PAYMENT_PAGE_LOAD_TIMEOUT_MS = 45_000;
const READ_SESSION_ATTEMPTS = 5;
const READ_SESSION_RETRY_DELAY_MS = 3_000;
const CHECKOUT_LINK_ATTEMPTS = 5;
const CHECKOUT_LINK_RETRY_DELAY_MS = 3_000;

type PaymentReadyKind = 'openai-checkout' | 'paypal-account-entry' | 'paypal-email' | 'paypal-profile';

interface CheckoutStepContext {
  bindAutomationTargetTab(tab: BrowserTabInfo | null, reason: string): Promise<number>;
  waitForAutomationTabUrl(predicate: (url: URL) => boolean, timeoutMs: number): Promise<URL>;
  waitForAutomationTabComplete(timeoutMs: number): Promise<ActionResult>;
  waitForChatGptHomeReady(timeoutMs: number): Promise<ActionResult>;
  waitForPaymentPageReady(kind: PaymentReadyKind, timeoutMs: number): Promise<ActionResult>;
  isStopRequested(): boolean;
}

export async function readSessionStep(context: Pick<CheckoutStepContext, 'waitForChatGptHomeReady' | 'isStopRequested'>): Promise<ActionResult> {
  await appendAutomationLog('info', '等待 ChatGPT 首页加载完成后读取 session', 'read-chatgpt-session');
  const home = await context.waitForChatGptHomeReady(CHATGPT_HOME_TIMEOUT_MS);
  if (!home.ok) {
    return home;
  }
  const debug = summarizeActionData(home.data);
  await appendAutomationLog('info', debug ? `${home.message}：${debug}` : home.message, 'read-chatgpt-session');
  let lastResponse: Awaited<ReturnType<typeof readCurrentChatGptSession>> | null = null;
  for (let attempt = 1; attempt <= READ_SESSION_ATTEMPTS; attempt += 1) {
    if (context.isStopRequested()) {
      return { ok: false, message: '读取 Session 已停止' };
    }
    const response = await readCurrentChatGptSession();
    lastResponse = response;
    if (response.ok && response.session?.accessToken) {
      const state = await loadAutomationState();
      const sessionEmail = response.session.email ||
        (state.settings.registrationMode === 'phone' ? state.run.sessionEmail : '');
      await updateAutomationRun({ sessionEmail });
      return {
        ok: true,
        message: attempt > 1
          ? `已读取 ChatGPT session：${sessionEmail || '未知账号'}（第 ${attempt} 次尝试成功）`
          : `已读取 ChatGPT session：${sessionEmail || '未知账号'}`,
      };
    }
    await appendAutomationLog('warn', `读取 Session 尝试 ${attempt}/${READ_SESSION_ATTEMPTS} 失败：${response.message}`, 'read-chatgpt-session');
    if (attempt < READ_SESSION_ATTEMPTS) {
      await delay(READ_SESSION_RETRY_DELAY_MS);
    }
  }
  return {
    ok: false,
    message: `读取 Session 重试 ${READ_SESSION_ATTEMPTS} 次后失败：${lastResponse?.message || '未读取到登录 session'}`,
  };
}

export async function createCheckoutLinkStep(context: Pick<CheckoutStepContext, 'isStopRequested'>): Promise<ActionResult> {
  const state = await loadAutomationState();
  const checkoutOptions = normalizeCheckoutOptions({
    ...DEFAULT_CHECKOUT_OPTIONS,
    ...state.settings.checkoutOptions,
  });
  await saveLinkExtractorState({
    checkoutOptions,
    checkoutExtractMode: normalizeCheckoutExtractMode(state.settings.checkoutExtractMode),
  });
  let lastMessage = '生成订阅链接失败';
  for (let attempt = 1; attempt <= CHECKOUT_LINK_ATTEMPTS; attempt += 1) {
    if (context.isStopRequested()) {
      return { ok: false, message: '生成订阅链接已停止' };
    }
    try {
      const response = await createCheckoutLinkFromCurrentSession();
      const link = response.link || response.url || '';
      if (response.ok && link) {
        await updateAutomationRun({ checkoutUrl: link });
        return {
          ok: true,
          message: attempt > 1
            ? `订阅链接已生成：${shortUrl(link)}（第 ${attempt} 次尝试成功）`
            : `订阅链接已生成：${shortUrl(link)}`,
          url: link,
        };
      }
      lastMessage = response.message || '生成订阅链接失败';
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
    await appendAutomationLog('warn', `生成订阅链接尝试 ${attempt}/${CHECKOUT_LINK_ATTEMPTS} 失败：${lastMessage}`, 'create-checkout-link');
    if (attempt < CHECKOUT_LINK_ATTEMPTS) {
      await delay(CHECKOUT_LINK_RETRY_DELAY_MS);
    }
  }
  return {
    ok: false,
    message: `生成订阅链接重试 ${CHECKOUT_LINK_ATTEMPTS} 次后失败：${lastMessage}`,
  };
}

export async function openCheckoutLinkStep(context: CheckoutStepContext): Promise<ActionResult> {
  const state = await loadAutomationState();
  const url = state.run.checkoutUrl;
  if (!url) {
    return { ok: false, message: '没有可打开的订阅链接，请先执行“提取订阅链接”' };
  }
  if (state.settings.autoOpenCheckout) {
    const tab = await browser.tabs.create({ url, active: true });
    await context.bindAutomationTargetTab(tab, '打开订阅链接');
    await context.waitForAutomationTabUrl((currentUrl) => isOpenAiCheckoutUrl(currentUrl), 30_000);
    await context.waitForAutomationTabComplete(PAYMENT_PAGE_LOAD_TIMEOUT_MS);
    const ready = await context.waitForPaymentPageReady('openai-checkout', 45_000);
    return { ok: ready.ok, message: ready.ok ? '已打开 OpenAI 订阅页' : ready.message, data: ready.data };
  }
  return { ok: true, message: '已生成订阅链接，设置为不自动打开' };
}

const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';
const CONTENT_SCRIPT_URL_PREFIXES = [
  'https://chatgpt.com/',
  'https://auth.openai.com/',
  'https://pay.openai.com/',
  'https://www.paypal.com/',
  'https://paypal.com/',
  'http://localhost:1455/',
  'http://127.0.0.1:1455/',
];

export interface BrowserTabInfo {
  id?: number;
  windowId?: number;
  url?: string;
  status?: string;
}

export async function getActiveBrowserTab(): Promise<BrowserTabInfo | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

export async function getBrowserTab(tabId?: number): Promise<BrowserTabInfo | null> {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId) || tabId <= 0) {
    return getActiveBrowserTab();
  }
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return null;
  }
}

export function isContentScriptUrl(url: string | undefined): boolean {
  return CONTENT_SCRIPT_URL_PREFIXES.some((prefix) => url?.startsWith(prefix));
}

export async function sendActiveTabMessage<T>(message: unknown): Promise<T> {
  return sendTabMessage<T>(message);
}

export async function sendTabMessage<T>(message: unknown, tabId?: number): Promise<T> {
  const tab = await getBrowserTab(tabId);
  if (!tab || typeof tab.id !== 'number') {
    throw new Error(tabId ? '自动化目标标签页不存在或已关闭' : '没有可操作的当前标签页');
  }
  if (!isContentScriptUrl(tab.url)) {
    throw new Error(tabId ? '自动化目标标签页不支持插件页面操作' : '当前标签页不支持插件页面操作');
  }
  await ensureContentScript(tab.id);
  return await browser.tabs.sendMessage(tab.id, message) as T;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch {
    // The script may already be injected, or the page may reject reinjection.
  }
}

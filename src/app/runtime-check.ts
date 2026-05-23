/**
 * Checks if the extension runtime context is still valid.
 * In MV3, when an extension is reloaded/updated/disabled-re-enabled,
 * previously injected content scripts lose their connection to the
 * background service worker. Any call to browser.runtime.sendMessage
 * will throw "Extension context invalidated".
 *
 * This utility detects the situation and provides a user-friendly
 * prompt to refresh the page.
 */

export function isRuntimeValid(): boolean {
  try {
    // In Chrome MV3, browser.runtime.id becomes undefined when context is invalidated
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

export async function sendMessageSafe<T>(message: unknown): Promise<T | null> {
  if (!isRuntimeValid()) {
    throw new ExtensionInvalidatedError();
  }
  try {
    const result = await browser.runtime.sendMessage(message);
    return (result ?? null) as T | null;
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      throw new ExtensionInvalidatedError();
    }
    throw error;
  }
}

export class ExtensionInvalidatedError extends Error {
  constructor() {
    super('扩展已更新或重载，请刷新页面后重试。');
    this.name = 'ExtensionInvalidatedError';
  }
}

function isContextInvalidatedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('extension context invalidated') ||
    msg.includes('extension context was invalidated') ||
    msg.includes('message port closed');
}

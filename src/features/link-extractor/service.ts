import { loadLinkExtractorState, saveLinkExtractorState } from '../../app/state';
import type { CheckoutLinkResponse, ChatGptSessionResponse } from './types';

export async function readCurrentChatGptSession(): Promise<ChatGptSessionResponse> {
  return await browser.runtime.sendMessage({
    type: 'opx:fetch-chatgpt-session',
  });
}

export async function createCheckoutLinkFromCurrentSession(): Promise<CheckoutLinkResponse> {
  const [settings, sessionResponse] = await Promise.all([
    loadLinkExtractorState(),
    readCurrentChatGptSession(),
  ]);

  if (!sessionResponse.ok || !sessionResponse.session?.accessToken) {
    return {
      ok: false,
      message: sessionResponse.message || '没有可用 ChatGPT session',
    };
  }

  const response: CheckoutLinkResponse = await browser.runtime.sendMessage({
    type: 'opx:create-checkout-link',
    raw: sessionResponse.session.accessToken,
    options: settings.checkoutOptions,
    extractMode: settings.checkoutExtractMode,
  });

  const link = response?.link || response?.url || '';
  if (response?.ok && link) {
    await saveLinkExtractorState({ checkoutOptions: settings.checkoutOptions, checkoutExtractMode: settings.checkoutExtractMode });
  }
  return response;
}

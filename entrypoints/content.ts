import { mountAssistant } from '../src/app';
import { initPayOpenAiAddressAutofill } from '../src/features/address-autofill/pay-openai-autofill';
import { initPaypalAutofill } from '../src/features/address-autofill/paypal-autofill';

const CONTENT_LOADED_KEY = '__opx_assistant_content_loaded__';

export default defineContentScript({
  matches: [
    'https://chatgpt.com/*',
    'https://auth.openai.com/*',
    'https://pay.openai.com/*',
    'https://www.paypal.com/*',
    'https://paypal.com/*',
  ],
  runAt: 'document_idle',
  registration: 'manifest',
  main() {
    const scope = globalThis as unknown as Partial<Record<typeof CONTENT_LOADED_KEY, boolean>>;
    if (scope[CONTENT_LOADED_KEY]) {
      return;
    }
    scope[CONTENT_LOADED_KEY] = true;

    mountAssistant();
    try {
      initPayOpenAiAddressAutofill();
    } catch (error) {
      console.warn('[OPX] pay autofill init failed', error);
    }
    try {
      initPaypalAutofill();
    } catch (error) {
      console.warn('[OPX] PayPal autofill init failed', error);
    }
  },
});

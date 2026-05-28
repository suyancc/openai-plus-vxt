import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    incognito: 'split',
    action: {
      default_title: 'OpenAI Plus VXT',
    },
    permissions: ['storage', 'tabs', 'scripting', 'cookies'],
    host_permissions: [
      'http://*/*',
      'https://*/*',
      'http://127.0.0.1:8787/*',
      'http://localhost:8787/*',
      'https://auth.openai.com/*',
      'https://chatgpt.com/*',
      'https://pay.openai.com/*',
      'https://www.paypal.com/*',
      'https://paypal.com/*',
      'https://www.meiguodizhi.com/*',
      'https://api.github.com/*',
      'https://mail-api.yuecheng.shop/*',
      'https://smsbower.page/*',
      'https://hero-sms.com/*',
      'https://api.smspool.net/*',
      'https://smspool.net/*',
      'https://api.tiger-sms.com/*',
    ],
  },
});

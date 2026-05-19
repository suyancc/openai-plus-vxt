import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    permissions: ['storage', 'tabs', 'scripting'],
    host_permissions: [
      'http://127.0.0.1:8787/*',
      'http://localhost:8787/*',
      'https://auth.openai.com/*',
      'https://chatgpt.com/*',
      'https://pay.openai.com/*',
      'https://www.paypal.com/*',
      'https://paypal.com/*',
      'https://www.meiguodizhi.com/*',
      'https://mail-api.yuecheng.shop/*',
    ],
  },
});

export function isRegisterUrl(url: URL): boolean {
  return (url.hostname === 'chatgpt.com' && url.pathname.startsWith('/auth/login')) ||
    (url.hostname === 'auth.openai.com' && url.pathname.startsWith('/log-in'));
}

export function isOAuthLoginUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && normalizePathname(url.pathname) === '/log-in';
}

export function isOAuthLoginPasswordUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/log-in/password');
}

export function isEmailVerificationUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/email-verification');
}

export function isAboutYouUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/about-you');
}

export function isCreateAccountPasskeyEnrollmentUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/create-account-enroll-passkey');
}

export function isAfterEmailVerificationUrl(url: URL): boolean {
  return (
    isAboutYouUrl(url) ||
    isOAuthConsentUrl(url) ||
    isOAuthCallbackUrl(url) ||
    isOAuthAddPhoneUrl(url) ||
    isChatGptHomeUrl(url)
  );
}

export function isPaymentUrl(url: URL): boolean {
  return url.hostname === 'pay.openai.com' || url.hostname.endsWith('paypal.com');
}

export function isOpenAiCheckoutUrl(url: URL): boolean {
  return url.hostname === 'pay.openai.com' && url.pathname.startsWith('/c/pay/cs_');
}

export function isOAuthCallbackUrl(url: URL): boolean {
  return (
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.pathname.startsWith('/auth/callback')
  );
}

export function isOAuthAddPhoneUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/add-phone');
}

export function isOAuthChooseAccountUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/choose-an-account');
}

export function isOAuthConsentUrl(url: URL): boolean {
  return url.hostname === 'auth.openai.com' && url.pathname.startsWith('/sign-in-with-chatgpt/codex/consent');
}

export function isOpenAiCheckoutSucceededUrl(url: URL): boolean {
  return isOpenAiCheckoutUrl(url) && url.searchParams.get('redirect_status') === 'succeeded';
}

export function getFailedOpenAiPaymentRedirect(url: URL): string {
  if (!isOpenAiCheckoutUrl(url)) {
    return '';
  }
  const redirectStatus = url.searchParams.get('redirect_status') || '';
  return redirectStatus && redirectStatus !== 'succeeded' ? redirectStatus : '';
}

export function isChatGptPaymentSuccessUrl(url: URL): boolean {
  return url.hostname === 'chatgpt.com' && url.pathname.startsWith('/payments/success');
}

export function isPaypalCheckoutFlowUrl(url: URL): boolean {
  return url.hostname.endsWith('paypal.com') &&
    (
      url.pathname.replace(/\/+$/, '') === '/pay' ||
      url.pathname.startsWith('/checkoutweb/signup') ||
      url.pathname.startsWith('/signin') ||
      url.pathname.startsWith('/agreements/approve') ||
      url.pathname.startsWith('/pay/billing')
    );
}

export function isPaypalSignupUrl(url: URL): boolean {
  return url.hostname.endsWith('paypal.com') && url.pathname.startsWith('/checkoutweb/signup');
}

export function isChatGptHomeUrl(url: URL): boolean {
  return url.hostname === 'chatgpt.com' && (url.pathname === '/' || url.pathname === '');
}

export function paymentCompletionStage(url: URL): string {
  if (isChatGptHomeUrl(url)) {
    return 'chatgpt-home';
  }
  if (isChatGptPaymentSuccessUrl(url)) {
    return 'chatgpt-success';
  }
  if (isOpenAiCheckoutSucceededUrl(url)) {
    return 'openai-succeeded';
  }
  return '';
}

export function paymentCompletionStageLabel(stage: string): string {
  if (stage === 'openai-succeeded') {
    return 'OpenAI 支付回跳成功';
  }
  if (stage === 'chatgpt-success') {
    return 'ChatGPT 支付成功页';
  }
  if (stage === 'chatgpt-home') {
    return 'ChatGPT 首页已返回';
  }
  return '支付回跳状态';
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

import type {
  AutomationOAuthExtractMode,
  AutomationRegistrationMode,
  AutomationStepDefinition,
  AutomationStepId,
  AutomationStepRecord,
} from './types';

export const AUTOMATION_STEPS: AutomationStepDefinition[] = [
  {
    id: 'cleanup-environment',
    order: 10,
    title: '清除 Cookie',
    description: '开始前清除 PayPal、ChatGPT/OpenAI Cookie，并关闭旧标签页保留一个空白页。',
  },
  {
    id: 'select-email',
    order: 20,
    title: '选择邮箱',
    description: '从邮箱池选择一个未执行账号，或使用设置里指定的邮箱。',
  },
  {
    id: 'open-register',
    order: 30,
    title: '打开注册页',
    description: '打开 ChatGPT 注册入口。',
  },
  {
    id: 'fill-register-email',
    order: 40,
    title: '填写注册邮箱',
    description: '把当前邮箱填入注册页并继续。',
  },
  {
    id: 'wait-register-email-code',
    order: 50,
    title: '接收邮箱验证码',
    description: '通过本地 Outlook 服务等待并提交邮箱验证码。',
  },
  {
    id: 'fill-profile',
    order: 60,
    title: '填写资料',
    description: '填写姓名、年龄并创建账号。',
  },
  {
    id: 'read-chatgpt-session',
    order: 70,
    title: '读取 Session',
    description: '读取 ChatGPT session 和 accessToken。',
  },
  {
    id: 'create-checkout-link',
    order: 80,
    title: '提取订阅链接',
    description: '使用当前 session 生成 Plus/Team 订阅链接。',
  },
  {
    id: 'open-checkout-link',
    order: 90,
    title: '打开订阅链接',
    description: '打开上一步生成的支付链接。',
  },
  {
    id: 'submit-openai-checkout',
    order: 100,
    title: '提交 OpenAI 订阅页',
    description: '在 pay.openai.com 选择 PayPal 并提交 0 元订阅。',
  },
  {
    id: 'open-paypal-account',
    order: 110,
    title: '打开 PayPal 创建账户',
    description: '等待 PayPal pay 入口页出现，并点击创建账户入口。',
  },
  {
    id: 'fill-paypal-email',
    order: 120,
    title: '填写 PayPal 邮箱',
    description: '在 PayPal 创建账户入口填写邮箱并继续。',
  },
  {
    id: 'select-sms',
    order: 130,
    title: '选择接码号码',
    description: '在填写支付资料前选择接码号码，并写入接码 tab 状态。',
  },
  {
    id: 'fill-payment-profile',
    order: 140,
    title: '填写支付资料',
    description: '等待 PayPal 注册支付资料页出现，再获取随机地址并填写。',
  },
  {
    id: 'wait-payment-sms',
    order: 150,
    title: '接收手机验证码',
    description: '轮询当前接码 API，收到验证码后写入历史供支付页使用。',
  },
  {
    id: 'create-oauth-session',
    order: 160,
    title: '生成 OAuth 链接',
    description: '基于当前邮箱生成 OAuth 登录链接并打开。',
  },
  {
    id: 'fill-oauth-email',
    order: 170,
    title: '填写 OAuth 邮箱',
    description: '把当前邮箱填入 OAuth 登录页。',
  },
  {
    id: 'wait-oauth-email-code',
    order: 180,
    title: '接收 OAuth 验证码',
    description: '通过本地 Outlook 服务等待并提交 OAuth 登录验证码。',
  },
  {
    id: 'export-oauth-files',
    order: 190,
    title: '提取 OAuth',
    description: '检查 OAuth 回调结果，必要时从当前 ChatGPT session 直接生成文件。',
  },
  {
    id: 'generate-direct-files',
    order: 200,
    title: '生成文件',
    description: '直接基于当前 ChatGPT session 生成 sub2api、CPA 文件内容。',
  },
];

const PHONE_REGISTRATION_STEP_ORDER: AutomationStepId[] = [
  'cleanup-environment',
  'open-register',
  'select-email',
  'fill-register-email',
  'wait-register-email-code',
  'fill-profile',
  'read-chatgpt-session',
  'create-checkout-link',
  'open-checkout-link',
  'submit-openai-checkout',
  'open-paypal-account',
  'fill-paypal-email',
  'select-sms',
  'fill-payment-profile',
  'wait-payment-sms',
  'generate-direct-files',
];

export function createDefaultStepRecords(): AutomationStepRecord[] {
  return AUTOMATION_STEPS.map((step) => ({
    id: step.id,
    status: 'pending',
    message: '',
    startedAt: 0,
    finishedAt: 0,
  }));
}

export function getStepDefinition(id: AutomationStepId): AutomationStepDefinition {
  return AUTOMATION_STEPS.find((step) => step.id === id) || AUTOMATION_STEPS[0];
}

export function nextAutomationStepId(id: AutomationStepId | ''): AutomationStepId | '' {
  if (!id) {
    return AUTOMATION_STEPS[0]?.id || '';
  }
  const index = AUTOMATION_STEPS.findIndex((step) => step.id === id);
  return index >= 0 ? AUTOMATION_STEPS[index + 1]?.id || '' : '';
}

export function getDisplayStepDefinition(
  step: AutomationStepDefinition,
  registrationMode: AutomationRegistrationMode = 'email',
): AutomationStepDefinition {
  if (registrationMode !== 'phone') {
    return step;
  }
  if (step.id === 'select-email') {
    return {
      ...step,
      title: '获取手机号',
      description: '从 OAuth 手机接码配置中获取一个手机号。',
    };
  }
  if (step.id === 'open-register') {
    return {
      ...step,
      title: '打开手机号注册页',
      description: '打开 ChatGPT 登录页，后续选择“使用电话号码继续”。',
    };
  }
  if (step.id === 'fill-register-email') {
    return {
      ...step,
      title: '填写注册手机号',
      description: '在 ChatGPT 注册入口选择手机号继续，并填写当前手机号。',
    };
  }
  if (step.id === 'wait-register-email-code') {
    return {
      ...step,
      title: '接收手机验证码',
      description: '轮询 OpenAI 手机接码并提交短信验证码。',
    };
  }
  return step;
}

export function visibleAutomationSteps(
  mode: AutomationOAuthExtractMode,
  registrationMode: AutomationRegistrationMode = 'email',
): AutomationStepDefinition[] {
  const display = (steps: AutomationStepDefinition[]) => steps.map((step) => getDisplayStepDefinition(step, registrationMode));
  if (mode === 'direct' || registrationMode === 'phone') {
    const hidden = new Set<AutomationStepId>([
      'create-oauth-session',
      'fill-oauth-email',
      'wait-oauth-email-code',
      'export-oauth-files',
    ]);
    const steps = AUTOMATION_STEPS.filter((step) => !hidden.has(step.id));
    if (registrationMode === 'phone') {
      const byId = new Map(steps.map((step) => [step.id, step]));
      return display(PHONE_REGISTRATION_STEP_ORDER.map((id) => byId.get(id)).filter((step): step is AutomationStepDefinition => Boolean(step)));
    }
    return display(steps);
  }
  return display(AUTOMATION_STEPS.filter((step) => step.id !== 'generate-direct-files'));
}

export function nextVisibleAutomationStepId(
  id: AutomationStepId | '',
  mode: AutomationOAuthExtractMode,
  registrationMode: AutomationRegistrationMode = 'email',
): AutomationStepId | '' {
  const steps = visibleAutomationSteps(mode, registrationMode);
  if (!id) {
    return steps[0]?.id || '';
  }
  const index = steps.findIndex((step) => step.id === id);
  return index >= 0 ? steps[index + 1]?.id || '' : '';
}

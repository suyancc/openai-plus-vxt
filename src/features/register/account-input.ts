import type { ParsedAccountInput } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAccountInput(rawInput: string): ParsedAccountInput {
  const raw = rawInput.trim();
  if (!raw) {
    return invalid('empty', '请输入邮箱或 Outlook 账号行');
  }

  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  if (firstLine.includes('----')) {
    const parts = firstLine.split('----').map((item) => item.trim());
    const email = parts[0] || '';
    if (!EMAIL_RE.test(email)) {
      return invalid('invalid', 'Outlook 行里的邮箱格式不正确');
    }
    if (parts.length < 4 || !parts[2] || !parts[3]) {
      return invalid('invalid', 'Outlook 行需要 email----password----client_id----refresh_token');
    }
    return {
      ok: true,
      mode: 'outlook-line',
      email,
      accountLine: firstLine,
      message: 'Outlook API 自动验证码',
    };
  }

  if (!EMAIL_RE.test(firstLine)) {
    return invalid('invalid', '邮箱格式不正确');
  }

  return {
    ok: true,
    mode: 'email',
    email: firstLine,
    accountLine: '',
    message: '单邮箱模式，验证码手动输入',
  };
}

function invalid(mode: ParsedAccountInput['mode'], message: string): ParsedAccountInput {
  return {
    ok: false,
    mode,
    email: '',
    accountLine: '',
    message,
  };
}

import type { SmsRelayTarget } from './types';

const MAX_CODE_LENGTH = 8;
const MIN_CODE_LENGTH = 4;

export interface ParsedSmsTargets {
  targets: SmsRelayTarget[];
  errors: string[];
}

export function parseSmsRelayTargets(input: string): ParsedSmsTargets {
  const targets: SmsRelayTarget[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, index) => {
    const separatorIndex = line.indexOf('----');
    if (separatorIndex < 0) {
      errors.push(`第 ${index + 1} 行缺少 ---- 分隔符`);
      return;
    }

    const phone = line.slice(0, separatorIndex).trim();
    const url = line.slice(separatorIndex + 4).trim();
    if (!phone || !url) {
      errors.push(`第 ${index + 1} 行号码或 API 链接为空`);
      return;
    }
    if (!isHttpUrl(url)) {
      errors.push(`第 ${index + 1} 行 API 链接不是 http/https 地址`);
      return;
    }

    const key = `${phone}\n${url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    targets.push({
      id: makeTargetId(phone, url),
      phone,
      url,
    });
  });

  return { targets, errors };
}

export function extractSmsCode(message: string): string {
  const trimmed = message.trim();
  if (!trimmed || /^no message$/i.test(trimmed)) {
    return '';
  }

  const matches = trimmed.match(new RegExp(`\\b\\d{${MIN_CODE_LENGTH},${MAX_CODE_LENGTH}}\\b`, 'g'));
  return matches?.[0] || '';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function makeTargetId(phone: string, url: string): string {
  return `${phone}|${url}`;
}

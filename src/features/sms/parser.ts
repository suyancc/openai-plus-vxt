import type { SmsRelayTarget } from './types';

const MAX_CODE_LENGTH = 8;
const MIN_CODE_LENGTH = 4;
const SUCCESS_CODE_FIELD_NAMES = new Set([
  'code',
  'status',
  'statuscode',
  'errno',
  'errorcode',
]);
const MESSAGE_FIELD_NAMES = new Set([
  'data',
  'message',
  'msg',
  'content',
  'text',
  'body',
  'sms',
  'otp',
  'code',
  'verifycode',
  'verificationcode',
  'captcha',
  'result',
  'value',
]);
const IGNORE_FIELD_NAMES = new Set([
  'status',
  'statuscode',
  'httpstatus',
  'ret',
  'errno',
  'errorcode',
  'expireddate',
  'expiredate',
  'expirationdate',
  'codetime',
  'time',
  'timestamp',
]);
const EMPTY_MESSAGE_PATTERN = /^(no\s*message|no\s*sms|empty|none|null|暂无|没有|未收到)$/i;
const GENERIC_STATUS_PATTERN = /^(ok|success|successful|true|请求成功|成功)$/i;
const SMS_CODE_CONTEXT_PATTERN = /paypal|paypaly|验证码|驗證碼|校验码|動態碼|动态码|code|verify|verification|security|otp|one[-\s]?time/i;
const DATE_FIELD_CONTEXT_PATTERN = /(?:到期|过期|有效期|expire|expires|expired|expiration|date|time|时间)\s*[:：]?\s*$/i;
const YEAR_PREFIX_PATTERN = /^(?:19|20)\d{2}$/;

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
  if (!trimmed || EMPTY_MESSAGE_PATTERN.test(trimmed)) {
    return '';
  }

  const best = collectSmsCodeCandidates(trimmed)
    .map((candidate) => ({
      ...candidate,
      score: scoreSmsCodeCandidate(trimmed, candidate),
    }))
    .sort((left, right) => right.score - left.score)[0];
  return best && best.score > 0 ? best.value : '';
}

export function extractSmsPayload(payload: unknown): { code: string; message: string } {
  const structured = extractStructuredSmsPayload(payload);
  if (structured) {
    return structured;
  }

  const candidates = collectMessageCandidates(payload);
  const best = candidates
    .map((candidate) => ({
      ...candidate,
      code: extractSmsCode(candidate.text),
    }))
    .filter((candidate) => candidate.text && !isEmptyMessage(candidate.text) && !isGenericStatusMessage(candidate.text))
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0];

  if (best?.code) {
    return {
      code: best.code,
      message: best.text,
    };
  }

  const fallback = candidates
    .map((candidate) => candidate.text)
    .find((text) => text && !isEmptyMessage(text) && !isGenericStatusMessage(text));
  return {
    code: '',
    message: fallback || '',
  };
}

function extractStructuredSmsPayload(payload: unknown): { code: string; message: string } | null {
  const root = isRecord(payload) && isRecord(payload.raw) ? payload.raw : payload;
  if (!isRecord(root)) {
    return null;
  }

  const apiCode = Number(root.code);
  const apiMessage = String(root.msg || root.message || '').trim();
  const data = root.data;
  if (!isRecord(data)) {
    return null;
  }

  const codeText = String(data.code || '').trim();
  const code = extractSmsCode(codeText);
  const codeTime = String(data.code_time || data.codeTime || '').trim();
  if (apiCode === 1 && code) {
    return {
      code,
      message: [codeText, codeTime ? `时间：${codeTime}` : ''].filter(Boolean).join(' · '),
    };
  }

  if (apiCode === 0) {
    return {
      code: '',
      message: apiMessage || '暂无验证码',
    };
  }

  if (code) {
    return {
      code,
      message: [codeText, codeTime ? `时间：${codeTime}` : ''].filter(Boolean).join(' · '),
    };
  }

  return null;
}

interface MessageCandidate {
  text: string;
  key: string;
  depth: number;
  fromPreferredField: boolean;
}

function collectMessageCandidates(payload: unknown): MessageCandidate[] {
  const candidates: MessageCandidate[] = [];
  const seenObjects = new WeakSet<object>();

  visit(payload, '', 0);
  return candidates;

  function visit(value: unknown, key: string, depth: number): void {
    if (value === null || value === undefined || depth > 6) {
      return;
    }

    if (typeof value === 'string') {
      addCandidate(value, key, depth);
      parseNestedJson(value, key, depth);
      return;
    }

    if (typeof value === 'number') {
      if (isLikelyCodeField(key) && !isSuccessCodeField(key)) {
        addCandidate(String(value), key, depth);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (seenObjects.has(value)) {
      return;
    }
    seenObjects.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, key || String(index), depth + 1));
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      if (isIgnoredField(childKey)) {
        continue;
      }
      visit(childValue, childKey, depth + 1);
    }
  }

  function addCandidate(value: string, key: string, depth: number): void {
    const text = value.trim();
    if (!text || text.length > 600 || isIgnoredField(key)) {
      return;
    }
    candidates.push({
      text,
      key,
      depth,
      fromPreferredField: isPreferredMessageField(key),
    });
  }

  function parseNestedJson(value: string, key: string, depth: number): void {
    const trimmed = value.trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) {
      return;
    }
    try {
      visit(JSON.parse(trimmed), key, depth + 1);
    } catch {
      // Plain SMS text can contain braces; ignore malformed nested JSON.
    }
  }
}

function scoreCandidate(candidate: MessageCandidate & { code: string }): number {
  let score = 0;
  if (candidate.code) {
    score += 100;
  }
  if (candidate.fromPreferredField) {
    score += 30;
  }
  if (hasSmsKeyword(candidate.text)) {
    score += 20;
  }
  if (isLikelyCodeField(candidate.key)) {
    score += 10;
  }
  if (isJsonLikeText(candidate.text)) {
    score -= 8;
  }
  score -= candidate.depth;
  return score;
}

function hasSmsKeyword(value: string): boolean {
  return /code|验证码|驗證碼|verify|verification|security|otp|paypal|paypaly|openai|chatgpt/i.test(value);
}

interface SmsCodeCandidate {
  value: string;
  index: number;
  end: number;
}

function collectSmsCodeCandidates(value: string): SmsCodeCandidate[] {
  const candidates: SmsCodeCandidate[] = [];
  const pattern = new RegExp(`\\d{${MIN_CODE_LENGTH},${MAX_CODE_LENGTH}}`, 'g');
  for (const match of value.matchAll(pattern)) {
    const code = match[0];
    const index = match.index || 0;
    const end = index + code.length;
    if (isDigit(value[index - 1]) || isDigit(value[end])) {
      continue;
    }
    candidates.push({ value: code, index, end });
  }
  return candidates;
}

function scoreSmsCodeCandidate(message: string, candidate: SmsCodeCandidate): number {
  const before = message.slice(Math.max(0, candidate.index - 36), candidate.index);
  const after = message.slice(candidate.end, Math.min(message.length, candidate.end + 36));
  const near = `${before}${after}`;
  let score = 0;

  if (candidate.value.length === 6) {
    score += 120;
  } else if (candidate.value.length === 5) {
    score += 70;
  } else if (candidate.value.length === 4) {
    score += 45;
  } else {
    score += 30;
  }

  const dateLike = isDateLikeCandidate(message, candidate);
  if (SMS_CODE_CONTEXT_PATTERN.test(near) && !dateLike) {
    score += 70;
  } else if (SMS_CODE_CONTEXT_PATTERN.test(message) && !dateLike) {
    score += 15;
  }

  if (dateLike) {
    score -= 170;
  }
  if (YEAR_PREFIX_PATTERN.test(candidate.value)) {
    score -= 35;
  }

  score -= Math.min(candidate.index / 1000, 5);
  return score;
}

function isDateLikeCandidate(message: string, candidate: SmsCodeCandidate): boolean {
  const before = message.slice(Math.max(0, candidate.index - 18), candidate.index);
  const after = message.slice(candidate.end, Math.min(message.length, candidate.end + 18));
  if (DATE_FIELD_CONTEXT_PATTERN.test(before)) {
    return true;
  }
  if (YEAR_PREFIX_PATTERN.test(candidate.value) && /^[-/.年]\d{1,2}(?:[-/.月]\d{1,2})?/.test(after)) {
    return true;
  }
  if (/[-/.年]\s*$/.test(before) && /^\d{1,2}(?:[-/.月]\d{1,2})?/.test(after)) {
    return true;
  }
  return false;
}

function isDigit(value: string | undefined): boolean {
  return Boolean(value && /\d/.test(value));
}

function isEmptyMessage(value: string): boolean {
  return EMPTY_MESSAGE_PATTERN.test(value.trim());
}

function isGenericStatusMessage(value: string): boolean {
  return GENERIC_STATUS_PATTERN.test(value.trim());
}

function isJsonLikeText(value: string): boolean {
  return /^[{[]/.test(value.trim());
}

function isPreferredMessageField(key: string): boolean {
  return MESSAGE_FIELD_NAMES.has(normalizeFieldName(key));
}

function isIgnoredField(key: string): boolean {
  return IGNORE_FIELD_NAMES.has(normalizeFieldName(key));
}

function isLikelyCodeField(key: string): boolean {
  const normalized = normalizeFieldName(key);
  return normalized === 'otp' ||
    normalized === 'smscode' ||
    normalized === 'verifycode' ||
    normalized === 'verificationcode' ||
    normalized === 'captcha';
}

function isSuccessCodeField(key: string): boolean {
  return SUCCESS_CODE_FIELD_NAMES.has(normalizeFieldName(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
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

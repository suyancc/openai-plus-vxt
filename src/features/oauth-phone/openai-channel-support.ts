import { countryIdToIso, countryIsoToChineseName } from './country-map';
import type { OAuthPhoneSelectedOffer } from './types';

export type OpenAiPhoneChannel = 'sms' | 'whatsapp';

export interface OpenAiPhoneChannelSupport {
  countryIso: string;
  channels: OpenAiPhoneChannel[];
  primaryChannel: OpenAiPhoneChannel | '';
  source: 'default' | 'page' | 'unknown';
}

export interface OpenAiPhoneChannelSupportSnapshot {
  countryChannels: Record<string, OpenAiPhoneChannel[]>;
  smsFirstCountries: string[];
  whatsappFirstCountries: string[];
  source: 'default' | 'page';
}

const SMS_FIRST_COUNTRIES = [
  'US',
  'CA',
  'JP',
  'KR',
  'FR',
  'TW',
  'TH',
  'FK',
  'NU',
  'TL',
  'VU',
  'SM',
];

const WHATSAPP_FIRST_COUNTRIES = [
  'IN',
  'CO',
  'GB',
  'BR',
  'MX',
  'AR',
  'DE',
  'SE',
  'HU',
  'PH',
  'AU',
  'CZ',
  'IQ',
  'UA',
  'AZ',
  'MA',
  'PL',
  'RO',
  'BE',
  'PT',
  'GR',
  'IT',
  'AT',
  'CL',
  'CH',
  'ES',
  'NL',
  'TR',
  'AE',
  'SG',
  'IL',
  'ZA',
  'KE',
  'PM',
  'GL',
  'NF',
  'AS',
  'MS',
  'NR',
  'NZ',
  'VI',
  'GU',
  'MM',
  'BT',
  'CK',
  'MH',
  'AI',
  'FM',
  'LA',
  'EE',
  'TV',
  'VG',
  'PR',
  'PW',
  'WF',
  'KI',
  'NP',
  'LT',
  'GG',
  'LV',
  'BM',
  'PF',
  'JE',
  'KY',
  'IM',
  'PG',
  'SB',
  'IS',
  'GE',
  'BQ',
  'NC',
  'TC',
  'NI',
  'CW',
  'AW',
  'SV',
  'BS',
  'SX',
  'MD',
  'FJ',
  'TD',
  'WS',
  'ER',
  'TO',
  'SS',
  'FO',
  'ST',
  'NO',
  'VC',
  'SK',
  'KN',
  'FI',
  'DM',
  'LC',
  'TT',
  'AG',
  'GD',
  'SR',
  'BB',
  'GY',
  'BN',
  'GT',
  'SO',
  'NE',
  'RS',
  'CV',
  'DK',
  'BJ',
  'CI',
  'BZ',
  'BA',
  'GQ',
  'GA',
  'DJ',
  'MR',
  'RE',
  'GP',
  'MQ',
  'GF',
  'IE',
  'DO',
  'PA',
  'TN',
  'YT',
  'XK',
  'GM',
  'MK',
  'CG',
  'NA',
  'HR',
  'UY',
  'GI',
  'CR',
  'LR',
  'MW',
  'AD',
  'SC',
  'LS',
  'AL',
  'BH',
  'LI',
  'SZ',
  'LU',
  'CD',
  'OM',
  'MV',
  'BW',
  'CY',
  'MC',
  'KW',
  'PY',
  'MT',
  'TZ',
  'RW',
  'QA',
  'YE',
  'KZ',
  'TF',
];

export const DEFAULT_OPENAI_PHONE_CHANNEL_SUPPORT: OpenAiPhoneChannelSupportSnapshot = {
  countryChannels: buildDefaultCountryChannels(),
  smsFirstCountries: SMS_FIRST_COUNTRIES,
  whatsappFirstCountries: WHATSAPP_FIRST_COUNTRIES,
  source: 'default',
};

export function resolveOpenAiPhoneOfferSupport(
  offer: Pick<OAuthPhoneSelectedOffer, 'providerId' | 'countryId' | 'countryName'>,
  snapshot: OpenAiPhoneChannelSupportSnapshot = DEFAULT_OPENAI_PHONE_CHANNEL_SUPPORT,
): OpenAiPhoneChannelSupport {
  return resolveOpenAiPhoneCountrySupport(resolveOpenAiPhoneOfferCountryIso(offer), snapshot);
}

export function resolveOpenAiPhoneOfferCountryIso(
  offer: Pick<OAuthPhoneSelectedOffer, 'providerId' | 'countryId' | 'countryName'>,
  phoneNumber = '',
): string {
  return offer.providerId === 'smspool'
    ? countryIdToIso('', offer.countryName, phoneNumber)
    : countryIdToIso(offer.countryId, offer.countryName, phoneNumber);
}

export function resolveOpenAiPhoneCountrySupport(
  countryIso: string,
  snapshot: OpenAiPhoneChannelSupportSnapshot = DEFAULT_OPENAI_PHONE_CHANNEL_SUPPORT,
): OpenAiPhoneChannelSupport {
  const normalized = countryIso.trim().toUpperCase();
  const channels = normalizeChannels(snapshot.countryChannels[normalized] || []);
  return {
    countryIso: normalized,
    channels,
    primaryChannel: channels[0] || '',
    source: channels.length ? snapshot.source : 'unknown',
  };
}

export function isOpenAiPhoneSmsFirst(support: OpenAiPhoneChannelSupport): boolean {
  return support.primaryChannel === 'sms';
}

export function isOpenAiPhoneWhatsappFirst(support: OpenAiPhoneChannelSupport): boolean {
  return support.primaryChannel === 'whatsapp';
}

export function formatOpenAiPhoneChannelLabel(support: OpenAiPhoneChannelSupport): string {
  if (support.primaryChannel === 'sms') {
    return support.channels.includes('whatsapp') ? 'SMS 优先' : 'SMS';
  }
  if (support.primaryChannel === 'whatsapp') {
    return support.channels.includes('sms') ? 'WhatsApp 优先' : 'WhatsApp';
  }
  return '未知';
}

export function openAiPhoneChannelSearchText(support: OpenAiPhoneChannelSupport): string {
  const terms = new Set<string>();
  const add = (value: string) => {
    const text = value.trim().toLowerCase();
    if (text) {
      terms.add(text);
    }
  };
  add(support.countryIso);
  add(countryIsoToChineseName(support.countryIso));
  add(formatOpenAiPhoneChannelLabel(support));
  if (support.primaryChannel === 'sms') {
    ['sms', '短信', 'sms可用', '支持sms', '支持短信', 'openai短信'].forEach(add);
  } else if (support.primaryChannel === 'whatsapp') {
    ['whatsapp', 'wa', 'whats app', 'whatsapp可用', '支持whatsapp', '需要whatsapp'].forEach(add);
  } else {
    ['unknown', '未知'].forEach(add);
  }
  for (const channel of support.channels) {
    add(channel);
  }
  return [...terms].join(' ');
}

export function extractOpenAiPhoneChannelSupportFromPage(): OpenAiPhoneChannelSupportSnapshot {
  const bootstrapScript = document.getElementById('bootstrap-inert-script');
  const parsed = extractOpenAiPhoneChannelSupportFromText(bootstrapScript?.textContent || '');
  return parsed || DEFAULT_OPENAI_PHONE_CHANNEL_SUPPORT;
}

export function extractOpenAiPhoneChannelSupportFromText(text: string): OpenAiPhoneChannelSupportSnapshot | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const root = parseJsonObject(trimmed);
  if (!root) {
    return null;
  }

  const bootstrap = isRecord(root.statsigClientInitData) && typeof root.statsigClientInitData.bootstrap === 'string'
    ? parseJsonObject(root.statsigClientInitData.bootstrap)
    : root;
  if (!bootstrap) {
    return null;
  }

  const priorityMaps: Record<string, OpenAiPhoneChannel[]>[] = [];
  const splitMaps: Record<string, OpenAiPhoneChannel[]>[] = [];
  collectOpenAiChannelMaps(bootstrap, priorityMaps, splitMaps, 0);

  const countryChannels = priorityMaps.sort((left, right) => Object.keys(right).length - Object.keys(left).length)[0] ||
    splitMaps.sort((left, right) => Object.keys(right).length - Object.keys(left).length)[0] ||
    null;
  if (!countryChannels) {
    return null;
  }

  return createSnapshot(countryChannels, 'page');
}

export function createOpenAiPhoneChannelSupportSnapshot(
  countryChannels: Record<string, OpenAiPhoneChannel[]>,
  source: 'default' | 'page' = 'page',
): OpenAiPhoneChannelSupportSnapshot {
  return createSnapshot(countryChannels, source);
}

function buildDefaultCountryChannels(): Record<string, OpenAiPhoneChannel[]> {
  const channels: Record<string, OpenAiPhoneChannel[]> = {};
  for (const iso of WHATSAPP_FIRST_COUNTRIES) {
    channels[iso] = ['whatsapp', 'sms'];
  }
  for (const iso of SMS_FIRST_COUNTRIES) {
    channels[iso] = ['sms', 'whatsapp'];
  }
  return channels;
}

function createSnapshot(
  input: Record<string, OpenAiPhoneChannel[]>,
  source: 'default' | 'page',
): OpenAiPhoneChannelSupportSnapshot {
  const countryChannels: Record<string, OpenAiPhoneChannel[]> = {};
  for (const [countryIso, channels] of Object.entries(input)) {
    const normalizedIso = countryIso.trim().toUpperCase();
    const normalizedChannels = normalizeChannels(channels);
    if (normalizedIso && normalizedChannels.length) {
      countryChannels[normalizedIso] = normalizedChannels;
    }
  }
  return {
    countryChannels,
    smsFirstCountries: Object.entries(countryChannels)
      .filter(([, channels]) => channels[0] === 'sms')
      .map(([countryIso]) => countryIso),
    whatsappFirstCountries: Object.entries(countryChannels)
      .filter(([, channels]) => channels[0] === 'whatsapp')
      .map(([countryIso]) => countryIso),
    source,
  };
}

function collectOpenAiChannelMaps(
  value: unknown,
  priorityMaps: Record<string, OpenAiPhoneChannel[]>[],
  splitMaps: Record<string, OpenAiPhoneChannel[]>[],
  depth: number,
): void {
  if (depth > 8 || !isRecord(value)) {
    return;
  }
  const priorityMap = readCountryChannelPriorityMap(value);
  if (priorityMap && Object.keys(priorityMap).length >= 8) {
    priorityMaps.push(priorityMap);
  }
  const splitMap = readSplitCountryChannelMap(value);
  if (splitMap && Object.keys(splitMap).length >= 8) {
    splitMaps.push(splitMap);
  }
  for (const child of Object.values(value)) {
    if (isRecord(child) || Array.isArray(child)) {
      collectOpenAiChannelMaps(child, priorityMaps, splitMaps, depth + 1);
    }
  }
}

function readCountryChannelPriorityMap(value: Record<string, unknown>): Record<string, OpenAiPhoneChannel[]> | null {
  const entries = Object.entries(value)
    .map(([countryIso, channels]) => [countryIso.trim().toUpperCase(), normalizeChannels(channels)] as const)
    .filter(([countryIso, channels]) => /^[A-Z]{2}$/.test(countryIso) && channels.length > 0);
  if (entries.length < 8) {
    return null;
  }
  return Object.fromEntries(entries);
}

function readSplitCountryChannelMap(value: Record<string, unknown>): Record<string, OpenAiPhoneChannel[]> | null {
  const smsCountries = normalizeCountryList(value.sms);
  const whatsappCountries = normalizeCountryList(value.whatsapp);
  if (smsCountries.length < 2 || whatsappCountries.length < 2) {
    return null;
  }
  const result: Record<string, OpenAiPhoneChannel[]> = {};
  for (const countryIso of whatsappCountries) {
    result[countryIso] = ['whatsapp', 'sms'];
  }
  for (const countryIso of smsCountries) {
    result[countryIso] = ['sms', 'whatsapp'];
  }
  return result;
}

function normalizeChannels(value: unknown): OpenAiPhoneChannel[] {
  const raw = Array.isArray(value) ? value : [];
  const channels: OpenAiPhoneChannel[] = [];
  for (const item of raw) {
    const channel = String(item || '').trim().toLowerCase();
    if ((channel === 'sms' || channel === 'whatsapp') && !channels.includes(channel)) {
      channels.push(channel);
    }
  }
  return channels;
}

function normalizeCountryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => /^[A-Z]{2}$/.test(item)))];
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

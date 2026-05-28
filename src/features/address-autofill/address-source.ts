import type { AddressCountryOption, AddressProfile, RandomAddressResponse } from './types';

const MEIGUO_ADDRESS_ENDPOINT = 'https://www.meiguodizhi.com/api/v1/dz';

export const ADDRESS_COUNTRY_OPTIONS: AddressCountryOption[] = [
  { code: 'US', label: '美国', path: '/' },
  { code: 'CA', label: '加拿大', path: '/ca-address' },
  { code: 'AU', label: '澳大利亚', path: '/au-address' },
  { code: 'JP', label: '日本', path: '/jp-address' },
  { code: 'TW', label: '台湾', path: '/tw-address' },
  { code: 'KR', label: '韩国', path: '/kr-address' },
  { code: 'HK', label: '香港', path: '/hk-address' },
  { code: 'GB', label: '英国', path: '/uk-address' },
  { code: 'DE', label: '德国', path: '/de-address' },
  { code: 'SG', label: '新加坡', path: '/sg-address' },
  { code: 'FR', label: '法国', path: '/fr-address' },
  { code: 'IT', label: '意大利', path: '/it-address' },
  { code: 'ES', label: '西班牙', path: '/es-address' },
  { code: 'NL', label: '荷兰', path: '/nl-address' },
  { code: 'MY', label: '马来西亚', path: '/my-address' },
  { code: 'RU', label: '俄罗斯', path: '/ru-address' },
  { code: 'CN', label: '中国', path: '/cn-address' },
  { code: 'TH', label: '泰国', path: '/th-address' },
  { code: 'PH', label: '菲律宾', path: '/ph-address' },
  { code: 'AR', label: '阿根廷', path: '/ar-address' },
  { code: 'TR', label: '土耳其', path: '/tr-address' },
  { code: 'VN', label: '越南', path: '/vn-address' },
];

const FALLBACK_ADDRESSES = [
  { countryCode: 'US', countryLabel: '美国', countryPath: '/', state: 'CA', stateFull: 'California', city: 'Mountain View', postalCode: '94040', line1: '2685 California Street' },
  { countryCode: 'CA', countryLabel: '加拿大', countryPath: '/ca-address', state: 'Ontario', stateFull: 'Ontario', city: 'Toronto', postalCode: 'M4W 1J7', line1: '909 Yonge Street' },
  { countryCode: 'AU', countryLabel: '澳大利亚', countryPath: '/au-address', state: 'NSW', stateFull: 'New South Wales', city: 'Sydney', postalCode: '2000', line1: '25 Market Street' },
  { countryCode: 'GB', countryLabel: '英国', countryPath: '/uk-address', state: 'England', stateFull: 'England', city: 'London', postalCode: 'EC3C 6SB', line1: '78 Wardour St' },
  { countryCode: 'DE', countryLabel: '德国', countryPath: '/de-address', state: 'Berlin', stateFull: 'Berlin', city: 'Berlin', postalCode: '10115', line1: 'Rosenthaler Str. 89' },
  { countryCode: 'JP', countryLabel: '日本', countryPath: '/jp-address', state: 'Tokyo', stateFull: 'Tokyo', city: 'Tokyo', postalCode: '124-0006', line1: 'Horikiri, Katsushika-ku' },
  { countryCode: 'SG', countryLabel: '新加坡', countryPath: '/sg-address', state: 'Singapore', stateFull: 'Singapore', city: 'Singapore', postalCode: '039594', line1: '3 Temasek Boulevard' },
];

const FIRST_NAMES = ['Alex', 'Blake', 'Casey', 'Drew', 'Evan', 'Jamie', 'Jordan', 'Morgan', 'Riley', 'Taylor'];
const LAST_NAMES = ['Adams', 'Baker', 'Carter', 'Davis', 'Evans', 'Miller', 'Parker', 'Reed', 'Turner', 'Walker'];

export async function fetchRandomAddress(countryCode?: string, city?: string): Promise<RandomAddressResponse> {
  const country = resolveCountry(countryCode);
  const normalizedCity = normalizeSearchValue(city || '');
  try {
    const address = await fetchMeiguoAddress(country, normalizedCity);
    return {
      ok: true,
      message: `已获取 ${address.countryLabel} ${address.city} 地址`,
      address,
    };
  } catch (error) {
    const address = createFallbackAddress(country, normalizedCity);
    return {
      ok: true,
      message: `地址站点暂不可用，已使用内置备用地址：${errorMessage(error)}`,
      address,
    };
  }
}

async function fetchMeiguoAddress(country: AddressCountryOption, city: string): Promise<AddressProfile> {
  const response = await fetch(MEIGUO_ADDRESS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      city,
      path: country.path,
      method: city ? 'refresh' : 'address',
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json() as MeiguoAddressPayload;
  if (payload.status !== 'ok' || !payload.address) {
    throw new Error(payload.status || 'empty address');
  }

  return normalizeMeiguoAddress(payload.address, country);
}

function normalizeMeiguoAddress(source: MeiguoAddressRecord, country: AddressCountryOption): AddressProfile {
  const state = clean(source.State);
  const city = toTitleCaseIfAscii(clean(source.City));
  const zip = clean(source.Zip_Code);
  const line1 = clean(source.Trans_Address) || clean(source.Address);

  if (!state || !city || !zip || !line1) {
    throw new Error('address payload missing required fields');
  }

  return {
    id: createAddressId(),
    fullName: toAsciiName(clean(source.Full_Name)) || randomName(),
    line1,
    line2: `Apt ${randomInt(100, 999)}`,
    city,
    state: country.code === 'US' ? state.toUpperCase() : state,
    stateFull: clean(source.State_Full),
    postalCode: zip,
    countryCode: country.code,
    countryLabel: country.label,
    countryPath: country.path,
    phone: normalizePhone(clean(source.Telephone)),
    identity: {
      gender: clean(source.Gender),
      title: clean(source.Title),
      birthday: clean(source.Birthday),
      username: clean(source.Username),
      password: clean(source.Password),
      temporaryMail: clean(source.Temporary_mail),
      system: clean(source.System),
      userAgent: clean(source.Browser_User_Agent),
      website: clean(source.Website),
      securityQuestion: clean(source.Security_Question),
      securityAnswer: clean(source.Security_Answer),
    },
    employment: {
      educationalBackground: clean(source.Educational_Background),
      occupation: clean(source.Occupation),
      employmentStatus: clean(source.Employment_Status),
      monthlySalary: clean(source.Monthly_Salary),
      companySize: clean(source.Company_Size),
      companyName: clean(source.Company_Name),
    },
    creditCard: normalizeCreditCard(source),
    source: 'meiguodizhi',
    fetchedAt: Date.now(),
  };
}

function createFallbackAddress(country: AddressCountryOption, city: string): AddressProfile {
  const fallback = FALLBACK_ADDRESSES.find((item) => item.countryCode === country.code) ||
    FALLBACK_ADDRESSES.find((item) => item.countryCode === 'US') ||
    randomItem(FALLBACK_ADDRESSES);

  return {
    id: createAddressId(),
    fullName: randomName(),
    line1: fallback.line1,
    line2: `Apt ${randomInt(100, 999)}`,
    city: city || fallback.city,
    state: fallback.state,
    stateFull: fallback.stateFull,
    postalCode: fallback.postalCode,
    countryCode: fallback.countryCode,
    countryLabel: fallback.countryLabel,
    countryPath: fallback.countryPath,
    phone: `415${randomDigits(7)}`,
    identity: {
      gender: '',
      title: '',
      birthday: '',
      username: `user${randomDigits(6)}`,
      password: '',
      temporaryMail: '',
      system: '',
      userAgent: '',
      website: '',
      securityQuestion: '',
      securityAnswer: '',
    },
    employment: {
      educationalBackground: '',
      occupation: '',
      employmentStatus: '',
      monthlySalary: '',
      companySize: '',
      companyName: '',
    },
    creditCard: {
      type: '',
      number: '',
      cvv: '',
      expires: '',
      last4: '',
      maskedNumber: '',
    },
    source: 'fallback',
    fetchedAt: Date.now(),
  };
}

function resolveCountry(countryCode: string | undefined): AddressCountryOption {
  const normalized = normalizeSearchValue(countryCode || '');
  const upper = normalized.toUpperCase();
  if (!normalized || upper === 'RANDOM') {
    return randomItem(ADDRESS_COUNTRY_OPTIONS);
  }

  return ADDRESS_COUNTRY_OPTIONS.find((item) => item.code === upper) ||
    ADDRESS_COUNTRY_OPTIONS.find((item) => item.path === normalized) ||
    ADDRESS_COUNTRY_OPTIONS.find((item) => item.label === normalized) ||
    ADDRESS_COUNTRY_OPTIONS[0];
}

function normalizeSearchValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toTitleCaseIfAscii(value: string): string {
  if (/[^a-zA-Z\s-]/.test(value)) {
    return value;
  }
  return value.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function toAsciiName(value: string): string {
  return value.replace(/[^a-zA-Z]/g, '') || '';
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return `415${randomDigits(7)}`;
}

function normalizeCreditCard(source: MeiguoAddressRecord): AddressProfile['creditCard'] {
  const number = clean(source.Credit_Card_Number).replace(/\D/g, '');
  const last4 = number.length >= 4 ? number.slice(-4) : '';
  return {
    type: clean(source.Credit_Card_Type),
    number,
    cvv: clean(source.CVV2),
    expires: clean(source.Expires),
    last4,
    maskedNumber: last4 ? `**** **** **** ${last4}` : '',
  };
}

function createAddressId(): string {
  return `${Date.now()}-${randomDigits(6)}`;
}

function randomName(): string {
  return `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
}

function randomDigits(length: number): string {
  return Array.from({ length }, () => String(randomInt(0, 9))).join('');
}

function randomItem<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MeiguoAddressPayload {
  status?: string;
  address?: MeiguoAddressRecord;
}

interface MeiguoAddressRecord {
  Address?: string;
  Trans_Address?: string;
  Telephone?: string;
  City?: string;
  Zip_Code?: string;
  State?: string;
  State_Full?: string;
  Full_Name?: string;
  Gender?: string;
  Title?: string;
  Birthday?: string;
  Username?: string;
  Password?: string;
  Temporary_mail?: string;
  System?: string;
  Browser_User_Agent?: string;
  Website?: string;
  Security_Question?: string;
  Security_Answer?: string;
  Educational_Background?: string;
  Occupation?: string;
  Employment_Status?: string;
  Monthly_Salary?: string;
  Company_Size?: string;
  Company_Name?: string;
  Credit_Card_Type?: string;
  Credit_Card_Number?: string;
  CVV2?: string;
  Expires?: string;
}

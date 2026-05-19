export interface AddressProfile {
  id: string;
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  stateFull: string;
  postalCode: string;
  countryCode: string;
  countryLabel: string;
  countryPath: string;
  phone: string;
  identity: AddressIdentityInfo;
  employment: AddressEmploymentInfo;
  creditCard: AddressCreditCardInfo;
  source: 'meiguodizhi' | 'fallback';
  fetchedAt: number;
}

export interface AddressIdentityInfo {
  gender: string;
  title: string;
  birthday: string;
  username: string;
  password: string;
  temporaryMail: string;
  system: string;
  userAgent: string;
  website: string;
  securityQuestion: string;
  securityAnswer: string;
}

export interface AddressEmploymentInfo {
  educationalBackground: string;
  occupation: string;
  employmentStatus: string;
  monthlySalary: string;
  companySize: string;
  companyName: string;
}

export interface AddressCreditCardInfo {
  type: string;
  number: string;
  cvv: string;
  expires: string;
  last4: string;
  maskedNumber: string;
}

export interface AddressCountryOption {
  code: string;
  label: string;
  path: string;
}

export interface RandomAddressMessage {
  type: 'opx:fetch-random-address' | 'opx:fetch-random-us-address';
  countryCode?: string;
  city?: string;
}

export interface RandomAddressResponse {
  ok: boolean;
  message: string;
  address?: AddressProfile;
}

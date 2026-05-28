export interface OAuthState {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  redirectUri: string;
  authUrl: string;
  email: string;
  password: string;
  startedAt: number;
  callbackUrl: string;
  codeParam: string;
  exchangeStatus: 'idle' | 'pending' | 'success' | 'error';
  exchangeMessage: string;
  exportSource: '' | 'oauth-code' | 'chatgpt-session-add-phone' | 'chatgpt-session-direct';
  phoneVerification: OAuthPhoneVerificationState;
  credentials: OAuthCredentials | null;
  cpaJson: string;
  sub2apiJson: string;
  updatedAt: number;
}

export type OAuthPhoneVerificationStatus =
  | 'idle'
  | 'requesting'
  | 'requested'
  | 'waiting'
  | 'received'
  | 'submitted'
  | 'success'
  | 'error'
  | 'canceled';

export interface OAuthPhoneVerificationState {
  status: OAuthPhoneVerificationStatus;
  providerId: string;
  countryId: string;
  countryName: string;
  countryIso: string;
  serviceCode: string;
  cost: number;
  operator: string;
  activationId: string;
  phoneNumber: string;
  smsCode: string;
  message: string;
  startedAt: number;
  updatedAt: number;
  logs: OAuthPhoneLogEntry[];
}

export interface OAuthPhoneLogEntry {
  id: string;
  time: number;
  stage: string;
  message: string;
  data: string;
}

export interface OAuthCredentials {
  access_token: string;
  account_id: string;
  chatgpt_user_id?: string;
  disabled: boolean;
  email: string;
  expired: string;
  id_token: string;
  id_token_synthetic?: boolean;
  last_refresh: string;
  plan_type?: string;
  refresh_token: string;
  session_token?: string;
  source?: string;
  type: 'codex';
}

export interface OAuthCreateSessionMessage {
  type: 'opx:oauth-create-session';
  email: string;
  password?: string;
}

export interface OAuthExchangeMessage {
  type: 'opx:oauth-exchange-code';
  callbackUrl?: string;
  timeoutMs?: number;
}

export interface OAuthGenerateFromSessionMessage {
  type: 'opx:oauth-generate-from-session';
  email?: string;
  password?: string;
}

export interface OAuthPhoneStartMessage {
  type: 'opx:oauth-phone-start';
  tabId?: number;
}

export interface OAuthPhoneCancelMessage {
  type: 'opx:oauth-phone-cancel';
}

export interface OAuthResultResponse {
  ok: boolean;
  message: string;
  state?: Partial<OAuthState>;
  tabId?: number;
  windowId?: number;
}

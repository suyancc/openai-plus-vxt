export type CheckoutPlanName = 'chatgptteamplan' | 'chatgptplusplan';

export type CheckoutUiMode = 'custom' | 'hosted';

export type CheckoutRegion = 'US' | 'ID' | 'DE';

export interface CheckoutOptions {
  planName: CheckoutPlanName;
  uiMode: CheckoutUiMode;
  region: CheckoutRegion;
  workspaceName: string;
  seatQuantity: number;
}

export interface LinkExtractorState {
  checkoutOptions: CheckoutOptions;
  updatedAt: number;
}

export interface CheckoutLinkMessage {
  type: 'opx:create-checkout-link';
  raw: string;
  options: Partial<CheckoutOptions>;
}

export interface CheckoutLinkResponse {
  ok: boolean;
  message: string;
  url?: string;
  link?: string;
  longUrl?: string;
  shortUrl?: string;
  providerUrl?: string;
  canonicalUrl?: string;
  uiMode?: CheckoutUiMode;
  raw?: unknown;
  source?: string;
  planName?: CheckoutPlanName;
  billingDetails?: {
    country: string;
    currency: string;
  };
  responseKeys?: string[];
}

export interface ChatGptSessionMessage {
  type: 'opx:fetch-chatgpt-session';
}

export interface ChatGptSessionInfo {
  email: string;
  planType: string;
  accessToken: string;
  fetchedAt: number;
}

export interface ChatGptSessionResponse {
  ok: boolean;
  message: string;
  session?: ChatGptSessionInfo;
}

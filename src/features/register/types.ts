import type { ActionResult } from '../../app/types';

export type { ActionResult } from '../../app/types';

export interface PageState {
  kind: 'login' | 'email-verification' | 'about-you' | 'unknown';
  label: string;
  canFillEmail: boolean;
  canFillOtp: boolean;
  canFillProfile: boolean;
}

export interface RegisterController {
  getPageState(): PageState;
  loadState(): Promise<RegisterState>;
  saveInput(rawInput: string): Promise<RegisterState>;
  fillEmailFromInput(): Promise<ActionResult>;
  fillOtp(code: string): Promise<ActionResult>;
  waitForOutlookOtp(): Promise<ActionResult>;
  fillProfileAndCreate(): Promise<ActionResult>;
  autoRunForCurrentPage(): Promise<void>;
}

export interface RegisterState {
  rawInput: string;
  email: string;
  accountLine: string;
  inputMode: AccountInputMode;
  autoOtp: boolean;
  apiBase: string;
  otpRequestedAt: number;
  updatedAt: number;
}

export type AccountInputMode = 'empty' | 'email' | 'outlook-line' | 'invalid';

export interface ParsedAccountInput {
  ok: boolean;
  mode: AccountInputMode;
  email: string;
  accountLine: string;
  message: string;
}

export interface OutlookOtpMessage {
  type: 'opx:wait-outlook-otp';
  accountLine: string;
  apiBase?: string;
  timeoutMs?: number;
  intervalMs?: number;
  since?: number;
}

export interface OutlookOtpResponse {
  ok: boolean;
  message: string;
  code?: string;
}

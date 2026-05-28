import type { ActionResult } from '../../app/types';

export type { ActionResult } from '../../app/types';

export interface PageState {
  kind: 'login' | 'password' | 'email-verification' | 'about-you' | 'unknown';
  label: string;
  canFillEmail: boolean;
  canFillPassword?: boolean;
  canFillOtp: boolean;
  canFillProfile: boolean;
}

export interface RegisterController {
  getPageState(): PageState;
  loadState(): Promise<RegisterState>;
  saveInput(rawInput: string): Promise<RegisterState>;
  openRegisterPage(): Promise<ActionResult>;
  fillEmailFromInput(): Promise<ActionResult>;
  fillOtp(code: string): Promise<ActionResult>;
  waitForOutlookOtp(): Promise<ActionResult>;
  stopOutlookOtp(): Promise<ActionResult>;
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
  otpAutoPending: boolean;
  otpAutoRunning: boolean;
  otpJobId: string;
  otpLastMessage: string;
  otpLastStartedAt: number;
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
  jobId?: string;
  accountLine: string;
  apiBase?: string;
  timeoutMs?: number;
  intervalMs?: number;
  since?: number;
  ignoreCodes?: string[];
}

export interface OutlookOtpResponse {
  ok: boolean;
  message: string;
  code?: string;
  canceled?: boolean;
}

export interface OutlookOtpCancelMessage {
  type: 'opx:cancel-outlook-otp';
  jobId?: string;
}

export interface OutlookApiCheckMessage {
  type: 'opx:check-outlook-api';
  apiBase?: string;
}

import type { CheckoutExtractMode, CheckoutOptions } from '../link-extractor/types';

export type AutomationStepId =
  | 'cleanup-environment'
  | 'select-email'
  | 'open-register'
  | 'fill-register-email'
  | 'wait-register-email-code'
  | 'fill-profile'
  | 'read-chatgpt-session'
  | 'create-checkout-link'
  | 'open-checkout-link'
  | 'select-sms'
  | 'submit-openai-checkout'
  | 'open-paypal-account'
  | 'fill-paypal-email'
  | 'fill-payment-profile'
  | 'wait-payment-sms'
  | 'create-oauth-session'
  | 'fill-oauth-email'
  | 'wait-oauth-email-code'
  | 'export-oauth-files'
  | 'generate-direct-files';

export type AutomationStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';
export type AutomationLogLevel = 'info' | 'success' | 'error' | 'warn';
export type AutomationEmailStatus = 'idle' | 'running' | 'used' | 'error';
export type AutomationEmailSelectionMode = 'next' | 'specified';
export type AutomationSmsSelectionMode = 'random' | 'next';
export type AutomationOAuthExtractMode = 'email' | 'direct';

export interface AutomationStepDefinition {
  id: AutomationStepId;
  order: number;
  title: string;
  description: string;
}

export interface AutomationStepRecord {
  id: AutomationStepId;
  status: AutomationStepStatus;
  message: string;
  startedAt: number;
  finishedAt: number;
}

export interface AutomationEmailAccount {
  id: string;
  rawInput: string;
  email: string;
  status: AutomationEmailStatus;
  useCount: number;
  lastUsedAt: number;
  lastMessage: string;
}

export interface AutomationSmsTarget {
  id: string;
  rawInput: string;
  phone: string;
  url: string;
  disabled: boolean;
  disabledAt: number;
  disabledReason: string;
  useCount: number;
  lastUsedAt: number;
  lastCodeAt: number;
  lastMessage: string;
}

export interface AutomationSettings {
  rawEmails: string;
  rawSms: string;
  emailSelectionMode: AutomationEmailSelectionMode;
  specifiedEmailId: string;
  smsSelectionMode: AutomationSmsSelectionMode;
  batchAccountLimit: number;
  stopOnError: boolean;
  autoOpenCheckout: boolean;
  debugMode: boolean;
  oauthExtractMode: AutomationOAuthExtractMode;
  checkoutOptions: Partial<CheckoutOptions>;
  checkoutExtractMode?: CheckoutExtractMode;
}

export interface AutomationRunState {
  running: boolean;
  paused: boolean;
  currentStepId: AutomationStepId | '';
  selectedEmailId: string;
  selectedSmsId: string;
  checkoutUrl: string;
  sessionEmail: string;
  targetTabId: number;
  targetWindowId: number;
  startedAt: number;
  finishedAt: number;
}

export interface AutomationLogEntry {
  id: string;
  time: number;
  level: AutomationLogLevel;
  stepId: AutomationStepId | '';
  message: string;
}

export interface AutomationGeneratedFileRecord {
  id: string;
  email: string;
  source: string;
  sub2apiJson: string;
  cpaJson: string;
  createdAt: number;
}

export interface AutomationGeneratedFilesState {
  records: AutomationGeneratedFileRecord[];
  sub2apiJson: string;
  cpaJson: string;
  updatedAt: number;
}

export interface AutomationState {
  settings: AutomationSettings;
  emails: AutomationEmailAccount[];
  smsTargets: AutomationSmsTarget[];
  steps: AutomationStepRecord[];
  logs: AutomationLogEntry[];
  run: AutomationRunState;
  generatedFiles: AutomationGeneratedFilesState;
  updatedAt: number;
}

export interface AutomationSettingsParseResult {
  emails: AutomationEmailAccount[];
  emailErrors: string[];
  smsTargets: AutomationSmsTarget[];
  smsErrors: string[];
}

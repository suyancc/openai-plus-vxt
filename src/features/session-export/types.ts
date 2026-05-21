export type ExportFormat = 'cpa' | 'sub2api' | 'cockpit' | '9router';

export interface ConvertedAccount {
  sourceName: string;
  sourcePath?: string;
  email?: string;
  name?: string;
  expiresAt?: string;
  cpa: Record<string, unknown>;
  cockpit: Record<string, unknown>;
  nineRouter: Record<string, unknown>;
  sub2apiAccount: Record<string, unknown>;
}

export interface ConvertSkipped {
  sourceName: string;
  path?: string;
  reason: string;
}

export interface SessionExportState {
  format: ExportFormat;
  converted: ConvertedAccount[];
  skipped: ConvertSkipped[];
  outputText: string;
}

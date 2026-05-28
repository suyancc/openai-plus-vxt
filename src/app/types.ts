export type FeatureTab = 'register' | 'automation' | 'link' | 'oauth' | 'address' | 'sms' | 'settings';

export interface ActionResult {
  ok: boolean;
  message: string;
  code?: string;
  url?: string;
  data?: unknown;
}

export interface FeaturePanelHandle {
  update(): void | Promise<void>;
  onShow?(): void | Promise<void>;
}

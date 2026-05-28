import { getActiveBrowserTab } from '../../app/active-tab';
import { loadRegisterState } from '../../app/state';
import {
  autoStartOutlookOtpIfNeeded,
  fillEmailOtp,
  fillProfileAndCreateAccount,
  fillRegisterEmailFromCurrentInput,
  getCurrentRegisterPageState,
  openRegisterPage,
  pageStateFromUrl,
  saveRegisterInput,
  stopOutlookOtp,
  waitForOutlookOtpAndSubmit,
} from './service';
import type { PageState, RegisterController } from './types';

let cachedPageState: PageState = pageStateFromUrl('');
let autoProfileStartedForUrl = '';

export function createSidePanelRegisterController(): RegisterController {
  void refreshPageState();
  window.setInterval(() => void refreshPageState(), 800);

  return {
    getPageState: () => cachedPageState,
    loadState: loadRegisterState,
    saveInput: saveRegisterInput,
    openRegisterPage,
    fillEmailFromInput: async () => withPageRefresh(fillRegisterEmailFromCurrentInput),
    fillOtp: async (code: string) => withPageRefresh(() => fillEmailOtp(code)),
    waitForOutlookOtp: async () => withPageRefresh(() => waitForOutlookOtpAndSubmit()),
    stopOutlookOtp,
    fillProfileAndCreate: async () => withPageRefresh(fillProfileAndCreateAccount),
    autoRunForCurrentPage: async () => {
      await refreshPageState();
      if (cachedPageState.canFillOtp) {
        await autoStartOutlookOtpIfNeeded();
      }

      const tab = await getActiveBrowserTab();
      const url = tab?.url || '';
      if (cachedPageState.canFillProfile && autoProfileStartedForUrl !== url) {
        autoProfileStartedForUrl = url;
        await waitForPageReady();
        const result = await fillProfileAndCreateAccount();
        if (!result.ok) {
          autoProfileStartedForUrl = '';
        }
      }
    },
  };
}

async function withPageRefresh<T>(task: () => Promise<T>): Promise<T> {
  await refreshPageState();
  const result = await task();
  await refreshPageState();
  return result;
}

async function refreshPageState(): Promise<void> {
  cachedPageState = await getCurrentRegisterPageState();
}

function waitForPageReady(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 800));
}

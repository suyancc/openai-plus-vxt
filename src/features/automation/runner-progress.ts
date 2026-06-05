import { AUTOMATION_STEPS, getDisplayStepDefinition, nextVisibleAutomationStepId, visibleAutomationSteps } from './steps';
import type { AutomationState, AutomationStepId } from './types';

export function nextPendingStepId(state: AutomationState): AutomationStepId | '' {
  for (const definition of visibleAutomationSteps(state.settings.oauthExtractMode, state.settings.registrationMode)) {
    const record = state.steps.find((step) => step.id === definition.id);
    if (record?.status === 'pending' || record?.status === 'error') {
      return definition.id;
    }
  }
  return '';
}

export function resumeStepId(state: AutomationState): AutomationStepId | '' {
  const visibleSteps = visibleAutomationSteps(state.settings.oauthExtractMode, state.settings.registrationMode);
  const visibleIds = new Set(visibleSteps.map((step) => step.id));
  const cleanup = state.steps.find((step) => step.id === 'cleanup-environment');
  if (cleanup?.status === 'pending' || cleanup?.status === 'error') {
    return 'cleanup-environment';
  }
  if (state.run.currentStepId && visibleIds.has(state.run.currentStepId)) {
    const current = state.steps.find((step) => step.id === state.run.currentStepId);
    if (!current || current.status !== 'success') {
      return state.run.currentStepId;
    }
  }

  const successful = [...visibleSteps]
    .reverse()
    .find((definition) => state.steps.find((step) => step.id === definition.id)?.status === 'success');
  if (successful) {
    const next = nextVisibleAutomationStepId(successful.id, state.settings.oauthExtractMode, state.settings.registrationMode);
    if (next) {
      return next;
    }
  }
  return nextPendingStepId(state);
}

export function resolveAutomationStartStep(state: AutomationState, requestedStepId?: AutomationStepId): AutomationStepId | '' {
  if (requestedStepId) {
    const requested = state.steps.find((step) => step.id === requestedStepId);
    if (requested?.status === 'success') {
      return nextVisibleAutomationStepId(requestedStepId, state.settings.oauthExtractMode, state.settings.registrationMode) || nextPendingStepId(state);
    }
    return requestedStepId;
  }
  return resumeStepId(state) || visibleAutomationSteps(state.settings.oauthExtractMode, state.settings.registrationMode)[0]?.id || AUTOMATION_STEPS[0]?.id || '';
}

export function stepTitle(stepId: AutomationStepId | '', state?: AutomationState): string {
  const step = AUTOMATION_STEPS.find((item) => item.id === stepId);
  if (!step) {
    return '自动化流程';
  }
  return getDisplayStepDefinition(step, state?.settings.registrationMode).title;
}

export function stepNumber(stepId: AutomationStepId): number {
  const order = AUTOMATION_STEPS.find((step) => step.id === stepId)?.order || 0;
  return Math.max(1, Math.floor(order / 10));
}

import type { ActionResult } from './types';
import {
  buildOtpDebugData,
  fillOtpTarget,
  findOtpContinueButton,
  findOtpTarget,
} from './openai-email-otp-dom';

export function isEmailVerificationPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/email-verification');
}

export async function fillOtpAndContinue(code: string): Promise<ActionResult> {
  const normalized = code.replace(/\D/g, '');
  if (!normalized) {
    return fail('验证码不能为空');
  }

  const target = findOtpTarget();
  if (!target) {
    return fail('没有找到验证码输入框', buildOtpDebugData());
  }

  fillOtpTarget(target, normalized);

  await waitForUiTick();

  const button = findOtpContinueButton();
  if (!button) {
    return fail('没有找到验证码继续按钮', buildOtpDebugData());
  }

  if (button.disabled) {
    await waitForEnabled(button, 2500);
  }

  if (button.disabled) {
    return fail('验证码继续按钮仍然不可点击');
  }

  clickElement(button);
  return ok(`已填入验证码并点击继续（${target.kind === 'multi' ? `${target.inputs.length} 格输入框` : '单输入框'}）`);
}

function waitForUiTick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 60));
}

function waitForEnabled(button: HTMLButtonElement, timeoutMs: number): Promise<void> {
  const started = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (!button.disabled || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

function clickElement(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', inline: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: type.endsWith('down') ? 1 : 0,
      pointerId: 1,
      pointerType: 'mouse',
    }));
  }
  element.click();
}

function ok(message: string, data?: unknown): ActionResult {
  return data === undefined ? { ok: true, message } : { ok: true, message, data };
}

function fail(message: string, data?: unknown): ActionResult {
  return data === undefined ? { ok: false, message } : { ok: false, message, data };
}

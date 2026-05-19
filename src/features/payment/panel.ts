import type { FeaturePanelHandle } from '../../app/types';

export function createPaymentPanel(container: HTMLElement): FeaturePanelHandle {
  container.classList.add('opx-empty-view');
  container.textContent = '支付模块稍后接入';
  return {
    update() {},
  };
}

import { createRegisterController } from '../features/register/controller';
import { createPanel } from './panel';

const ROOT_ID = 'opx-assistant-root';

export function mountAssistant(): void {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const registerController = createRegisterController();
  createPanel(shadow, registerController);
  void registerController.autoRunForCurrentPage();
}

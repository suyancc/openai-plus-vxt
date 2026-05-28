import './style.css';

import { createPanel } from '../../src/app/panel';
import { createSidePanelRegisterController } from '../../src/features/register/sidepanel-controller';

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  const shadow = app.attachShadow({ mode: 'open' });
  createPanel(shadow, createSidePanelRegisterController(), { surface: 'sidepanel' });
}

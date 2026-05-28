export const PANEL_STYLES = `
:host {
  all: initial;
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: none;
}

.opx-shell {
  position: fixed;
  top: 72px;
  right: 0;
  z-index: 2147483647;
  display: flex;
  align-items: flex-start;
  max-height: calc(100vh - 88px);
  pointer-events: auto;
}

.opx-shell.is-sidepanel {
  position: static;
  display: block;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  overflow: hidden;
}

.opx-panel {
  box-sizing: border-box;
  width: min(380px, calc(100vw - 42px));
  max-height: calc(100vh - 88px);
  margin-right: 18px;
  padding: 10px;
  border: 1px solid rgba(54, 211, 153, 0.28);
  border-radius: 8px;
  background: #0b1220;
  color: #e5f7ef;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgba(47, 209, 124, 0.55) rgba(15, 23, 42, 0.72);
  scrollbar-width: thin;
}

.opx-shell.is-sidepanel .opx-panel {
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  max-height: 100vh;
  max-height: 100dvh;
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  overflow-y: auto;
  overscroll-behavior: auto;
}

.opx-shell.is-sidepanel .opx-collapse-toggle {
  display: none;
}

.opx-shell.is-sidepanel.is-collapsed .opx-panel {
  display: block;
}

.opx-panel::-webkit-scrollbar {
  width: 8px;
}

.opx-panel::-webkit-scrollbar-track {
  background: rgba(15, 23, 42, 0.72);
  border-radius: 999px;
}

.opx-panel::-webkit-scrollbar-thumb {
  background: rgba(47, 209, 124, 0.55);
  border-radius: 999px;
}

.opx-collapse-toggle {
  box-sizing: border-box;
  width: 32px;
  min-height: 64px;
  margin: 8px 0 0 0;
  padding: 8px 6px;
  border: 1px solid rgba(47, 209, 124, 0.36);
  border-right: 0;
  border-radius: 8px 0 0 8px;
  background: #0b1220;
  color: #93e4bd;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 14px;
  writing-mode: vertical-rl;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
}

.opx-shell.is-collapsed .opx-panel {
  display: none;
}

.opx-shell.is-collapsed .opx-collapse-toggle {
  margin-right: 0;
  border-radius: 8px 0 0 8px;
  background: #102019;
}

.opx-topbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  align-items: stretch;
  margin-bottom: 8px;
}

.opx-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 0;
  padding: 3px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.8);
  overflow-x: auto;
  scrollbar-width: none;
}

.opx-tabs::-webkit-scrollbar {
  display: none;
}

.opx-tab {
  flex: 0 0 auto;
  height: 30px;
  min-width: 58px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opx-tab.is-active {
  background: #2fd17c;
  color: #04130a;
}

.opx-icon-button {
  box-sizing: border-box;
  width: 34px;
  height: 36px;
  border: 1px solid rgba(47, 209, 124, 0.36);
  border-radius: 8px;
  background: #111827;
  color: #93e4bd;
  cursor: pointer;
  font: inherit;
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
}

.opx-icon-button:hover {
  border-color: rgba(47, 209, 124, 0.74);
  color: #bbf7d0;
}

.opx-state {
  margin: 0 0 8px;
  color: #93e4bd;
  font-size: 12px;
  line-height: 16px;
}

.opx-state-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin: 0 0 8px;
}

.opx-state-row .opx-state {
  min-width: 0;
  margin: 0;
}

.opx-state-register-links {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.opx-state-register-links[hidden] {
  display: none;
}

.opx-state-link {
  color: #bbf7d0;
  font-size: 11px;
  font-weight: 750;
  line-height: 16px;
  text-decoration: none;
  white-space: nowrap;
}

.opx-state-button {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.opx-state-link-primary {
  color: #dcfce7;
  font-size: 12px;
  font-weight: 850;
}

.opx-state-link:hover {
  color: #dcfce7;
  text-decoration: underline;
}

.opx-version-notice {
  display: grid;
  gap: 7px;
  margin: 0 0 8px;
  padding: 8px;
  border: 1px solid rgba(47, 209, 124, 0.42);
  border-radius: 7px;
  background: rgba(47, 209, 124, 0.1);
  color: #dcfce7;
}

.opx-version-notice[hidden] {
  display: none;
}

.opx-version-notice-title {
  color: #bbf7d0;
  font-size: 12px;
  font-weight: 800;
  line-height: 16px;
}

.opx-version-notice-body {
  color: #cbd5e1;
  font-size: 11px;
  line-height: 15px;
  overflow-wrap: anywhere;
}

.opx-version-notice-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 54px;
  gap: 5px;
}

.opx-mini-button {
  box-sizing: border-box;
  min-width: 0;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: #2fd17c;
  color: #04130a;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opx-mini-button-secondary {
  border: 1px solid rgba(47, 209, 124, 0.34);
  background: rgba(15, 23, 42, 0.72);
  color: #93e4bd;
}

.opx-mini-button.is-pending,
.opx-button.is-pending,
.opx-cookie-clear-button.is-pending,
.opx-external-link-button.is-pending,
.opx-sms-code-chip.is-pending,
.opx-state-button.is-pending {
  border: 1px solid rgba(96, 165, 250, 0.62);
  background: rgba(37, 99, 235, 0.22);
  color: #bfdbfe;
  opacity: 1;
}

.opx-mini-button.is-flashed,
.opx-button.is-flashed,
.opx-cookie-clear-button.is-flashed,
.opx-external-link-button.is-flashed,
.opx-sms-code-chip.is-flashed,
.opx-state-button.is-flashed {
  border-color: rgba(52, 211, 153, 0.64);
  background: rgba(6, 78, 59, 0.28);
  color: #a7f3d0;
}

.opx-view {
  display: block;
}

.opx-view[hidden] {
  display: none;
}

.opx-empty-view {
  min-height: 84px;
  display: grid;
  place-items: center;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  color: #94a3b8;
  font-size: 13px;
}

.opx-input,
.opx-select,
.opx-textarea {
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  margin: 0 0 8px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 6px;
  background: #111827;
  color: #e5f7ef;
  font: inherit;
  font-size: 13px;
  outline: none;
}

.opx-select {
  appearance: none;
}

.opx-textarea {
    min-height: 72px;
    max-height: 140px;
    padding: 9px 10px;
    resize: vertical;
    line-height: 18px;
  }

  .opx-oauth-phone-log {
    min-height: 96px;
    max-height: 180px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    line-height: 15px;
  }

.opx-input:focus,
.opx-select:focus,
.opx-textarea:focus {
  border-color: #2fd17c;
}

.opx-hint {
  margin: -2px 0 8px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 15px;
}

.opx-hint.is-ok {
  color: #86efac;
}

.opx-download-link {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 34px;
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 1px solid rgba(47, 209, 124, 0.44);
  border-radius: 6px;
  background: rgba(47, 209, 124, 0.14);
  color: #bbf7d0;
  font-size: 13px;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
  text-decoration: none;
}

.opx-download-link:hover {
  border-color: rgba(47, 209, 124, 0.78);
  background: rgba(47, 209, 124, 0.2);
  color: #dcfce7;
}

.opx-summary {
  margin: 0 0 8px;
  padding: 7px 8px;
  border: 1px solid rgba(47, 209, 124, 0.28);
  border-radius: 6px;
  background: rgba(47, 209, 124, 0.08);
  color: #bbf7d0;
  font-size: 11px;
  line-height: 15px;
  word-break: break-word;
  white-space: pre-line;
}

.opx-session-card {
  display: grid;
  gap: 5px;
  margin: 0 0 8px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
}

.opx-session-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 6px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 15px;
}

.opx-session-row strong {
  min-width: 0;
  color: #e5f7ef;
  font-weight: 600;
  word-break: break-word;
}

.opx-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.opx-checkout-options-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.opx-checkout-options-grid .opx-label {
  margin-bottom: 3px;
  font-size: 10px;
  line-height: 13px;
  white-space: nowrap;
}

.opx-checkout-options-grid .opx-select {
  height: 32px;
  margin-bottom: 8px;
  padding: 0 7px;
  font-size: 11px;
  line-height: 32px;
  text-overflow: ellipsis;
}

.opx-team-options[hidden] {
  display: none;
}

.opx-checkout-mode-grid {
  grid-template-columns: minmax(0, 0.48fr) minmax(0, 0.52fr);
}

.opx-field {
  display: block;
  min-width: 0;
}

.opx-label {
  display: block;
  margin: 0 0 4px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 14px;
}

.opx-token-textarea {
  min-height: 92px;
}

.opx-output {
  min-height: 58px;
  resize: vertical;
}

.opx-button-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.opx-oauth-otp-actions {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.opx-oauth-email-actions {
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
}

.opx-oauth-email-actions .opx-button {
  height: 32px;
  padding: 0 8px;
  font-size: 12px;
}

.opx-oauth-code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(116px, 0.72fr);
  gap: 6px;
  align-items: end;
}

.opx-oauth-code-row .opx-field {
  min-width: 0;
}

.opx-oauth-code-row .opx-button {
  height: 36px;
  margin: 0 0 8px;
  padding: 0 7px;
  font-size: 12px;
}

.opx-oauth-result-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.opx-oauth-manual-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.opx-address-actions {
  grid-template-columns: minmax(0, 1fr);
}

.opx-button {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  margin: 0 0 10px;
  border: 0;
  border-radius: 6px;
  background: #2fd17c;
  color: #04130a;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.opx-button-secondary {
  background: #182235;
  color: #93e4bd;
  border: 1px solid rgba(47, 209, 124, 0.36);
}

.opx-button-danger {
  background: #7f1d1d;
  color: #fee2e2;
  border: 1px solid rgba(248, 113, 113, 0.42);
}

.opx-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.opx-button.is-pending:disabled,
.opx-mini-button.is-pending:disabled,
.opx-cookie-clear-button.is-pending:disabled,
.opx-external-link-button.is-pending:disabled,
.opx-sms-code-chip.is-pending:disabled,
.opx-state-button.is-pending:disabled {
  opacity: 1;
}

.opx-textarea:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.opx-status {
  box-sizing: border-box;
  min-height: 24px;
  margin-top: 2px;
  padding: 4px 7px 4px 9px;
  border-left: 3px solid rgba(148, 163, 184, 0.38);
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.38);
  color: #cbd5e1;
  font-size: 12px;
  line-height: 16px;
  word-break: break-word;
}

.opx-status[data-type="ok"] {
  border-left-color: #34d399;
  background: rgba(16, 185, 129, 0.1);
  color: #a7f3d0;
}

.opx-status[data-type="pending"] {
  border-left-color: #60a5fa;
  background: rgba(37, 99, 235, 0.12);
  color: #bfdbfe;
}

.opx-status[data-type="error"] {
  border-left-color: #fb7185;
  background: rgba(190, 18, 60, 0.16);
  color: #fecdd3;
}

.opx-status[data-tone="info"] {
  border-left-color: #38bdf8;
  background: rgba(14, 165, 233, 0.1);
  color: #bae6fd;
}

.opx-status[data-tone="warn"] {
  border-left-color: #f59e0b;
  background: rgba(180, 83, 9, 0.13);
  color: #fde68a;
}

.opx-toast-stack {
  position: fixed;
  top: 10px;
  right: 10px;
  z-index: 2147483647;
  display: grid;
  gap: 8px;
  width: min(300px, calc(100vw - 20px));
  pointer-events: none;
}

.opx-toast {
  box-sizing: border-box;
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 9px 10px 9px 9px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-left-width: 4px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.96);
  color: #e5f7ef;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
  font-size: 12px;
  font-weight: 650;
  line-height: 16px;
  overflow-wrap: anywhere;
  animation: opx-toast-in 150ms ease-out;
}

.opx-toast::before {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  color: currentColor;
  content: "i";
  font-size: 11px;
  font-weight: 900;
  line-height: 18px;
}

.opx-toast[data-type="ok"] {
  border-color: rgba(52, 211, 153, 0.18);
  border-left-color: #34d399;
  background: rgba(6, 78, 59, 0.96);
  color: #d1fae5;
}

.opx-toast[data-type="ok"]::before {
  content: "✓";
}

.opx-toast[data-type="pending"] {
  border-color: rgba(96, 165, 250, 0.18);
  border-left-color: #60a5fa;
  background: rgba(30, 58, 138, 0.96);
  color: #dbeafe;
}

.opx-toast[data-type="pending"]::before {
  content: "…";
}

.opx-toast[data-type="error"] {
  border-color: rgba(251, 113, 133, 0.2);
  border-left-color: #fb7185;
  background: rgba(127, 29, 29, 0.96);
  color: #ffe4e6;
}

.opx-toast[data-type="error"]::before {
  content: "!";
}

.opx-toast[data-type="info"] {
  border-color: rgba(56, 189, 248, 0.18);
  border-left-color: #38bdf8;
  background: rgba(12, 74, 110, 0.96);
  color: #e0f2fe;
}

.opx-toast[data-type="info"]::before {
  content: "i";
}

.opx-toast[data-type="warn"] {
  border-color: rgba(245, 158, 11, 0.2);
  border-left-color: #f59e0b;
  background: rgba(120, 53, 15, 0.96);
  color: #fef3c7;
}

.opx-toast[data-type="warn"]::before {
  content: "!";
}

.opx-toast.is-leaving {
  animation: opx-toast-out 160ms ease-in forwards;
}

@keyframes opx-toast-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes opx-toast-out {
  to {
    opacity: 0;
    transform: translateY(-4px);
  }
}

.opx-settings-panel {
  box-sizing: border-box;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #e5f7ef;
  overflow: visible;
}

.opx-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 8px;
  border-bottom: 0;
  color: #bbf7d0;
  font-size: 14px;
  line-height: 18px;
}

.opx-settings-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.opx-version-badge {
  padding: 1px 6px;
  border: 1px solid rgba(47, 209, 124, 0.34);
  border-radius: 999px;
  background: rgba(47, 209, 124, 0.08);
  color: #93e4bd;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
}

.opx-settings-panel .opx-grid {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.opx-setting-item {
  margin: 8px 8px 0;
  padding: 8px;
  border: 1px solid rgba(47, 209, 124, 0.22);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.54);
}

.opx-setting-item .opx-check-row {
  margin-bottom: 4px;
}

.opx-setting-description {
  margin-left: 26px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 15px;
}

.opx-settings-section {
  display: grid;
  gap: 6px;
  margin: 8px 8px 0;
  padding: 8px;
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.13);
}

.opx-settings-section-title {
  color: #fecaca;
  font-size: 12px;
  font-weight: 800;
  line-height: 16px;
}

.opx-settings-cookie-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}

.opx-cookie-clear-button {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  padding: 7px 8px;
  border: 1px solid rgba(248, 113, 113, 0.42);
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.56);
  color: #fee2e2;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  line-height: 15px;
  text-align: center;
}

.opx-cookie-clear-button:hover {
  border-color: rgba(248, 113, 113, 0.76);
  background: rgba(153, 27, 27, 0.72);
}

.opx-cookie-clear-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.opx-cookie-description {
  margin-left: 0;
}

.opx-external-link-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 34px;
  margin: 8px 8px 0;
  padding: 8px 10px;
  border: 1px solid rgba(47, 209, 124, 0.34);
  border-radius: 6px;
  background: rgba(47, 209, 124, 0.1);
  color: #bbf7d0;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  text-align: left;
}

.opx-telegram-icon {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
}

.opx-external-link-button:hover {
  border-color: rgba(47, 209, 124, 0.7);
  background: rgba(47, 209, 124, 0.16);
  color: #dcfce7;
}

.opx-external-link-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.opx-check-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin: 0 0 10px;
  color: #e5f7ef;
  cursor: pointer;
  font-size: 12px;
  line-height: 16px;
}

.opx-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #2fd17c;
}

.opx-address-summary {
  min-height: 68px;
}

.opx-automation-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 58px;
  gap: 7px;
  align-items: stretch;
  margin: 0 0 8px;
}

.opx-automation-summary {
  margin: 0;
}

.opx-automation-settings-button {
  width: 100%;
  min-height: 32px;
}

.opx-automation-controls {
  grid-template-columns: minmax(0, 1fr) 66px 66px;
}

.opx-automation-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 10px 0 6px;
  color: #bbf7d0;
  font-size: 12px;
  font-weight: 800;
  line-height: 16px;
}

.opx-automation-section-header strong {
  color: #93e4bd;
  font-size: 11px;
  font-weight: 750;
}

.opx-automation-stages {
  display: grid;
  gap: 7px;
}

.opx-automation-stage {
  box-sizing: border-box;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.22);
  overflow: hidden;
}

.opx-automation-stage[data-status="running"] {
  border-color: rgba(251, 191, 36, 0.42);
}

.opx-automation-stage[data-status="success"] {
  border-color: rgba(47, 209, 124, 0.42);
}

.opx-automation-stage[data-status="error"] {
  border-color: rgba(248, 113, 113, 0.42);
}

.opx-automation-stage-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 74px;
  gap: 6px;
  align-items: stretch;
  padding: 6px;
}

.opx-automation-stage-header {
  display: grid;
  grid-template-columns: 14px auto max-content minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  min-width: 0;
  min-height: 36px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0 4px;
  text-align: left;
}

.opx-automation-stage-header:hover {
  background: rgba(148, 163, 184, 0.08);
}

.opx-automation-stage-caret {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1;
}

.opx-automation-stage-header strong {
  color: #e5f7ef;
  font-size: 12px;
  font-weight: 850;
  line-height: 16px;
  white-space: nowrap;
}

.opx-automation-stage-header span:not(.opx-automation-stage-caret) {
  color: #93e4bd;
  font-size: 11px;
  font-weight: 750;
  line-height: 15px;
  white-space: nowrap;
}

.opx-automation-stage-header em {
  min-width: 0;
  color: #94a3b8;
  font-size: 11px;
  font-style: normal;
  line-height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opx-automation-stage-run {
  min-height: 36px;
  margin: 0;
  padding: 0 6px;
}

.opx-automation-stage .opx-automation-steps {
  padding: 0 6px 6px;
}

.opx-automation-steps {
  display: grid;
  gap: 6px;
}

.opx-automation-step {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 56px;
  gap: 8px;
  align-items: center;
  min-height: 52px;
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
}

.opx-automation-step[data-status="running"] {
  border-color: rgba(251, 191, 36, 0.46);
  background: rgba(120, 53, 15, 0.16);
}

.opx-automation-step[data-status="success"] {
  border-color: rgba(47, 209, 124, 0.46);
  background: rgba(47, 209, 124, 0.09);
}

.opx-automation-step[data-status="error"] {
  border-color: rgba(248, 113, 113, 0.44);
  background: rgba(127, 29, 29, 0.18);
}

.opx-automation-step-indicator {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 999px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 850;
  line-height: 1;
}

.opx-automation-step[data-status="success"] .opx-automation-step-indicator {
  border-color: rgba(47, 209, 124, 0.7);
  color: #86efac;
}

.opx-automation-step[data-status="error"] .opx-automation-step-indicator {
  border-color: rgba(248, 113, 113, 0.64);
  color: #fca5a5;
}

.opx-automation-step[data-status="running"] .opx-automation-step-indicator {
  border-color: rgba(251, 191, 36, 0.66);
  color: #fbbf24;
}

.opx-automation-step-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.opx-automation-step-main strong {
  min-width: 0;
  color: #e5f7ef;
  font-size: 12px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opx-automation-step-main span {
  min-width: 0;
  color: #94a3b8;
  font-size: 11px;
  line-height: 15px;
  overflow-wrap: anywhere;
}

.opx-automation-step-meta {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.opx-automation-step-meta span {
  color: #93e4bd;
  font-size: 10px;
  font-weight: 750;
  line-height: 13px;
  text-align: center;
}

.opx-automation-step-meta .opx-mini-button {
  min-height: 24px;
  margin: 0;
  padding: 0 6px;
}

.opx-automation-log {
  box-sizing: border-box;
  display: grid;
  gap: 5px;
  max-height: 220px;
  min-height: 90px;
  overflow-y: auto;
  padding: 7px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(2, 6, 23, 0.34);
}

.opx-automation-log-line {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
  color: #cbd5e1;
  font-size: 11px;
  line-height: 15px;
}

.opx-automation-log-line span {
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.opx-automation-log-line strong {
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.opx-automation-log-line[data-level="success"] strong {
  color: #86efac;
}

.opx-automation-log-line[data-level="error"] strong {
  color: #fca5a5;
}

.opx-automation-log-line[data-level="warn"] strong {
  color: #fbbf24;
}

.opx-settings-buttons {
  margin-top: 2px;
}

.opx-section-title {
  margin: 10px 0 6px;
  color: #bbf7d0;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
}

.opx-copy-list {
  display: grid;
  gap: 5px;
}

.opx-copy-section {
  display: grid;
  gap: 5px;
  margin: 5px 0 1px;
}

.opx-copy-section-title {
  color: #93e4bd;
  font-size: 11px;
  font-weight: 700;
  line-height: 15px;
}

.opx-copy-section-body {
  display: grid;
  gap: 5px;
}

.opx-accordion-section {
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.56);
}

.opx-accordion-section summary {
  padding: 7px 8px;
  color: #93e4bd;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 15px;
  list-style-position: inside;
}

.opx-accordion-section .opx-copy-section-body {
  padding: 0 6px 6px;
}

.opx-copy-row,
.opx-empty-inline {
  box-sizing: border-box;
  width: 100%;
  min-height: 30px;
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
  color: #cbd5e1;
  font: inherit;
  font-size: 11px;
  line-height: 15px;
  text-align: left;
  word-break: break-word;
}

.opx-copy-row {
  cursor: pointer;
}

.opx-copy-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 4px;
  align-items: start;
}

.opx-copy-row:hover {
  border-color: rgba(47, 209, 124, 0.48);
  color: #e5f7ef;
}

.opx-copy-row.is-copied {
  border-color: rgba(47, 209, 124, 0.72);
  background: rgba(47, 209, 124, 0.12);
}

.opx-copy-label {
  color: #94a3b8;
  white-space: nowrap;
}

.opx-copy-row strong {
  min-width: 0;
  color: #e5f7ef;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.opx-copy-feedback {
  align-self: start;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(47, 209, 124, 0.16);
  color: #86efac !important;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  white-space: nowrap;
}

.opx-copy-feedback[hidden] {
  display: none;
}

.opx-empty-inline {
  color: #94a3b8;
  border-style: dashed;
}

.opx-sms-input {
  min-height: 88px;
}

.opx-sms-actions {
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.86fr) minmax(0, 0.86fr);
}

.opx-sms-targets {
  display: grid;
  gap: 6px;
}

.opx-sms-target-row {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 44px;
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
}

.opx-sms-target-row[data-status="found"] {
  border-color: rgba(47, 209, 124, 0.5);
  background: rgba(47, 209, 124, 0.1);
}

.opx-sms-target-row[data-status="error"] {
  border-color: rgba(248, 113, 113, 0.42);
  background: rgba(127, 29, 29, 0.2);
}

.opx-sms-target-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.opx-sms-target-main strong,
.opx-sms-target-main span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.opx-sms-target-main strong {
  color: #e5f7ef;
  font-size: 12px;
  line-height: 16px;
}

.opx-sms-target-main span {
  color: #94a3b8;
  font-size: 11px;
  line-height: 15px;
}

.opx-sms-code-chip {
  box-sizing: border-box;
  min-width: 56px;
  max-width: 92px;
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid rgba(47, 209, 124, 0.44);
  border-radius: 999px;
  background: #182235;
  color: #bbf7d0;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opx-sms-code-chip:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.opx-sms-code-chip.is-copied {
  background: #2fd17c;
  color: #04130a;
}

.opx-sms-table {
  display: grid;
  gap: 5px;
}

.opx-sms-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(64px, 0.8fr) 62px;
  gap: 6px;
  align-items: center;
  min-height: 32px;
  padding: 5px 6px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.58);
}

.opx-sms-table-head {
  min-height: 24px;
  background: transparent;
  border-color: transparent;
  color: #93e4bd;
  font-weight: 700;
}

.opx-sms-table-cell {
  min-width: 0;
  color: #cbd5e1;
  font-size: 11px;
  line-height: 15px;
  overflow-wrap: anywhere;
}

@media (max-height: 640px) {
  .opx-shell {
    top: 12px;
    max-height: calc(100vh - 24px);
  }

  .opx-panel {
    max-height: calc(100vh - 24px);
  }
}
`;

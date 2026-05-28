export function setButtonPending(button: HTMLButtonElement, label = '处理中...'): () => void {
  const originalChildren = Array.from(button.childNodes);
  const originalDisabled = button.disabled;
  button.replaceChildren(document.createTextNode(label));
  button.disabled = true;
  button.classList.add('is-pending');
  button.setAttribute('aria-busy', 'true');
  return () => {
    button.replaceChildren(...originalChildren);
    button.disabled = originalDisabled;
    button.classList.remove('is-pending');
    button.removeAttribute('aria-busy');
  };
}

export async function withButtonPending<T>(
  button: HTMLButtonElement,
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  const restore = setButtonPending(button, label);
  try {
    return await action();
  } finally {
    restore();
  }
}

export function flashButtonLabel(button: HTMLButtonElement, label: string, timeoutMs = 1200): void {
  const originalChildren = Array.from(button.childNodes);
  button.replaceChildren(document.createTextNode(label));
  button.classList.add('is-flashed');
  window.setTimeout(() => {
    button.replaceChildren(...originalChildren);
    button.classList.remove('is-flashed');
  }, timeoutMs);
}

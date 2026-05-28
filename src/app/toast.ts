export type ToastType = 'pending' | 'ok' | 'error' | 'info' | 'warn';

const TOAST_EVENT = 'opx:toast';
const IGNORED_STATUS_MESSAGES = new Set([
  '本地参数已更新',
  '输入内容会自动保存。',
  '正在接码中。',
]);

interface ToastDetail {
  message: string;
  type: ToastType;
  timeoutMs?: number;
}

export function installToastHost(root: ShadowRoot): void {
  const stack = document.createElement('div');
  stack.className = 'opx-toast-stack';
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-atomic', 'false');
  root.append(stack);

  window.addEventListener(TOAST_EVENT, (event) => {
    const detail = (event as CustomEvent<ToastDetail>).detail;
    if (!detail?.message) {
      return;
    }
    renderToast(stack, detail.message, detail.type, detail.timeoutMs);
  });

  observeStatusMessages(root, stack);
}

export function showToast(message: string, type: ToastType = 'ok', timeoutMs?: number): void {
  const text = message.trim();
  if (!text) {
    return;
  }
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, {
    detail: { message: text, type, timeoutMs },
  }));
}

function observeStatusMessages(root: ShadowRoot, stack: HTMLElement): void {
  const lastByElement = new WeakMap<Element, string>();
  const pendingElements = new Set<Element>();

  const scheduleToast = (element: Element) => {
    if (pendingElements.has(element)) {
      return;
    }
    pendingElements.add(element);
    window.queueMicrotask(() => {
      pendingElements.delete(element);
      if ((element as HTMLElement).dataset.toast === 'off') {
        return;
      }
      const message = element.textContent?.trim() || '';
      if (!message || IGNORED_STATUS_MESSAGES.has(message)) {
        return;
      }
      const type = toToastType((element as HTMLElement).dataset.type);
      const tone = classifyTone(message, type);
      (element as HTMLElement).dataset.tone = tone;
      const fingerprint = `${tone}:${message}`;
      if (lastByElement.get(element) === fingerprint) {
        return;
      }
      lastByElement.set(element, fingerprint);
      renderToast(stack, message, tone);
    });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element
        ? record.target
        : record.target.parentElement;
      const status = target?.closest?.('.opx-status');
      if (status && root.contains(status)) {
        scheduleToast(status);
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-type'],
  });
}

function renderToast(stack: HTMLElement, message: string, type: ToastType, timeoutMs?: number): void {
  const text = message.trim();
  if (!text) {
    return;
  }
    const toast = document.createElement('div');
    toast.className = 'opx-toast';
    toast.dataset.type = type;
    toast.dataset.tone = type;
    toast.textContent = text;
    stack.append(toast);

    const timeout = timeoutMs ?? (type === 'pending' ? 2200 : 3600);
    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 180);
    }, timeout);

    while (stack.children.length > 4) {
      stack.firstElementChild?.remove();
    }
}

function toToastType(value: string | undefined): ToastType {
  if (value === 'ok' || value === 'error' || value === 'pending' || value === 'info' || value === 'warn') {
    return value;
  }
  return 'pending';
}

function classifyTone(message: string, type: ToastType): ToastType {
  if (type === 'error') {
    return 'error';
  }
  if (/失败|异常|错误|不能为空|没有|无法|不能|无效|仍不可点击/.test(message)) {
    return 'error';
  }
  if (/正在|等待|生成中|读取|检测|测试|提交|填写|清除|接收/.test(message)) {
    return 'pending';
  }
  if (/未开启|未读取|暂无|需要手动|当前未|暂未|已停止|已切换/.test(message)) {
    return 'warn';
  }
  if (/已复制|已清空|已保存|已下载|已打开|已发送|本地参数|自动填写未开启/.test(message)) {
    return 'info';
  }
  if (type === 'ok') {
    return 'ok';
  }
  return type;
}

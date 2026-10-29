/** Campos em que a tecla é texto digitado ou ajuste de valor; caixas de marcar e opções deixam o atalho passar. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'range', 'color', 'file']);

function isTextField(el: Element): boolean {
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

/** Teclas de atalho só valem para um evento novo, sem modificadores e fora de campos de edição. */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing) return true;
  if (e.ctrlKey || e.altKey || e.metaKey) return true;
  const t = e.target;
  if (t instanceof HTMLElement) {
    if (t.isContentEditable || t.closest('[contenteditable]:not([contenteditable="false"])')) return true;
    const field = t.closest('input, textarea, select');
    if (field && isTextField(field)) return true;
  }
  return false;
}

/** Enter em botão/link já o aciona nativamente; o atalho global não pode agir de novo. */
export function isNativeActivator(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLElement && !!e.target.closest('button, a[href], [role="button"]');
}

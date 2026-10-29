/** Teclas de atalho só valem para um evento novo, sem modificadores e fora de campos de edição. */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing) return true;
  if (e.ctrlKey || e.altKey || e.metaKey) return true;
  const t = e.target;
  if (t instanceof HTMLElement) {
    if (t.isContentEditable || t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
  }
  return false;
}

/** Enter em botão/link já o aciona nativamente; o atalho global não pode agir de novo. */
export function isNativeActivator(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLElement && !!e.target.closest('button, a[href], [role="button"]');
}

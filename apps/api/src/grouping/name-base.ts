/** Sufixos que o backup/cópia acrescenta: " 1", " 12", " (2)", "-1". */
const COPY_SUFFIX = /(?: \(\d{1,2}\)| \d{1,2}|-[1-9])$/;

export function splitExtension(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i).toLowerCase() };
}

export function hasCopySuffix(name: string): boolean {
  const { stem } = splitExtension(name);
  return stem.length > 0 && COPY_SUFFIX.test(stem) && stem.replace(COPY_SUFFIX, '').length > 0;
}

export function baseName(name: string): string {
  const { stem, ext } = splitExtension(name);
  const stripped = hasCopySuffix(name) ? stem.replace(COPY_SUFFIX, '') : stem;
  return stripped.toLowerCase() + ext;
}

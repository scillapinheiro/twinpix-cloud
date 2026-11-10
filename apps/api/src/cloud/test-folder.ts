/**
 * Trava da pasta de teste (TWINPIX_TEST_FOLDER): com ela definida, o app só analisa, move para a
 * lixeira e restaura dentro dessa pasta do OneDrive. Caminhos no formato do app ("/A/B").
 */
export function normalizeTestFolder(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const path = `/${trimmed}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (path === '') throw new Error('TWINPIX_TEST_FOLDER não pode ser a raiz do OneDrive; use uma pasta de teste.');
  return path;
}

// A própria pasta ou algo abaixo dela (sem diferenciar maiúsculas, como o OneDrive).
// Uma única implementação, usada também pelo agrupamento de pastas.
export { isInsideFolder } from '../grouping/folders';

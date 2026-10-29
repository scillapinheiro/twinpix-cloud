import type { CloudItem, RuleCriterion, Suggestion } from '@twinpix/shared';
import { isInsideFolder } from '../grouping/folders';
import { hasCopySuffix } from '../grouping/name-base';

export type RuleFile = Pick<
  CloudItem,
  'id' | 'name' | 'folderPath' | 'size' | 'width' | 'height' | 'takenAt' | 'createdAt' | 'modifiedAt'
>;

export const DEFAULT_RULES: RuleCriterion[] = [
  { type: 'noCopySuffix' },
  { type: 'oldestTaken' },
  { type: 'oldestModified' },
];

export function criterionLabel(c: RuleCriterion): string {
  switch (c.type) {
    case 'largestResolution': return 'maior resolução';
    case 'largestSize': return 'maior tamanho';
    case 'oldestTaken': return 'mais antiga (tirada em)';
    case 'oldestModified': return 'mais antiga (modificada em)';
    case 'inFolder': return `está na pasta ${c.path}`;
    case 'notInFolder': return `não está na pasta ${c.path}`;
    case 'noCopySuffix': return 'nome sem sufixo de cópia';
    case 'deeperFolder': return 'está numa pasta mais organizada (dentro de mais subpastas)';
  }
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN);

/** Quanto maior, melhor. */
function score(c: RuleCriterion, file: RuleFile): number {
  switch (c.type) {
    case 'largestResolution':
      return file.width && file.height ? file.width * file.height : -1;
    case 'largestSize':
      return file.size;
    case 'oldestTaken': {
      const t = time(file.takenAt ?? file.createdAt);
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : -t;
    }
    case 'oldestModified': {
      const t = time(file.modifiedAt);
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : -t;
    }
    case 'inFolder':
      return isInsideFolder(file.folderPath, c.path) ? 1 : 0;
    case 'notInFolder':
      return isInsideFolder(file.folderPath, c.path) ? 0 : 1;
    case 'noCopySuffix':
      return hasCopySuffix(file.name) ? 0 : 1;
    case 'deeperFolder':
      return file.folderPath.split('/').filter(Boolean).length;
  }
}

function alphabetical(a: RuleFile, b: RuleFile): number {
  return a.folderPath.localeCompare(b.folderPath) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function suggestKeep(files: RuleFile[], rules: RuleCriterion[]): Suggestion {
  if (files.length === 0) throw new Error('Grupo vazio.');
  let candidates = [...files];
  for (const rule of rules) {
    const best = Math.max(...candidates.map((f) => score(rule, f)));
    const narrowed = candidates.filter((f) => score(rule, f) === best);
    if (narrowed.length < candidates.length) {
      candidates = narrowed;
      if (candidates.length === 1) {
        return { keepId: candidates[0].id, reason: `regra: ${criterionLabel(rule)}`, fallback: false };
      }
    }
  }
  const first = [...candidates].sort(alphabetical)[0];
  return { keepId: first.id, reason: 'regra: primeira em ordem alfabética', fallback: true };
}

const SIMPLE = new Set(['largestResolution', 'largestSize', 'oldestTaken', 'oldestModified', 'noCopySuffix', 'deeperFolder']);

export function isValidRules(value: unknown): value is RuleCriterion[] {
  if (!Array.isArray(value)) return false;
  return value.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const type = (c as { type?: unknown }).type;
    if (typeof type !== 'string') return false;
    if (SIMPLE.has(type)) return true;
    if (type === 'inFolder' || type === 'notInFolder') {
      const path = (c as { path?: unknown }).path;
      return typeof path === 'string' && path.startsWith('/');
    }
    return false;
  });
}

import type { BatchItem, BatchLine, CloudItem, Suggestion } from '@twinpix/shared';
import { isLikelyResave } from '../grouping/likely-resave';

export interface BatchGroupInput {
  groupId: number;
  kind: 'identical' | 'probable';
  files: CloudItem[];
  suggestion: Suggestion;
  /**
   * Cópia que ficaria se a pasta indicada fosse escolhida (calculada com as regras). Pasta ausente =
   * não dá para escolher (ex.: 2+ cópias nela empatadas, só a ordem alfabética decidiria).
   */
  keepByFolder?: Record<string, string>;
}

const RULE_PREFIX = 'regra: ';
const PROBABLE_REASON = 'nome sem sufixo de cópia';

export function lineKeyOf(keepFolder: string, removeFolders: string[]): string {
  return JSON.stringify([keepFolder, [...removeFolders].sort()]);
}

export function buildBatchLines(groups: BatchGroupInput[]): { lines: BatchLine[]; tiesCount: number } {
  let tiesCount = 0;
  const byKey = new Map<string, BatchLine>();
  const reasons = new Map<string, Set<string>>();

  const ordered = [...groups].sort((a, b) => a.groupId - b.groupId);
  for (const g of ordered) {
    if ((g.kind !== 'identical' && g.kind !== 'probable') || g.files.length < 2) continue;
    const probable = g.kind === 'probable';
    let keepId = g.suggestion.keepId;
    if (probable) {
      // Prováveis: só entram as regravações seguras; a cópia que fica é a do filtro (a sugestão é ignorada).
      const verdict = isLikelyResave(g.files);
      if (!verdict.ok) continue;
      keepId = verdict.keepId;
    } else if (g.suggestion.fallback) {
      tiesCount++;
      continue;
    }
    const keep = g.files.find((f) => f.id === keepId);
    // keepId fora dos arquivos do grupo (grupo mudou): pula de propósito; segue pendente para revisão manual.
    if (!keep) continue;
    const remove = g.files.filter((f) => f.id !== keep.id);
    if (remove.length === 0) continue;

    const removeFolders = [...new Set(remove.map((f) => f.folderPath))].sort();
    const key = lineKeyOf(keep.folderPath, removeFolders);
    let line = byKey.get(key);
    if (!line) {
      line = { key, keepFolder: keep.folderPath, removeFolders, keepOptions: [keep.folderPath, ...removeFolders], reasons: [], groupCount: 0, fileCount: 0, bytes: 0, items: [] };
      byKey.set(key, line);
      reasons.set(key, new Set());
    }
    const rawReason = probable ? PROBABLE_REASON : g.suggestion.reason;
    const reason = rawReason.startsWith(RULE_PREFIX) ? rawReason.slice(RULE_PREFIX.length) : rawReason;
    reasons.get(key)!.add(reason);
    const item: BatchItem = {
      groupId: g.groupId,
      keep,
      remove,
      keepByFolder: probable
        ? { [keep.folderPath]: keep.id }
        : Object.fromEntries(
        [keep.folderPath, ...removeFolders]
          .map((folder): [string, string | undefined] => [folder, g.keepByFolder?.[folder] ?? (folder === keep.folderPath ? keep.id : undefined)])
          .filter((e): e is [string, string] => e[1] !== undefined),
      ),
    };
    line.items.push(item);
    line.groupCount++;
    line.fileCount += remove.length;
    line.bytes += remove.reduce((s, f) => s + f.size, 0);
  }

  const lines = [...byKey.values()];
  for (const l of lines) {
    l.reasons = [...reasons.get(l.key)!].sort();
    // Só oferece trocar para uma pasta se todos os grupos da linha sabem qual cópia ficaria nela.
    l.keepOptions = [l.keepFolder, ...l.removeFolders.filter((folder) => folder !== l.keepFolder && l.items.every((it) => it.keepByFolder[folder] !== undefined))];
  }
  lines.sort((a, b) => b.bytes - a.bytes || b.groupCount - a.groupCount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { lines, tiesCount };
}

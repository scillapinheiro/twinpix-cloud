import type { BatchItem, BatchLine, CloudItem, Suggestion } from '@twinpix/shared';

export interface BatchGroupInput {
  groupId: number;
  kind: 'identical';
  files: CloudItem[];
  suggestion: Suggestion;
  /**
   * Cópia que ficaria se a pasta indicada fosse escolhida (calculada com as regras). Pasta ausente =
   * não dá para escolher (ex.: 2+ cópias nela empatadas, só a ordem alfabética decidiria).
   */
  keepByFolder?: Record<string, string>;
}

const RULE_PREFIX = 'regra: ';

export function lineKeyOf(keepFolder: string, removeFolders: string[]): string {
  return JSON.stringify([keepFolder, [...removeFolders].sort()]);
}

export function buildBatchLines(groups: BatchGroupInput[]): { lines: BatchLine[]; tiesCount: number } {
  let tiesCount = 0;
  const byKey = new Map<string, BatchLine>();
  const reasons = new Map<string, Set<string>>();

  const ordered = [...groups].sort((a, b) => a.groupId - b.groupId);
  for (const g of ordered) {
    if (g.kind !== 'identical' || g.files.length < 2) continue;
    if (g.suggestion.fallback) {
      tiesCount++;
      continue;
    }
    const keep = g.files.find((f) => f.id === g.suggestion.keepId);
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
    const reason = g.suggestion.reason.startsWith(RULE_PREFIX)
      ? g.suggestion.reason.slice(RULE_PREFIX.length)
      : g.suggestion.reason;
    reasons.get(key)!.add(reason);
    const item: BatchItem = {
      groupId: g.groupId,
      keep,
      remove,
      keepByFolder: Object.fromEntries(
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

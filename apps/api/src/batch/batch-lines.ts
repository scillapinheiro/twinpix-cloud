import type { BatchItem, BatchLine, CloudItem, Suggestion } from '@twinpix/shared';

export interface BatchGroupInput {
  groupId: number;
  kind: 'identical';
  files: CloudItem[];
  suggestion: Suggestion;
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
    if (!keep) continue;
    const remove = g.files.filter((f) => f.id !== keep.id);
    if (remove.length === 0) continue;

    const removeFolders = [...new Set(remove.map((f) => f.folderPath))].sort();
    const key = lineKeyOf(keep.folderPath, removeFolders);
    let line = byKey.get(key);
    if (!line) {
      line = { key, keepFolder: keep.folderPath, removeFolders, reasons: [], groupCount: 0, fileCount: 0, bytes: 0, items: [] };
      byKey.set(key, line);
      reasons.set(key, new Set());
    }
    const reason = g.suggestion.reason.startsWith(RULE_PREFIX)
      ? g.suggestion.reason.slice(RULE_PREFIX.length)
      : g.suggestion.reason;
    reasons.get(key)!.add(reason);
    const item: BatchItem = {
      groupId: g.groupId,
      keep: { name: keep.name, folderPath: keep.folderPath },
      remove: remove.map((f) => ({ id: f.id, name: f.name, folderPath: f.folderPath, size: f.size })),
    };
    line.items.push(item);
    line.groupCount++;
    line.fileCount += remove.length;
    line.bytes += remove.reduce((s, f) => s + f.size, 0);
  }

  const lines = [...byKey.values()];
  for (const l of lines) l.reasons = [...reasons.get(l.key)!].sort();
  lines.sort((a, b) => b.bytes - a.bytes || b.groupCount - a.groupCount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { lines, tiesCount };
}

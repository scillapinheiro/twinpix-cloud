import type { CloudItem } from '@twinpix/shared';

export interface IdenticalGroup {
  key: string;
  fileIds: string[];
}

export function groupIdentical(
  files: Array<Pick<CloudItem, 'id' | 'quickXorHash' | 'size'>>,
): IdenticalGroup[] {
  const byKey = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.quickXorHash) continue;
    const key = `${f.quickXorHash}:${f.size}`;
    let ids = byKey.get(key);
    if (!ids) {
      ids = new Set();
      byKey.set(key, ids);
    }
    ids.add(f.id);
  }
  return [...byKey]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => ({ key, fileIds: [...ids].sort() }));
}

import type { CloudItem, FolderCluster, ReconcileItem, ReconcilePlan } from '@twinpix/shared';
import type { FolderGroupInput } from './folder-clusters';

export function planReconcile(
  cluster: FolderCluster,
  keepFolder: string,
  files: CloudItem[],
  groups: FolderGroupInput[],
  pickKeep: (candidates: CloudItem[]) => string,
): ReconcilePlan {
  const set = new Set(cluster.folders.map((f) => f.path));
  if (!set.has(keepFolder)) throw new Error('A pasta escolhida não faz parte deste conjunto.');
  const byId = new Map(files.map((f) => [f.id, f]));

  const items: ReconcileItem[] = [];
  const deleteFiles: CloudItem[] = [];
  for (const g of [...groups].sort((a, b) => a.groupId - b.groupId)) {
    const copies = [...new Set(g.fileIds)].map((id) => byId.get(id)).filter((f): f is CloudItem => !!f);
    const inKeep = copies.filter((f) => f.folderPath === keepFolder);
    const toDelete = copies.filter((f) => f.folderPath !== keepFolder && set.has(f.folderPath));
    if (inKeep.length === 0 || toDelete.length === 0) continue;
    const keepId = pickKeep(inKeep);
    if (!inKeep.some((f) => f.id === keepId)) throw new Error('A cópia a manter precisa estar na pasta escolhida.');
    items.push({ groupId: g.groupId, keepId, deleteIds: toDelete.map((f) => f.id) });
    deleteFiles.push(...toDelete);
  }

  const removedByFolder = new Map<string, number>();
  for (const f of deleteFiles) removedByFolder.set(f.folderPath, (removedByFolder.get(f.folderPath) ?? 0) + 1);
  return {
    clusterKey: cluster.key,
    keepFolder,
    items,
    deleteFiles,
    bytes: deleteFiles.reduce((s, f) => s + f.size, 0),
    remaining: cluster.folders.map((f) => ({ path: f.path, fileCount: f.fileCount - (removedByFolder.get(f.path) ?? 0) })),
  };
}

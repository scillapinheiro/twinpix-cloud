import type { CloudItem, FolderCluster, FolderStat } from '@twinpix/shared';

export interface FolderGroupInput {
  groupId: number;
  fileIds: string[];
}

const depthOf = (p: string): number => p.split('/').filter(Boolean).length;

/** Para cada grupo: pasta -> cópias ativas (só ids conhecidos em `files`). */
function groupsByFolder(files: CloudItem[], groups: FolderGroupInput[]): Array<{ groupId: number; byFolder: Map<string, CloudItem[]> }> {
  const byId = new Map(files.map((f) => [f.id, f]));
  const out: Array<{ groupId: number; byFolder: Map<string, CloudItem[]> }> = [];
  for (const g of groups) {
    const byFolder = new Map<string, CloudItem[]>();
    for (const id of new Set(g.fileIds)) {
      const f = byId.get(id);
      if (!f) continue;
      const list = byFolder.get(f.folderPath);
      if (list) list.push(f);
      else byFolder.set(f.folderPath, [f]);
    }
    out.push({ groupId: g.groupId, byFolder });
  }
  return out;
}

/** Arquivos de `folder` com cópia idêntica em outra pasta de `folders`. */
function repeatedIds(folder: string, folders: Set<string>, gbf: ReturnType<typeof groupsByFolder>): Set<string> {
  const ids = new Set<string>();
  for (const g of gbf) {
    const mine = g.byFolder.get(folder);
    if (!mine) continue;
    for (const other of g.byFolder.keys()) {
      if (other !== folder && folders.has(other)) {
        for (const f of mine) ids.add(f.id);
        break;
      }
    }
  }
  return ids;
}

export function findFolderClusters(files: CloudItem[], groups: FolderGroupInput[]): FolderCluster[] {
  const filesByFolder = new Map<string, CloudItem[]>();
  for (const f of files) {
    const l = filesByFolder.get(f.folderPath);
    if (l) l.push(f);
    else filesByFolder.set(f.folderPath, [f]);
  }
  const gbf = groupsByFolder(files, groups);

  // em comum por par de pastas
  const common = new Map<string, number>();
  const pairKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a]);
  for (const g of gbf) {
    const fs = [...g.byFolder.keys()].sort();
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const k = pairKey(fs[i], fs[j]);
        common.set(k, (common.get(k) ?? 0) + 1);
      }
    }
  }

  // união dos pares candidatos
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const [k, n] of common) {
    const [a, b] = JSON.parse(k) as [string, string];
    const smaller = Math.min(filesByFolder.get(a)!.length, filesByFolder.get(b)!.length);
    if (n < 2 || n * 2 < smaller) continue;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }
  const components = new Map<string, string[]>();
  for (const p of parent.keys()) {
    const r = find(p);
    const l = components.get(r);
    if (l) l.push(p);
    else components.set(r, [p]);
  }

  const clusters: Array<{ cluster: FolderCluster; freeable: number }> = [];
  for (const paths of components.values()) {
    const set = new Set(paths);
    const info = paths.map((path) => {
      const fs = filesByFolder.get(path)!;
      const repeated = repeatedIds(path, set, gbf);
      return { path, fileCount: fs.length, bytes: fs.reduce((s, f) => s + f.size, 0), uniqueCount: fs.length - repeated.size, repeated: repeated.size };
    });
    info.sort((a, b) =>
      b.fileCount - a.fileCount || b.uniqueCount - a.uniqueCount || depthOf(b.path) - depthOf(a.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const complete = info[0].path;

    // quais pastas do conjunto cada pasta cobre (todos os arquivos com cópia nela)
    const folders: FolderStat[] = info.map((i, idx) => {
      let commonWithComplete = 0;
      for (const g of gbf) if (g.byFolder.has(i.path) && g.byFolder.has(complete)) commonWithComplete++;
      let containedIn: string | null = null;
      if (idx > 0 && i.uniqueCount === 0) {
        for (const q of info) {
          if (q.path === i.path) continue;
          const covered = new Set<string>();
          for (const g of gbf) {
            const mine = g.byFolder.get(i.path);
            if (mine && g.byFolder.has(q.path)) for (const f of mine) covered.add(f.id);
          }
          if (covered.size === i.fileCount) { containedIn = q.path; break; }
        }
      }
      const situation: FolderStat['situation'] = idx === 0 ? 'complete' : containedIn ? 'contained' : 'partial';
      return { path: i.path, fileCount: i.fileCount, bytes: i.bytes, uniqueCount: i.uniqueCount, situation, containedIn, commonWithComplete: idx === 0 ? 0 : commonWithComplete };
    });

    let groupCount = 0;
    let freeable = 0;
    for (const g of gbf) {
      const inSet = [...g.byFolder.keys()].filter((p) => set.has(p));
      if (inSet.length >= 2) groupCount++;
      if (g.byFolder.has(complete)) {
        for (const p of inSet) if (p !== complete) for (const f of g.byFolder.get(p)!) freeable += f.size;
      }
    }
    const sorted = [...paths].sort();
    clusters.push({
      freeable,
      cluster: {
        key: JSON.stringify(sorted),
        folders,
        suggestedKeep: complete,
        repeatedFiles: info.reduce((s, i) => s + i.repeated, 0),
        uniqueFiles: info.reduce((s, i) => s + i.uniqueCount, 0),
        groupCount,
      },
    });
  }
  clusters.sort((a, b) => b.freeable - a.freeable || (a.cluster.key < b.cluster.key ? -1 : a.cluster.key > b.cluster.key ? 1 : 0));
  return clusters.map((c) => c.cluster);
}

export function uniqueFilesOf(cluster: FolderCluster, folder: string, files: CloudItem[], groups: FolderGroupInput[]): CloudItem[] {
  const set = new Set(cluster.folders.map((f) => f.path));
  if (!set.has(folder)) throw new Error('Pasta fora do conjunto.');
  const repeated = repeatedIds(folder, set, groupsByFolder(files, groups));
  return files.filter((f) => f.folderPath === folder && !repeated.has(f.id));
}

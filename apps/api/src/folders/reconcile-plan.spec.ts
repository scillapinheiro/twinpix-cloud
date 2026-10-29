import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CloudItem } from '@twinpix/shared';
import { findFolderClusters, uniqueFilesOf } from './folder-clusters';
import { planReconcile } from './reconcile-plan';
import { f } from './test-helpers';

const grp = (groupId: number, ...fileIds: string[]) => ({ groupId, fileIds });
const first = (c: CloudItem[]) => [...c].sort((a, b) => (a.id < b.id ? -1 : 1))[0].id;

describe('planReconcile', () => {
  // /A (organizada): a1 a2 a3(+cópia extra a2x) ; /B contida; /Fora tem cópia fora do conjunto
  const files = [
    f('a1', '/A', 10), f('a2', '/A', 20), f('a2x', '/A', 20), f('a3', '/A', 30),
    f('b1', '/B', 10), f('b2', '/B', 20),
    f('o1', '/Fora', 10),
  ];
  const groups = [grp(1, 'a1', 'b1', 'o1'), grp(2, 'a2', 'a2x', 'b2'), grp(3, 'a3')];

  it('remove só cópias nas outras pastas do conjunto; mantém fora do conjunto e extras na escolhida', () => {
    const [cluster] = findFolderClusters(files, groups);
    expect(cluster.suggestedKeep).toBe('/A');
    const plan = planReconcile(cluster, '/A', files, groups, first);
    expect(plan.items).toEqual([
      { groupId: 1, keepId: 'a1', deleteIds: ['b1'] },
      { groupId: 2, keepId: 'a2', deleteIds: ['b2'] },
    ]);
    expect(plan.deleteFiles.map((x) => x.id)).toEqual(['b1', 'b2']);
    expect(plan.bytes).toBe(30);
    expect(plan.remaining).toEqual([{ path: '/A', fileCount: 4 }, { path: '/B', fileCount: 0 }]);
  });

  it('escolhendo a outra pasta, as cópias saem da /A mas arquivos só da /A ficam', () => {
    const [cluster] = findFolderClusters(files, groups);
    const plan = planReconcile(cluster, '/B', files, groups, first);
    expect(plan.deleteFiles.map((x) => x.id)).toEqual(['a1', 'a2', 'a2x']);
    expect(plan.remaining).toEqual([{ path: '/A', fileCount: 1 }, { path: '/B', fileCount: 2 }]);
  });

  it('pasta fora do conjunto lança erro', () => {
    const [cluster] = findFolderClusters(files, groups);
    expect(() => planReconcile(cluster, '/Fora', files, groups, first)).toThrow();
  });

  it('pickKeep fora da pasta escolhida lança erro', () => {
    const [cluster] = findFolderClusters(files, groups);
    expect(() => planReconcile(cluster, '/A', files, groups, () => 'b1')).toThrow();
  });
});

describe('propriedade: plano nunca apaga o que não deve', () => {
  const FOLDERS = ['/A', '/B', '/C', '/D/E', '/Fora'];
  const groupArb = fc.array(fc.array(fc.constantFrom(...FOLDERS), { minLength: 1, maxLength: 4 }), { minLength: 2, maxLength: 12 });
  const uniquesArb = fc.array(fc.tuple(fc.constantFrom(...FOLDERS), fc.boolean()), { maxLength: 6 });

  it('invariantes e plano não vazio quando esperado', () => {
    let plansWithItems = 0;
    let plansChecked = 0;
    fc.assert(
      fc.property(groupArb, uniquesArb, (gs, uniq) => {
        const files: CloudItem[] = [];
        const groups: Array<{ groupId: number; fileIds: string[] }> = [];
        gs.forEach((folders, i) => {
          const ids = folders.map((p, j) => { const id = `g${i}_${j}`; files.push(f(id, p, 10 + i)); return id; });
          groups.push(grp(i + 1, ...ids));
        });
        uniq.forEach(([p, noHash], i) => files.push(f(`u${i}`, p, 5, noHash ? null : `u${i}`)));
        const byId = new Map(files.map((x) => [x.id, x]));

        for (const cluster of findFolderClusters(files, groups)) {
          const inSet = new Set(cluster.folders.map((x) => x.path));
          for (const keepFolder of inSet) {
            plansChecked++;
            const plan = planReconcile(cluster, keepFolder, files, groups, first);
            const unique = new Set(uniqueFilesOf(cluster, keepFolder, files, groups).map((x) => x.id));
            for (const p of inSet) for (const u of uniqueFilesOf(cluster, p, files, groups)) unique.add(u.id);

            const deleted = new Set<string>();
            for (const item of plan.items) {
              const g = groups.find((x) => x.groupId === item.groupId)!;
              expect(item.deleteIds).not.toContain(item.keepId);
              expect(item.deleteIds.length).toBeGreaterThan(0);
              expect(byId.get(item.keepId)!.folderPath).toBe(keepFolder);
              for (const id of item.deleteIds) {
                const file = byId.get(id)!;
                expect(unique.has(id)).toBe(false);
                expect(inSet.has(file.folderPath)).toBe(true);
                expect(file.folderPath).not.toBe(keepFolder);
                expect(g.fileIds).toContain(id);
                deleted.add(id);
              }
              // o grupo mantém >= 1 cópia
              expect(g.fileIds.filter((id) => !deleted.has(id)).length).toBeGreaterThanOrEqual(1);
            }
            // completude: todo grupo com cópia na escolhida e em outra pasta do conjunto está no plano
            for (const g of groups) {
              const copies = g.fileIds.map((id) => byId.get(id)!);
              const expected = copies.some((c) => c.folderPath === keepFolder) && copies.some((c) => c.folderPath !== keepFolder && inSet.has(c.folderPath));
              expect(plan.items.some((it) => it.groupId === g.groupId)).toBe(expected);
            }
            expect(plan.deleteFiles.map((x) => x.id).sort()).toEqual([...deleted].sort());
            if (plan.items.length > 0) plansWithItems++;
          }
        }
      }),
      { numRuns: 300 },
    );
    expect(plansChecked).toBeGreaterThan(0);
    expect(plansWithItems).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { findFolderClusters, uniqueFilesOf } from './folder-clusters';
import { f } from './test-helpers';

// grupo de idênticas: ids "<n>a","<n>b" ...
const grp = (groupId: number, ...fileIds: string[]) => ({ groupId, fileIds });

describe('findFolderClusters', () => {
  it('par com nomes diferentes e >=2 em comum vira conjunto', () => {
    const files = [f('a1', '/Fotos'), f('a2', '/Fotos'), f('b1', '/Organizada/2015'), f('b2', '/Organizada/2015')];
    const c = findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2')]);
    expect(c).toHaveLength(1);
    expect(c[0].key).toBe(JSON.stringify(['/Fotos', '/Organizada/2015']));
    expect(c[0].groupCount).toBe(2);
    expect(c[0].suggestedKeep).toBe('/Organizada/2015');
  });

  it('só 1 em comum não forma conjunto', () => {
    const files = [f('a1', '/A'), f('b1', '/B')];
    expect(findFolderClusters(files, [grp(1, 'a1', 'b1')])).toEqual([]);
  });

  it('respeita 50% da menor pasta', () => {
    const mk = (nB: number) => {
      const files = [f('a1', '/A'), f('a2', '/A'), f('b1', '/B'), f('b2', '/B')];
      for (let i = 0; i < nB - 2; i++) files.push(f(`bx${i}`, '/B'));
      return findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2')]);
    };
    // menor = A com 2 arquivos: 2 em comum = 100%
    expect(mk(10)).toHaveLength(1);
    // menor com 5 arquivos, 2 em comum = 40% -> não
    const files = ['a1', 'a2', 'a3', 'a4', 'a5'].map((i) => f(i, '/A')).concat([f('b1', '/B'), f('b2', '/B'), f('b3', '/B'), f('b4', '/B'), f('b5', '/B'), f('b6', '/B')]);
    expect(findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2')])).toEqual([]);
    // 3 de 6 = 50% -> sim
    const files2 = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((i) => f(i, '/A')).concat([f('b1', '/B'), f('b2', '/B'), f('b3', '/B'), f('b4', '/B'), f('b5', '/B'), f('b6', '/B'), f('b7', '/B')]);
    expect(findFolderClusters(files2, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2'), grp(3, 'a3', 'b3')])).toHaveLength(1);
  });

  it('3 pastas conectadas viram um conjunto', () => {
    const files = [f('a1', '/A'), f('a2', '/A'), f('b1', '/B'), f('b2', '/B'), f('b3', '/B'), f('b4', '/B'), f('c3', '/C'), f('c4', '/C')];
    const c = findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2'), grp(3, 'b3', 'c3'), grp(4, 'b4', 'c4')]);
    expect(c).toHaveLength(1);
    expect(c[0].folders.map((x) => x.path).sort()).toEqual(['/A', '/B', '/C']);
  });

  it('situações complete / contained / partial e "só nesta pasta" (inclui sem hash)', () => {
    const files = [
      f('a1', '/A'), f('a2', '/A'), f('a3', '/A'), f('a4', '/A'), f('a5', '/A', 100, null), // 5, 1 sem hash
      f('b1', '/B'), f('b2', '/B'), // contida em A
      f('c1', '/C'), f('c2', '/C'), f('c3', '/C'), // parcial: 2 em comum com A + 1 só dela
    ];
    const groups = [grp(1, 'a1', 'b1', 'c1'), grp(2, 'a2', 'b2', 'c2')];
    const [c] = findFolderClusters(files, groups);
    const by = Object.fromEntries(c.folders.map((x) => [x.path, x]));
    expect(by['/A']).toMatchObject({ situation: 'complete', uniqueCount: 3, fileCount: 5 });
    expect(by['/B']).toMatchObject({ situation: 'contained', containedIn: '/A', uniqueCount: 0 });
    expect(by['/C']).toMatchObject({ situation: 'partial', uniqueCount: 1, commonWithComplete: 2 });
    expect(uniqueFilesOf(c, '/A', files, groups).map((x) => x.id).sort()).toEqual(['a3', 'a4', 'a5']);
    expect(uniqueFilesOf(c, '/B', files, groups)).toEqual([]);
  });

  it('cópias duplicadas só dentro da mesma pasta contam como só nesta pasta', () => {
    const files = [f('a1', '/A'), f('a2', '/A'), f('a3', '/A'), f('a4', '/A'), f('b1', '/B'), f('b2', '/B')];
    const groups = [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2'), grp(3, 'a3', 'a4')];
    const [c] = findFolderClusters(files, groups);
    expect(uniqueFilesOf(c, '/A', files, groups).map((x) => x.id)).toEqual(['a3', 'a4']);
  });

  it('desempates da sugestão: mais só nela, depois mais profunda, depois alfabética', () => {
    const base = (pa: string, pb: string, extraA = 0) => {
      const files = [f('a1', pa), f('a2', pa), f('b1', pb), f('b2', pb)];
      for (let i = 0; i < extraA; i++) files.push(f(`ax${i}`, pa), f(`bx${i}`, pb));
      return findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2')])[0];
    };
    expect(base('/Z', '/A/B').suggestedKeep).toBe('/A/B'); // mais profunda
    expect(base('/B', '/A').suggestedKeep).toBe('/A'); // alfabética
    // mais arquivos vence profundidade
    const files = [f('a1', '/A'), f('a2', '/A'), f('a3', '/A'), f('b1', '/X/Y/Z'), f('b2', '/X/Y/Z')];
    expect(findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2')])[0].suggestedKeep).toBe('/A');
    // mesmo nº de arquivos: mais arquivos só nela vence profundidade (A tem 1 só dela, X/Y tem 0)
    const files2 = [f('a1', '/A'), f('a2', '/A'), f('a3', '/A'), f('b1', '/X/Y'), f('b2', '/X/Y'), f('b3', '/X/Y'), f('c3', '/C'), f('c1', '/C'), f('c2', '/C')];
    const groups2 = [grp(1, 'a1', 'b1', 'c1'), grp(2, 'a2', 'b2', 'c2'), grp(3, 'b3', 'c3')];
    const [c2] = findFolderClusters(files2, groups2);
    expect(c2.folders.map((x) => [x.path, x.uniqueCount])).toEqual([['/A', 1], ['/X/Y', 0], ['/C', 0]]);
    expect(c2.suggestedKeep).toBe('/A');
  });

  it('ordena conjuntos por bytes liberáveis desc', () => {
    const files = [
      f('a1', '/A', 10), f('a2', '/A', 10), f('b1', '/B', 10), f('b2', '/B', 10),
      f('c1', '/C', 500), f('c2', '/C', 500), f('d1', '/D', 500), f('d2', '/D', 500),
    ];
    const c = findFolderClusters(files, [grp(1, 'a1', 'b1'), grp(2, 'a2', 'b2'), grp(3, 'c1', 'd1'), grp(4, 'c2', 'd2')]);
    expect(c.map((x) => x.key)).toEqual([JSON.stringify(['/C', '/D']), JSON.stringify(['/A', '/B'])]);
  });
});

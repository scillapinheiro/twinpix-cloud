import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CloudItem } from '@twinpix/shared';
import { buildBatchLines, lineKeyOf, type BatchGroupInput } from './batch-lines';

const f = (id: string, folderPath: string, size = 100): CloudItem => ({
  id, name: `${id}.jpg`, folderPath, size, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: null, createdAt: '2015-01-01T00:00:00Z', modifiedAt: '2015-01-01T00:00:00Z',
  width: 1, height: 1,
} as CloudItem);

const g = (groupId: number, files: CloudItem[], keepId = files[0].id, fallback = false, reason = 'regra: mais antiga (tirada em)'): BatchGroupInput => ({
  groupId, kind: 'identical', files, suggestion: { keepId, reason, fallback },
});

describe('buildBatchLines', () => {
  it('pares de pastas diferentes formam linhas distintas', () => {
    const { lines } = buildBatchLines([
      g(1, [f('a', '/A'), f('b', '/B')]),
      g(2, [f('c', '/A'), f('d', '/C')]),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('mesmo par de pastas soma contagens e bytes', () => {
    const { lines } = buildBatchLines([
      g(2, [f('c', '/A'), f('d', '/B', 50)]),
      g(1, [f('a', '/A'), f('b', '/B', 200)]),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ groupCount: 2, fileCount: 2, bytes: 250, keepFolder: '/A', removeFolders: ['/B'] });
    expect(lines[0].items.map((i) => i.groupId)).toEqual([1, 2]);
    expect(lines[0].reasons).toEqual(['mais antiga (tirada em)']);
    expect(lines[0].key).toBe(lineKeyOf('/A', ['/B']));
  });

  it('cópias em 2 pastas de saída geram removeFolders com as duas', () => {
    const { lines } = buildBatchLines([g(1, [f('a', '/A'), f('b', '/C'), f('c', '/B')])]);
    expect(lines[0].removeFolders).toEqual(['/B', '/C']);
    expect(lines[0].fileCount).toBe(2);
  });

  it('empate vai para tiesCount e grupos inválidos são ignorados', () => {
    const r = buildBatchLines([
      g(1, [f('a', '/A'), f('b', '/B')], 'a', true),
      g(2, [f('a', '/A')]),
      { ...g(3, [f('x', '/A'), f('y', '/B')]), kind: 'similar' as never },
    ]);
    expect(r).toEqual({ lines: [], tiesCount: 1 });
  });

  it('grupo cujo keepId não está nos arquivos é pulado (intencional)', () => {
    const r = buildBatchLines([g(1, [f('a', '/A'), f('b', '/B')], 'zzz')]);
    expect(r).toEqual({ lines: [], tiesCount: 0 });
  });

  it('ordena por bytes desc, groupCount desc, key', () => {
    const { lines } = buildBatchLines([
      g(1, [f('a', '/A'), f('b', '/B', 10)]),
      g(2, [f('c', '/C'), f('d', '/D', 500)]),
      g(3, [f('e', '/E'), f('h', '/F', 10)]),
      g(4, [f('i', '/E'), f('j', '/F', 0)]),
    ]);
    expect(lines.map((l) => l.keepFolder)).toEqual(['/C', '/E', '/A']);
  });

  it('propriedade: mantém exatamente o keepId e remove só os outros', () => {
    const arb = fc.array(
      fc.record({
        folders: fc.array(fc.constantFrom('/A', '/B', '/C'), { minLength: 2, maxLength: 5 }),
        keepIdx: fc.nat(10),
        fallback: fc.boolean(),
      }),
      { maxLength: 8 },
    );
    fc.assert(fc.property(arb, (specs) => {
      const groups = specs.map((s, i) => {
        const files = s.folders.map((p, j) => f(`g${i}f${j}`, p, j + 1));
        return g(i, files, files[s.keepIdx % files.length].id, s.fallback);
      });
      const { lines, tiesCount } = buildBatchLines(groups);
      expect(tiesCount).toBe(groups.filter((x) => x.suggestion.fallback).length);
      const expectedIds = groups.filter((x) => !x.suggestion.fallback).map((x) => x.groupId).sort((x, y) => x - y);
      const seenIds = lines.flatMap((l) => l.items.map((i) => i.groupId)).sort((x, y) => x - y);
      expect(seenIds).toEqual(expectedIds);
      for (const line of lines) {
        expect(line.groupCount).toBe(line.items.length);
        expect(line.fileCount).toBe(line.items.reduce((n, i) => n + i.remove.length, 0));
        expect(line.bytes).toBe(line.items.reduce((n, i) => n + i.remove.reduce((m, r) => m + r.size, 0), 0));
        for (const item of line.items) {
          const src = groups.find((x) => x.groupId === item.groupId)!;
          const keep = src.files.find((x) => x.id === src.suggestion.keepId)!;
          const removeIds = item.remove.map((r) => r.id);
          expect(item.keep).toEqual({ name: `${keep.id}.jpg`, folderPath: keep.folderPath });
          expect(line.keepFolder).toBe(keep.folderPath);
          expect(src.suggestion.fallback).toBe(false);
          expect(removeIds).not.toContain(keep.id);
          expect(removeIds.length).toBe(src.files.length - 1);
          expect([...removeIds].sort()).toEqual(src.files.filter((x) => x.id !== keep.id).map((x) => x.id).sort());
        }
      }
    }));
  });
});

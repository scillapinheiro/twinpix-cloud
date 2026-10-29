import fc from 'fast-check';
import type { CloudItem } from '@twinpix/shared';
import { describe, expect, it } from 'vitest';
import { baseName } from './name-base';
import { groupProbable } from './group-probable';

const T = '2015-06-07T10:00:00Z';

function item(over: Partial<CloudItem> & { id: string; name: string }): CloudItem {
  return {
    folderPath: '/',
    size: 10,
    quickXorHash: `h-${over.id}`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    takenAt: T,
    createdAt: T,
    modifiedAt: T,
    width: 100,
    height: 50,
    cameraMake: null,
    cameraModel: null,
    durationMs: null,
    webUrl: '',
    ...over,
  };
}

function video(id: string, durationMs: number | null, over: Partial<CloudItem> = {}): CloudItem {
  return item({ id, name: 'filme.mp4', kind: 'video', mimeType: 'video/mp4', durationMs, ...over });
}

describe('groupProbable', () => {
  it('agrupa nome e nome 1 com hashes diferentes', () => {
    const g = groupProbable([item({ id: 'a', name: 'nome.jpg' }), item({ id: 'b', name: 'nome 1.jpg' })]);
    expect(g).toHaveLength(1);
    expect(g[0].fileIds).toEqual(['a', 'b']);
    expect(g[0].key).toBe(`p:photo:nome.jpg:100x50:${T}`);
  });

  it('dimensões diferentes não agrupam', () => {
    expect(
      groupProbable([item({ id: 'a', name: 'n.jpg' }), item({ id: 'b', name: 'n 1.jpg', width: 101 })]),
    ).toEqual([]);
  });

  it('takenAt diferente ou nulo não agrupa', () => {
    expect(
      groupProbable([item({ id: 'a', name: 'n.jpg' }), item({ id: 'b', name: 'n 1.jpg', takenAt: '2016-01-01T00:00:00Z' })]),
    ).toEqual([]);
    expect(
      groupProbable([item({ id: 'a', name: 'n.jpg', takenAt: null }), item({ id: 'b', name: 'n 1.jpg', takenAt: null })]),
    ).toEqual([]);
  });

  it('dimensões nulas não agrupam', () => {
    expect(
      groupProbable([
        item({ id: 'a', name: 'n.jpg', width: null, height: null }),
        item({ id: 'b', name: 'n 1.jpg', width: null, height: null }),
      ]),
    ).toEqual([]);
  });

  it('todos com o mesmo hash não agrupam', () => {
    expect(
      groupProbable([
        item({ id: 'a', name: 'n.jpg', quickXorHash: 'x' }),
        item({ id: 'b', name: 'n 1.jpg', quickXorHash: 'x' }),
      ]),
    ).toEqual([]);
  });

  it('hash ausente em algum conta como conteúdo diferente', () => {
    const g = groupProbable([
      item({ id: 'a', name: 'n.jpg', quickXorHash: 'x' }),
      item({ id: 'b', name: 'n 1.jpg', quickXorHash: null }),
    ]);
    expect(g).toHaveLength(1);
  });

  it('nome (2) e NOME-1.JPG entram', () => {
    const g = groupProbable([
      item({ id: 'a', name: 'nome.jpg' }),
      item({ id: 'b', name: 'nome (2).jpg' }),
      item({ id: 'c', name: 'NOME-1.jpg' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].fileIds).toEqual(['a', 'b', 'c']);
  });

  it('nomes legítimos que não são sufixo não juntam', () => {
    expect(
      groupProbable([
        item({ id: 'a', name: 'foto.jpg' }),
        item({ id: 'b', name: 'foto-10.jpg' }),
        item({ id: 'c', name: 'Viagem 2015.jpg' }),
        item({ id: 'd', name: 'Viagem.jpg' }),
      ]),
    ).toEqual([]);
  });

  it('vídeos a 800 ms agrupam; a 2000 ms não', () => {
    expect(groupProbable([video('a', 31000), video('b', 31800)])).toHaveLength(1);
    expect(groupProbable([video('a', 31000), video('b', 33000)])).toEqual([]);
  });

  it('vídeo sem duração não agrupa', () => {
    expect(groupProbable([video('a', null), video('b', null)])).toEqual([]);
  });

  it('cadeia 31000/31900/32800 forma um grupo só', () => {
    const g = groupProbable([video('a', 31000), video('b', 31900), video('c', 32800)]);
    expect(g).toHaveLength(1);
    expect(g[0].fileIds).toEqual(['a', 'b', 'c']);
  });

  it('diferença > 1000 ms inicia novo grupo, com chaves distintas', () => {
    const g = groupProbable([
      video('a', 1000),
      video('b', 1500),
      video('c', 5000),
      video('d', 5200),
    ]);
    expect(g.map((x) => x.fileIds)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(g.map((x) => x.key)).toEqual([
      `p:video:filme.mp4:100x50:${T}:a`,
      `p:video:filme.mp4:100x50:${T}:c`,
    ]);
  });

  it('inserir um vídeo isolado abaixo de uma cadeia não muda a chave dela', () => {
    const chain = [video('b', 5000), video('c', 5500)];
    const before = groupProbable(chain);
    const after = groupProbable([...chain, video('a', 1000)]);
    expect(after).toEqual(before);
    expect(before[0].key).toBe(`p:video:filme.mp4:100x50:${T}:b`);
  });

  it('fotos e vídeos com o mesmo nome-base não se misturam', () => {
    expect(
      groupProbable([
        item({ id: 'a', name: 'x.mp4' }),
        item({ id: 'b', name: 'x 1.mp4', kind: 'video', durationMs: 1000 }),
      ]),
    ).toEqual([]);
  });

  it('o mesmo id repetido não vira cópia de si mesmo', () => {
    expect(
      groupProbable([item({ id: 'a', name: 'n.jpg' }), item({ id: 'a', name: 'n.jpg' })]),
    ).toEqual([]);
  });

  it('propriedade: todo grupo é coerente e as entradas geram grupos', () => {
    const arb = fc.array(
      fc.record({
        id: fc.integer({ min: 0, max: 30 }),
        name: fc.constantFrom('a.jpg', 'a 1.jpg', 'A (2).JPG', 'a-1.jpg', 'b.jpg', 'b 1.jpg', 'a.mp4', 'a 1.mp4'),
        hash: fc.constantFrom('h1', 'h2', 'h3', null, ''),
        w: fc.constantFrom(1, 2),
        taken: fc.constantFrom(T, 'T2', null),
        dur: fc.constantFrom(0, 500, 1400, 3000, null),
      }),
      { maxLength: 40 },
    );
    let total = 0;
    fc.assert(
      fc.property(arb, (rows) => {
        const files = rows.map((r) =>
          item({
            id: `i${r.id}`,
            name: r.name,
            quickXorHash: r.hash,
            width: r.w,
            takenAt: r.taken,
            kind: r.name.endsWith('.mp4') ? 'video' : 'photo',
            durationMs: r.dur,
          }),
        );
        const byId = new Map<string, CloudItem>();
        for (const f of files) if (!byId.has(f.id)) byId.set(f.id, f); // ids repetidos: vale a primeira ocorrência
        const groups = groupProbable(files);
        total += groups.length;
        for (const g of groups) {
          expect(new Set(g.fileIds).size).toBe(g.fileIds.length);
          expect(g.fileIds.length).toBeGreaterThanOrEqual(2);
          const ms = g.fileIds.map((id) => byId.get(id) as CloudItem);
          const first = ms[0];
          for (const m of ms) {
            expect(m.kind).toBe(first.kind);
            expect(baseName(m.name)).toBe(baseName(first.name));
            expect(m.width).toBe(first.width);
            expect(m.height).toBe(first.height);
            expect(m.takenAt).not.toBeNull();
            expect(m.takenAt).toBe(first.takenAt);
          }
          const hashes = new Set(ms.map((m) => m.quickXorHash || null));
          expect(hashes.size >= 2 || hashes.has(null)).toBe(true);
          if (first.kind === 'video') {
            const durs = ms.map((m) => m.durationMs);
            for (const d of durs) expect(d).not.toBeNull();
            const sorted = (durs as number[]).sort((x, y) => x - y);
            for (let i = 1; i < sorted.length; i++) {
              expect(sorted[i] - sorted[i - 1]).toBeLessThanOrEqual(1000);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
    expect(total).toBeGreaterThan(0);
  });
});

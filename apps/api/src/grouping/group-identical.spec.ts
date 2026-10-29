import { describe, expect, it } from 'vitest';
import { groupIdentical } from './group-identical';

describe('groupIdentical', () => {
  it('agrupa por hash e tamanho', () => {
    const groups = groupIdentical([
      { id: 'a', quickXorHash: 'h1', size: 10 },
      { id: 'b', quickXorHash: 'h1', size: 10 },
      { id: 'c', quickXorHash: 'h2', size: 10 },
    ]);
    expect(groups).toEqual([{ key: 'h1:10', fileIds: ['a', 'b'] }]);
  });

  it('não agrupa mesmo hash com tamanho diferente', () => {
    expect(
      groupIdentical([
        { id: 'a', quickXorHash: 'h1', size: 10 },
        { id: 'b', quickXorHash: 'h1', size: 11 },
      ]),
    ).toEqual([]);
  });

  it('ignora arquivos sem hash', () => {
    expect(
      groupIdentical([
        { id: 'a', quickXorHash: null, size: 10 },
        { id: 'b', quickXorHash: null, size: 10 },
      ]),
    ).toEqual([]);
  });

  it('o mesmo arquivo visto duas vezes (pastas sobrepostas) não vira cópia de si mesmo', () => {
    expect(
      groupIdentical([
        { id: 'a', quickXorHash: 'h1', size: 10 },
        { id: 'a', quickXorHash: 'h1', size: 10 },
      ]),
    ).toEqual([]);
  });
});

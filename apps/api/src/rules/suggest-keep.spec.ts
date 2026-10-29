import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, isValidRules, suggestKeep, type RuleFile } from './suggest-keep';

const f = (over: Partial<RuleFile> & { id: string }): RuleFile => ({
  name: `${over.id}.jpg`,
  folderPath: '/Imagens',
  size: 100,
  width: 100,
  height: 100,
  takenAt: '2015-01-01T00:00:00Z',
  createdAt: '2015-01-01T00:00:00Z',
  modifiedAt: '2015-01-01T00:00:00Z',
  ...over,
});

describe('suggestKeep', () => {
  it('aplica o primeiro critério que desempata e informa o motivo', () => {
    const s = suggestKeep(
      [f({ id: 'a', width: 100, height: 100 }), f({ id: 'b', width: 200, height: 200 })],
      [{ type: 'largestResolution' }, { type: 'oldestTaken' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: maior resolução' });
  });

  it('pula critério empatado e usa o próximo', () => {
    const s = suggestKeep(
      [f({ id: 'a', takenAt: '2016-01-01T00:00:00Z' }), f({ id: 'b', takenAt: '2015-01-01T00:00:00Z' })],
      [{ type: 'largestResolution' }, { type: 'oldestTaken' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: mais antiga (tirada em)' });
  });

  it('sem data em que foi tirada, usa a data de criação', () => {
    const s = suggestKeep(
      [f({ id: 'a', takenAt: null, createdAt: '2014-01-01T00:00:00Z' }), f({ id: 'b' })],
      [{ type: 'oldestTaken' }],
    );
    expect(s.keepId).toBe('a');
  });

  it('prefere nome sem sufixo de cópia', () => {
    const s = suggestKeep([f({ id: 'a', name: 'x 1.jpg' }), f({ id: 'b', name: 'x.jpg' })], DEFAULT_RULES);
    expect(s).toEqual({ keepId: 'b', reason: 'regra: nome sem sufixo de cópia' });
  });

  it('está na pasta X / não está na pasta Y', () => {
    const files = [f({ id: 'a', folderPath: '/Backup/2015' }), f({ id: 'b', folderPath: '/Fotos' })];
    expect(suggestKeep(files, [{ type: 'inFolder', path: '/Fotos' }])).toEqual({
      keepId: 'b',
      reason: 'regra: está na pasta /Fotos',
    });
    expect(suggestKeep(files, [{ type: 'notInFolder', path: '/Fotos' }]).keepId).toBe('a');
  });

  it('maior tamanho e mais antiga (modificada em)', () => {
    expect(suggestKeep([f({ id: 'a', size: 1 }), f({ id: 'b', size: 2 })], [{ type: 'largestSize' }]).keepId).toBe('b');
    expect(
      suggestKeep(
        [f({ id: 'a', modifiedAt: '2020-01-01T00:00:00Z' }), f({ id: 'b', modifiedAt: '2019-01-01T00:00:00Z' })],
        [{ type: 'oldestModified' }],
      ).keepId,
    ).toBe('b');
  });

  it('empate total: primeira em ordem alfabética de pasta e nome', () => {
    const s = suggestKeep([f({ id: 'b', folderPath: '/Z' }), f({ id: 'a', folderPath: '/A' })], DEFAULT_RULES);
    expect(s).toEqual({ keepId: 'a', reason: 'regra: primeira em ordem alfabética' });
  });

  it('propriedade: sempre devolve um arquivo do grupo', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1000 }),
        (ids, seed) => {
          const files = ids.map((id, i) => f({ id, size: (seed * (i + 1)) % 7 }));
          const s = suggestKeep(files, [{ type: 'largestSize' }, ...DEFAULT_RULES]);
          return ids.includes(s.keepId);
        },
      ),
    );
  });
});

describe('isValidRules', () => {
  it('aceita lista válida e recusa formato errado', () => {
    expect(isValidRules([{ type: 'inFolder', path: '/A' }, { type: 'oldestTaken' }])).toBe(true);
    expect(isValidRules([{ type: 'inFolder' }])).toBe(false);
    expect(isValidRules([{ type: 'qualquer' }])).toBe(false);
    expect(isValidRules('x')).toBe(false);
  });
});

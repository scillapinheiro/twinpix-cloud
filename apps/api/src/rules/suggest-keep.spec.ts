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
  it('fallback é true só no empate total (ordem alfabética)', () => {
    const tie = suggestKeep([f({ id: 'a' }), f({ id: 'b' })], DEFAULT_RULES);
    expect(tie.fallback).toBe(true);
    expect(tie.reason).toBe('regra: primeira em ordem alfabética');
    expect(suggestKeep([f({ id: 'a', size: 1 }), f({ id: 'b', size: 2 })], [{ type: 'largestSize' }]).fallback).toBe(false);
  });

  it('aplica o primeiro critério que desempata e informa o motivo', () => {
    const s = suggestKeep(
      [f({ id: 'a', width: 100, height: 100 }), f({ id: 'b', width: 200, height: 200 })],
      [{ type: 'largestResolution' }, { type: 'oldestTaken' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: maior resolução', fallback: false });
  });

  it('pula critério empatado e usa o próximo', () => {
    const s = suggestKeep(
      [f({ id: 'a', takenAt: '2016-01-01T00:00:00Z' }), f({ id: 'b', takenAt: '2015-01-01T00:00:00Z' })],
      [{ type: 'largestResolution' }, { type: 'oldestTaken' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: mais antiga (tirada em)', fallback: false });
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
    expect(s).toEqual({ keepId: 'b', reason: 'regra: nome sem sufixo de cópia', fallback: false });
  });

  it('está na pasta X / não está na pasta Y', () => {
    const files = [f({ id: 'a', folderPath: '/Backup/2015' }), f({ id: 'b', folderPath: '/Fotos' })];
    expect(suggestKeep(files, [{ type: 'inFolder', path: '/Fotos' }])).toEqual({
      keepId: 'b',
      reason: 'regra: está na pasta /Fotos',
      fallback: false,
    });
    expect(suggestKeep(files, [{ type: 'notInFolder', path: '/Fotos' }]).keepId).toBe('a');
  });

  it('regra de pasta ignora maiúsculas e minúsculas', () => {
    const files = [f({ id: 'a', folderPath: '/Backup/2015' }), f({ id: 'b', folderPath: '/Imagens/Viagem/2020' })];
    expect(suggestKeep(files, [{ type: 'inFolder', path: '/imagens/viagem' }]).keepId).toBe('b');
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
    expect(s).toEqual({ keepId: 'a', reason: 'regra: primeira em ordem alfabética', fallback: true });
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

describe('deeperFolder', () => {
  it('vence quem está em mais subpastas e informa o motivo', () => {
    const s = suggestKeep(
      [f({ id: 'a', folderPath: '/Imagens' }), f({ id: 'b', folderPath: '/Imagens/Viagem/2019' }), f({ id: 'c', folderPath: '/Imagens/Viagem' })],
      [{ type: 'deeperFolder' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: está numa pasta mais organizada (dentro de mais subpastas)', fallback: false });
  });

  it('raiz tem zero segmentos e é aceita pela validação', () => {
    const s = suggestKeep([f({ id: 'a', folderPath: '/' }), f({ id: 'b', folderPath: '/X' })], [{ type: 'deeperFolder' }]);
    expect(s.keepId).toBe('b');
    expect(isValidRules([{ type: 'deeperFolder' }])).toBe(true);
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

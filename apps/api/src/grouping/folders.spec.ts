import { describe, expect, it } from 'vitest';
import { findNestedRoots, isInsideFolder } from './folders';

describe('isInsideFolder', () => {
  it('considera a própria pasta e subpastas', () => {
    expect(isInsideFolder('/A', '/A')).toBe(true);
    expect(isInsideFolder('/A/B', '/A')).toBe(true);
    expect(isInsideFolder('/AB', '/A')).toBe(false);
    expect(isInsideFolder('/qualquer', '/')).toBe(true);
  });

  it('ignora maiúsculas e minúsculas', () => {
    expect(isInsideFolder('/Imagens/Viagem/2020', '/imagens/viagem')).toBe(true);
    expect(findNestedRoots(['/Fotos', '/fotos/a'])).toEqual([{ inner: '/fotos/a', outer: '/Fotos' }]);
  });
});

describe('findNestedRoots', () => {
  it('aponta pasta escolhida que está dentro de outra escolhida', () => {
    expect(findNestedRoots(['/Minhas imagens', '/Minhas imagens/minhas fotos', '/Outra'])).toEqual([
      { inner: '/Minhas imagens/minhas fotos', outer: '/Minhas imagens' },
    ]);
  });

  it('não confunde prefixo de nome com subpasta', () => {
    expect(findNestedRoots(['/Fotos', '/Fotos antigas'])).toEqual([]);
  });
});

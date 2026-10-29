import { describe, expect, it } from 'vitest';
import { baseName, hasCopySuffix } from './name-base';

describe('hasCopySuffix', () => {
  it.each([
    'nome 1.jpg',
    'nome (2).jpg',
    'nome-1.jpg',
    '20150206_222631_LLS 1.jpg',
    'VID_20160101 12.mp4',
  ])('reconhece sufixo de cópia em %s', (name) => {
    expect(hasCopySuffix(name)).toBe(true);
  });

  it.each([
    'nome.jpg',
    'Viagem 2015.jpg',
    'IMG-20150206-WA0001.jpg',
    'DSC_0001.JPG',
    'foto-10.jpg',
    'foto-12.jpg',
    '20150206_222631_LLS.jpg',
    '.jpg',
  ])('não confunde nome legítimo com cópia: %s', (name) => {
    expect(hasCopySuffix(name)).toBe(false);
  });
});

describe('baseName', () => {
  it('remove o sufixo e normaliza maiúsculas e extensão', () => {
    expect(baseName('Nome 1.JPG')).toBe('nome.jpg');
    expect(baseName('nome (2).jpg')).toBe('nome.jpg');
    expect(baseName('nome-1.jpg')).toBe('nome.jpg');
    expect(baseName('nome.jpg')).toBe('nome.jpg');
  });

  it('mantém nomes sem sufixo', () => {
    expect(baseName('IMG-20150206-WA0001.jpg')).toBe('img-20150206-wa0001.jpg');
  });
});

import { filePath, formatBytes, formatCamera, formatDate, formatDimensions, formatDuration } from './format';

it('formata bytes em pt-BR', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(2_100_000_000)).toBe('2,1 GB');
  expect(formatBytes(2_481_234)).toBe('2,5 MB');
  expect(formatBytes(800)).toBe('800 B');
});

it('formata data, câmera, dimensões e duração', () => {
  expect(formatDate(null)).toBe('—');
  expect(formatDate('2015-02-06T22:26:31Z')).toMatch(/06\/02\/2015/);
  expect(formatCamera('samsung', 'SM-G900M')).toBe('samsung SM-G900M');
  expect(formatCamera(null, null)).toBe('—');
  expect(formatDimensions(4128, 2322)).toBe('4128 × 2322');
  expect(formatDimensions(null, null)).toBe('—');
  expect(formatDuration(31_000)).toBe('0:31');
  expect(formatDuration(null)).toBe('—');
});

it('caminho do arquivo sem barra dupla', () => {
  expect(filePath('/', 'a.jpg')).toBe('/a.jpg');
  expect(filePath('', 'a.jpg')).toBe('/a.jpg');
  expect(filePath('/Fotos', 'a.jpg')).toBe('/Fotos/a.jpg');
  expect(filePath('/Fotos/', 'a.jpg')).toBe('/Fotos/a.jpg');
});

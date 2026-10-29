import { describe, expect, it } from 'vitest';
import type { CloudItem } from '@twinpix/shared';
import { isLikelyResave } from './likely-resave';

const f = (id: string, name: string, over: Partial<CloudItem> = {}): CloudItem => ({
  id, name, folderPath: '/A', size: 1000, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: '2015-01-01T10:00:00Z', createdAt: '2015-01-01T00:00:00Z', modifiedAt: '2015-01-01T00:00:00Z',
  width: 4000, height: 3000, cameraMake: 'Canon', cameraModel: 'EOS', durationMs: null, webUrl: '',
  ...over,
});

describe('isLikelyResave', () => {
  it('par com 1% de diferença: ok e fica a sem sufixo', () => {
    expect(isLikelyResave([f('b', 'x 1.jpg', { size: 1010 }), f('a', 'x.jpg')])).toEqual({ ok: true, keepId: 'a' });
  });
  it('5% de diferença: não', () => {
    expect(isLikelyResave([f('a', 'x.jpg'), f('b', 'x 1.jpg', { size: 1050 })]).ok).toBe(false);
  });
  it('câmera diferente: não', () => {
    expect(isLikelyResave([f('a', 'x.jpg'), f('b', 'x 1.jpg', { cameraModel: 'Outra' })]).ok).toBe(false);
  });
  it('câmera nula nas duas conta como igual', () => {
    const n = { cameraMake: null, cameraModel: null };
    expect(isLikelyResave([f('a', 'x.jpg', n), f('b', 'x 1.jpg', n)]).ok).toBe(true);
  });
  it('dois sem sufixo: não', () => {
    expect(isLikelyResave([f('a', 'x.jpg'), f('b', 'y.jpg')]).ok).toBe(false);
  });
  it('nenhum sem sufixo: não', () => {
    expect(isLikelyResave([f('a', 'x 1.jpg'), f('b', 'x 2.jpg')]).ok).toBe(false);
  });
  it('dimensões diferentes ou nulas: não', () => {
    expect(isLikelyResave([f('a', 'x.jpg'), f('b', 'x 1.jpg', { width: 2000 })]).ok).toBe(false);
    expect(isLikelyResave([f('a', 'x.jpg', { width: null }), f('b', 'x 1.jpg', { width: null })]).ok).toBe(false);
  });
  it('takenAt diferente ou nulo: não', () => {
    expect(isLikelyResave([f('a', 'x.jpg'), f('b', 'x 1.jpg', { takenAt: '2016-01-01T10:00:00Z' })]).ok).toBe(false);
    expect(isLikelyResave([f('a', 'x.jpg', { takenAt: null }), f('b', 'x 1.jpg', { takenAt: null })]).ok).toBe(false);
  });
  it('vídeo com 1,5 s de diferença: não; 1 s: ok; duração nula: não', () => {
    const v = (id: string, name: string, durationMs: number | null) => f(id, name, { kind: 'video', durationMs });
    expect(isLikelyResave([v('a', 'x.mp4', 10000), v('b', 'x 1.mp4', 11500)]).ok).toBe(false);
    expect(isLikelyResave([v('a', 'x.mp4', 10000), v('b', 'x 1.mp4', 11000)]).ok).toBe(true);
    expect(isLikelyResave([v('a', 'x.mp4', 10000), v('b', 'x 1.mp4', null)]).ok).toBe(false);
  });
  it('tipos misturados ou menos de 2: não', () => {
    expect(isLikelyResave([f('a', 'x.jpg'), f('b', 'x 1.mp4', { kind: 'video', durationMs: 5 })]).ok).toBe(false);
    expect(isLikelyResave([f('a', 'x.jpg')]).ok).toBe(false);
  });
  it('3 cópias (1 sem sufixo + 2 com) dentro dos limites: ok', () => {
    expect(isLikelyResave([f('b', 'x 1.jpg', { size: 1005 }), f('a', 'x.jpg'), f('c', 'x 2.jpg', { size: 1015 })])).toEqual({ ok: true, keepId: 'a' });
  });
});

import { describe, expect, it } from 'vitest';
import { combineListings, computeListingStats, type LsjsonItem } from './listing-stats';

const it1 = (p: string, size: number, h?: string, mime = 'image/jpeg'): LsjsonItem => ({
  Path: p,
  Size: size,
  MimeType: mime,
  Hashes: h ? { quickxor: h } : undefined,
});

describe('computeListingStats', () => {
  it('counts media, groups, extras, bytes and missing hashes', () => {
    const s = computeListingStats([
      it1('a/1.jpg', 100, 'H1'),
      it1('b/1copy.jpg', 100, 'H1'),
      it1('c/1c2.jpg', 100, 'H1'),
      it1('a/2.jpg', 50, 'H2'),
      it1('a/v.mp4', 900, 'H3', 'video/mp4'),
      it1('b/v.mp4', 900, 'H3', 'video/mp4'),
      it1('a/nohash.jpg', 10),
      it1('a/notes.txt', 5, 'H9', 'text/plain'),
      { Path: 'a', Size: 0, IsDir: true },
    ]);
    expect(s).toEqual({
      files: 7,
      photos: 5,
      videos: 2,
      identicalGroups: 2,
      extraCopies: 3,
      bytesFreeable: 200 + 900,
      withoutHash: 1,
    });
  });

  it('falls back to extension when MIME is missing', () => {
    const s = computeListingStats([{ Path: 'x.HEIC', Size: 1 }, { Path: 'y.mov', Size: 1 }]);
    expect(s.photos).toBe(1);
    expect(s.videos).toBe(1);
  });
});

describe('combineListings', () => {
  it('keeps same-named files from different listings distinct', () => {
    const combined = combineListings([[it1('x/a.jpg', 7, 'H')], [it1('x/a.jpg', 7, 'H')]]);
    const s = computeListingStats(combined);
    expect(s.files).toBe(2);
    expect(s.identicalGroups).toBe(1);
    expect(s.extraCopies).toBe(1);
  });
});

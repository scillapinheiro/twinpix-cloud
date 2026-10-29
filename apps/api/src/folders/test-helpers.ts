import type { CloudItem } from '@twinpix/shared';

export const f = (id: string, folderPath: string, size = 100, hash: string | null = 'h'): CloudItem => ({
  id, name: `${id}.jpg`, folderPath, size, quickXorHash: hash, mimeType: 'image/jpeg', kind: 'photo',
  takenAt: null, createdAt: '2015-01-01T00:00:00Z', modifiedAt: '2015-01-01T00:00:00Z',
  width: 1, height: 1,
} as CloudItem);

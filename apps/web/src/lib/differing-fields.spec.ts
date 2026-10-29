import type { CloudItem } from '@twinpix/shared';
import { differingFields, fieldValue } from './differing-fields';

const item = (over: Partial<CloudItem>): CloudItem => ({
  id: 'x', name: 'a.jpg', folderPath: '/A', size: 100, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: '2015-02-06T22:26:31Z', createdAt: '2015-02-06T22:26:31Z', modifiedAt: '2015-02-07T10:00:00Z',
  width: 10, height: 10, cameraMake: 'Canon', cameraModel: 'A530', durationMs: null, webUrl: '', ...over,
});

it('aponta só os campos que mudam entre as cópias', () => {
  const d = differingFields([item({ id: '1' }), item({ id: '2', name: 'a 1.jpg', modifiedAt: '2015-04-21T19:30:00Z' })]);
  expect([...d].sort()).toEqual(['modifiedAt', 'name']);
});

it('duração só conta para vídeos', () => {
  expect(fieldValue(item({}), 'duration')).toBe('—');
  expect(fieldValue(item({ kind: 'video', durationMs: 31_000 }), 'duration')).toBe('0:31');
});

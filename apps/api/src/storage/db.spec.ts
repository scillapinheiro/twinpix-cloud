import type { CloudItem } from '@twinpix/shared';
import { describe, expect, it } from 'vitest';
import { Db } from './db';
import { getFilesByIds, insertFile } from './rows';

export const sampleItem = (over: Partial<CloudItem> = {}): CloudItem => ({
  id: 'f1',
  name: 'foto.jpg',
  folderPath: '/Imagens',
  size: 1000,
  quickXorHash: 'h1',
  mimeType: 'image/jpeg',
  kind: 'photo',
  takenAt: '2015-02-06T22:26:31Z',
  createdAt: '2015-02-07T10:00:00Z',
  modifiedAt: '2015-02-07T10:00:00Z',
  width: 4000,
  height: 3000,
  cameraMake: 'Samsung',
  cameraModel: 'SM-G900',
  durationMs: null,
  webUrl: 'https://onedrive.live.com/f1',
  ...over,
});

describe('Db', () => {
  it('cria o esquema e pode ser aberto de novo sem erro', () => {
    const db = new Db(':memory:');
    const tables = db.sql
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(['actions', 'dup_group_files', 'dup_groups', 'files', 'scan_folders', 'scan_roots', 'scans', 'settings']),
    );
    db.close();
  });

  it('grava e lê um arquivo sem perder campos', () => {
    const db = new Db(':memory:');
    db.sql.prepare("INSERT INTO scans (id, created_at, status) VALUES (1, 'x', 'running')").run();
    const item = sampleItem();
    insertFile(db.sql, 1, item);
    insertFile(db.sql, 1, item); // repetido é ignorado
    expect(getFilesByIds(db.sql, 1, ['f1'])).toEqual([item]);
  });
});

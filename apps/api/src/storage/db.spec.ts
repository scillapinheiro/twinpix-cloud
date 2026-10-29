import type { CloudItem } from '@twinpix/shared';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      expect.arrayContaining(['actions', 'batch_groups', 'batches', 'dup_group_files', 'dup_groups', 'files', 'scan_folders', 'scan_roots', 'scans', 'settings']),
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

  it('migra um banco com o esquema antigo (actions sem batch_id) e abre de novo', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'twinpix-db-')), 'old.sqlite');
    const old = new Database(file);
    old.exec(`CREATE TABLE actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, file_id TEXT NOT NULL,
      kept_file_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (1, 'f', 'k', 'done', 'x', 'x');
      CREATE TABLE batches (id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
      INSERT INTO batches (scan_id, created_at, status) VALUES (1, 'x', 'done');
      CREATE TABLE batch_groups (batch_id INTEGER NOT NULL, group_id INTEGER NOT NULL, line_key TEXT NOT NULL, seq INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (batch_id, group_id));
      INSERT INTO batch_groups (batch_id, group_id, line_key, seq, status) VALUES (7, 3, 'k', 0, 'pending');`);
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = new Db(file);
      const cols = (db.sql.prepare('PRAGMA table_info(actions)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols.filter((c) => c === 'batch_id')).toHaveLength(1);
      const bcols = (db.sql.prepare('PRAGMA table_info(batches)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(bcols).toContain('not_restored');
      expect(bcols.filter((c) => c === 'kind')).toHaveLength(1);
      const gcols = (db.sql.prepare('PRAGMA table_info(batch_groups)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(gcols.filter((c) => c === 'keep_folder')).toHaveLength(1);
      expect(gcols.filter((c) => c === 'keep_id')).toHaveLength(1);
      expect(gcols.filter((c) => c === 'delete_ids')).toHaveLength(1);
      expect(db.sql.prepare('SELECT batch_id, group_id, line_key, keep_folder, keep_id, delete_ids FROM batch_groups').all()).toEqual([
        { batch_id: 7, group_id: 3, line_key: 'k', keep_folder: null, keep_id: null, delete_ids: null },
      ]);
      expect(db.sql.prepare('SELECT kind FROM batches').get()).toEqual({ kind: 'lines' });
      expect(db.sql.prepare('SELECT batch_id FROM actions').get()).toEqual({ batch_id: null });
      db.close();
    }
  });
});

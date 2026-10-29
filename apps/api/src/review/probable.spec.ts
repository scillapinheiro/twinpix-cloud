import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionsService } from '../actions/actions.service';
import { BatchService } from '../batch/batch.service';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { FoldersReconcileService } from '../folders/folders-reconcile.service';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { ReviewService } from './review.service';

let db: Db;
let cloud: FakeCloudProvider;
let scan: ScanService;
let review: ReviewService;
let actions: ActionsService;
let scanId: number;

// 2 grupos de idênticas (i1, i2) e 2 de prováveis (p1: photo, p2: photo), mesmas dimensões e data.
beforeEach(async () => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  const a = cloud.addFolder(cloud.rootId, 'A');
  const b = cloud.addFolder(cloud.rootId, 'B');
  for (const n of [1, 2]) {
    cloud.addFile(a.id, { id: `i${n}a`, name: `i${n}.jpg`, quickXorHash: `hi${n}`, size: 100, takenAt: `2010-0${n}-01T00:00:00Z` });
    cloud.addFile(b.id, { id: `i${n}b`, name: `i${n}.jpg`, quickXorHash: `hi${n}`, size: 100, takenAt: `2010-0${n}-01T00:00:00Z` });
  }
  for (const n of [1, 2]) {
    cloud.addFile(a.id, { id: `p${n}a`, name: `p${n}.jpg`, quickXorHash: `hp${n}a`, size: 900, takenAt: `2012-0${n}-01T00:00:00Z` });
    cloud.addFile(b.id, { id: `p${n}b`, name: `p${n}.jpg`, quickXorHash: `hp${n}b`, size: 400, takenAt: `2012-0${n}-01T00:00:00Z` });
  }
  scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  scanId = scan.start([a, b]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
  actions = new ActionsService(db, cloud, review);
});

const probableKeys = () =>
  (db.sql.prepare("SELECT key FROM dup_groups WHERE scan_id = ? AND kind = 'probable' ORDER BY position").all(scanId) as Array<{ key: string }>).map((r) => r.key);

describe('prováveis cópias', () => {
  it('varredura cria os grupos prováveis ao terminar e o resumo separa os tipos', () => {
    expect(probableKeys()).toHaveLength(2);
    const s = scan.summary(scanId);
    expect(s).toMatchObject({ groupsTotal: 2, groupsPending: 2, groupsSkipped: 0, probableTotal: 2, probablePending: 2, probableSkipped: 0 });
    expect((db.sql.prepare('SELECT probable_done d FROM scans WHERE id = ?').get(scanId) as { d: number }).d).toBe(1);
  });

  it('recalcular não duplica grupos nem arquivos', () => {
    const before = db.sql.prepare('SELECT COUNT(*) n FROM dup_group_files').get() as { n: number };
    db.sql.prepare('UPDATE scans SET probable_done = 0').run();
    scan.onModuleInit();
    expect(probableKeys()).toHaveLength(2);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM dup_group_files').get()).toEqual(before);
  });

  it('backfill: análise concluída antiga ganha os grupos prováveis uma vez', () => {
    db.sql.prepare("DELETE FROM dup_group_files WHERE group_id IN (SELECT id FROM dup_groups WHERE kind = 'probable')").run();
    db.sql.prepare("DELETE FROM dup_groups WHERE kind = 'probable'").run();
    db.sql.prepare('UPDATE scans SET probable_done = 0').run();
    expect(scan.summary(scanId).probableTotal).toBe(0);
    scan.onModuleInit();
    expect(scan.summary(scanId).probableTotal).toBe(2);
    expect((db.sql.prepare('SELECT probable_done d FROM scans WHERE id = ?').get(scanId) as { d: number }).d).toBe(1);
  });

  it('migração é idempotente e preserva dados de bancos antigos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'twinpix-mig-'));
    try {
      const file = join(dir, 'old.db');
      const old = new Db(file);
      old.sql.prepare("INSERT INTO scans (created_at, status) VALUES ('x', 'done')").run();
      old.sql.exec('ALTER TABLE scans DROP COLUMN probable_done; ALTER TABLE scans DROP COLUMN cursor_probable_id;');
      old.close();
      for (let i = 0; i < 2; i++) {
        const d = new Db(file);
        const cols = (d.sql.prepare('PRAGMA table_info(scans)').all() as Array<{ name: string }>).map((c) => c.name);
        expect(cols).toEqual(expect.arrayContaining(['cursor_probable_id', 'probable_done']));
        expect(d.sql.prepare('SELECT probable_done d FROM scans').get()).toEqual({ d: 0 });
        d.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('current(kind) e cursores são independentes; preMarkedIds é vazio; posição conta só o tipo', () => {
    const ident = review.current(scanId)!;
    expect(ident.kind).toBe('identical');
    const prob = review.current(scanId, 'probable')!;
    expect(prob).toMatchObject({ kind: 'probable', position: 1, total: 2, preMarkedIds: [] });
    expect(prob.suggestion.keepId).toBeTruthy();
    const next = review.skip(prob.id)!;
    expect(next).toMatchObject({ kind: 'probable', position: 2 });
    expect(review.current(scanId)!.id).toBe(ident.id);
    expect(review.previous(next.id)!.id).toBe(prob.id);
    expect(scan.summary(scanId)).toMatchObject({ probableSkipped: 1, probablePending: 1, groupsSkipped: 0 });
    review.skip(next.id);
    expect(review.current(scanId, 'probable')).toBeNull();
    expect(review.current(scanId)).not.toBeNull();
    review.unskipAll(scanId, 'probable');
    expect(review.current(scanId, 'probable')!.position).toBe(1);
    expect(scan.summary(scanId).probableSkipped).toBe(0);
  });

  it('grupo com menos de 2 ativos é pulado e marcado como resolvido', () => {
    const first = review.current(scanId, 'probable')!;
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'done', 'x', 'x')")
      .run(first.id, first.files[0].id, first.files[1].id);
    const g = review.current(scanId, 'probable')!;
    expect(g.id).not.toBe(first.id);
    expect((db.sql.prepare('SELECT status s FROM dup_groups WHERE id = ?').get(first.id) as { s: string }).s).toBe('resolved');
  });

  it('lote e pastas ignoram prováveis', async () => {
    const batch = new BatchService(db, review, actions, { offlineRetryMs: 0, sleep: async () => {} });
    const p = batch.preview(scanId);
    expect(p.pendingCount).toBe(2);
    const probableIds = (db.sql.prepare("SELECT id FROM dup_groups WHERE kind = 'probable'").all() as Array<{ id: number }>).map((r) => r.id);
    const used = p.lines.flatMap((l) => l.items.map((g) => g.groupId));
    expect(used.some((id) => probableIds.includes(id))).toBe(false);
    const folders = new FoldersReconcileService(db, review, batch);
    expect(folders.clusters(scanId).reduce((n, c) => n + c.groupCount, 0)).toBe(2);
  });

  it('aplicar e desfazer funcionam num grupo provável, sem apagar todas', async () => {
    const g = review.current(scanId, 'probable')!;
    const del = g.files.filter((f) => f.id !== g.suggestion.keepId).map((f) => f.id);
    const r = await actions.apply(g.id, del);
    expect(r.results[0].status).toBe('done');
    expect(cloud.isInTrash(del[0])).toBe(true);
    expect(scan.summary(scanId).bytesFreed).toBeGreaterThan(0);
    await actions.undo(r.results[0].actionId);
    expect(cloud.isInTrash(del[0])).toBe(false);
    await expect(actions.apply(g.id, g.files.map((f) => f.id))).rejects.toThrow();
  });
});

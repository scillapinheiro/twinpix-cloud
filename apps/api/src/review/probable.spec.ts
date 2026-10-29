import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsService } from '../actions/actions.service';
import { BatchService } from '../batch/batch.service';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { FoldersReconcileService } from '../folders/folders-reconcile.service';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { BadRequestException } from '@nestjs/common';
import { ReviewController } from './review.controller';
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

  it('grupo com menos de 2 ativos é pulado pelo current sem mudar o status; desfazer o traz de volta', async () => {
    // grupo provável extra {i1a, i1b, p3c}: não; usa os existentes: identical i1 {i1a,i1b} e provável novo com i1a
    const first = review.current(scanId)!;
    const [x, y] = first.files.map((f) => f.id);
    const gid = Number(db.sql.prepare("INSERT INTO dup_groups (scan_id, kind, key, position, status) VALUES (?, 'probable', 'p:extra', 99, 'pending')").run(scanId).lastInsertRowid);
    db.sql.prepare('INSERT INTO dup_group_files (group_id, file_id) VALUES (?, ?), (?, ?)').run(gid, x, gid, 'p1a');
    const r = await actions.apply(gid, [x]);
    expect(r.results[0].status).toBe('done');
    const status = () => (db.sql.prepare('SELECT status s FROM dup_groups WHERE id = ?').get(first.id) as { s: string }).s;
    expect(review.activeFileIds(first.id)).toEqual([y]);
    expect(review.current(scanId)!.id).not.toBe(first.id);
    expect(status()).toBe('pending');
    await actions.undo(r.results[0].actionId);
    // o cursor está no segundo grupo; ao esgotá-lo, volta ao primeiro (de novo elegível)
    const second = review.current(scanId)!;
    expect(review.skip(second.id)!.id).toBe(first.id);
  });

  it('sem nenhum grupo elegível o current devolve null (revisão concluída)', async () => {
    for (const g of db.sql.prepare("SELECT id FROM dup_groups WHERE kind = 'probable'").all() as Array<{ id: number }>) {
      const v = review.view(g.id);
      await actions.apply(g.id, v.files.filter((f) => f.id !== v.suggestion.keepId).map((f) => f.id));
    }
    expect(review.current(scanId, 'probable')).toBeNull();
  });

  it('apply obsoleto num provável: arquivo com hash alterado não esvazia o grupo', async () => {
    const g = review.current(scanId, 'probable')!;
    const [a, b] = g.files.map((f) => f.id);
    cloud.updateFile(a, { quickXorHash: 'mudou' });
    const r = await actions.apply(g.id, [b]);
    expect(r.stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.activeFileIds(g.id).sort()).toEqual([a, b].sort());
    expect(review.view(g.id).status).toBe('pending');
  });

  it('apply obsoleto num provável: arquivo cuja data mudou sai do grupo; sobrando 1, resolve', async () => {
    const g = review.current(scanId, 'probable')!;
    const [a, b] = g.files.map((f) => f.id);
    cloud.updateFile(a, { takenAt: '1999-01-01T00:00:00Z' });
    expect((await actions.apply(g.id, [b])).stale).toBe(true);
    expect(review.activeFileIds(g.id)).toEqual([b]);
    expect(review.view(g.id).status).toBe('resolved');
  });

  it('backfill não mexe nas idênticas (status, posição, cursor)', () => {
    review.current(scanId);
    const snap = () => JSON.stringify([
      db.sql.prepare("SELECT id, status, position FROM dup_groups WHERE kind = 'identical' ORDER BY id").all(),
      db.sql.prepare('SELECT cursor_group_id c FROM scans').all(),
    ]);
    const before = snap();
    db.sql.prepare('UPDATE scans SET probable_done = 0').run();
    scan.onModuleInit();
    expect(snap()).toBe(before);
  });

  it('rota: kind=probable em current e unskip; kind inválido dá 400', () => {
    const c = new ReviewController(review, db);
    expect(c.current(scanId, 'probable')!.kind).toBe('probable');
    expect(c.current(scanId)!.kind).toBe('identical');
    const g = c.current(scanId, 'probable')!;
    review.skip(g.id);
    c.unskip(scanId, 'probable');
    expect(scan.summary(scanId).probableSkipped).toBe(0);
    expect(() => c.current(scanId, 'x')).toThrow(BadRequestException);
    expect(() => c.unskip(scanId, 'x')).toThrow(BadRequestException);
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

  it('contadores e prévia do lote ignoram grupos com menos de 2 ativos', async () => {
    const first = review.current(scanId)!;
    const [x] = first.files.map((f) => f.id);
    const gid = Number(db.sql.prepare("INSERT INTO dup_groups (scan_id, kind, key, position, status) VALUES (?, 'probable', 'p:extra', 99, 'pending')").run(scanId).lastInsertRowid);
    db.sql.prepare('INSERT INTO dup_group_files (group_id, file_id) VALUES (?, ?), (?, ?)').run(gid, x, gid, 'p1a');
    expect(scan.summary(scanId).probablePending).toBe(3);
    await actions.apply(gid, [x]); // x some do grupo idêntico `first` (fica com 1 ativo)
    expect(scan.summary(scanId)).toMatchObject({ groupsPending: 1, probablePending: 2 });
    const batch = new BatchService(db, review, actions, { offlineRetryMs: 0, sleep: async () => {} });
    expect(batch.preview(scanId).pendingCount).toBe(1);
    db.sql.prepare("UPDATE dup_groups SET status = 'skipped' WHERE id = ?").run(first.id);
    expect(scan.summary(scanId).groupsSkipped).toBe(0);
  });
  describe('arquivo que sumiu não fica fantasma em grupo do outro tipo', () => {
    const extraGroup = (kind: 'identical' | 'probable', ids: string[]) => {
      const gid = Number(db.sql.prepare("INSERT INTO dup_groups (scan_id, kind, key, position, status) VALUES (?, ?, 'extra', 99, 'pending')").run(scanId, kind).lastInsertRowid);
      for (const id of ids) db.sql.prepare('INSERT INTO dup_group_files (group_id, file_id) VALUES (?, ?)').run(gid, id);
      return gid;
    };
    const links = (id: string) => (db.sql.prepare('SELECT COUNT(*) n FROM dup_group_files WHERE file_id = ?').get(id) as { n: number }).n;

    it('apply de idênticas detecta o sumiço e tira o arquivo também do grupo provável', async () => {
      const ident = review.current(scanId)!;
      const [gone, other] = ident.files.map((f) => f.id);
      const gid = extraGroup('probable', [gone, 'p1a']);
      cloud.removeFile(gone);
      expect((await actions.apply(ident.id, [other])).stale).toBe(true);
      expect(links(gone)).toBe(0);
      expect(review.activeFileIds(gid)).toEqual(['p1a']);
      expect(scan.summary(scanId).probablePending).toBe(2);
    });

    it('apply de provável detecta o sumiço e tira o arquivo também do grupo idêntico', async () => {
      const prob = review.current(scanId, 'probable')!;
      const [gone, other] = prob.files.map((f) => f.id);
      const gid = extraGroup('identical', [gone, 'i2a']);
      cloud.removeFile(gone);
      expect((await actions.apply(prob.id, [other])).stale).toBe(true);
      expect(links(gone)).toBe(0);
      expect(review.activeFileIds(gid)).toEqual(['i2a']);
      expect(scan.summary(scanId).groupsPending).toBe(2);
    });

    it('vínculo antigo a arquivo já apagado da análise não conta como ativo', () => {
      const prob = review.current(scanId, 'probable')!;
      const [gone, other] = prob.files.map((f) => f.id);
      db.sql.prepare('DELETE FROM files WHERE scan_id = ? AND id = ?').run(scanId, gone);
      expect(review.activeFileIds(prob.id)).toEqual([other]);
      expect(scan.summary(scanId).probablePending).toBe(1);
      expect(review.current(scanId, 'probable')!.id).not.toBe(prob.id);
    });
  });
  it('backfill que falha não impede o app de subir e tenta de novo no próximo início', () => {
    db.sql.prepare("DELETE FROM dup_group_files WHERE group_id IN (SELECT id FROM dup_groups WHERE kind = 'probable')").run();
    db.sql.prepare("DELETE FROM dup_groups WHERE kind = 'probable'").run();
    db.sql.prepare('UPDATE scans SET probable_done = 0').run();
    const spy = vi.spyOn(scan as unknown as { computeProbable: (id: number) => void }, 'computeProbable').mockImplementationOnce(() => {
      throw new Error('falha forçada');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => scan.onModuleInit()).not.toThrow();
      expect(log).toHaveBeenCalled();
      expect((db.sql.prepare('SELECT probable_done d FROM scans WHERE id = ?').get(scanId) as { d: number }).d).toBe(0);
      spy.mockRestore();
      scan.onModuleInit();
      expect(scan.summary(scanId).probableTotal).toBe(2);
    } finally {
      log.mockRestore();
    }
  });

  it('backfill numera os grupos prováveis em sequência depois das posições existentes', () => {
    db.sql.prepare("DELETE FROM dup_group_files WHERE group_id IN (SELECT id FROM dup_groups WHERE kind = 'probable')").run();
    db.sql.prepare("DELETE FROM dup_groups WHERE kind = 'probable'").run();
    db.sql.prepare('UPDATE scans SET probable_done = 0').run();
    const max = (db.sql.prepare('SELECT MAX(position) m FROM dup_groups WHERE scan_id = ?').get(scanId) as { m: number }).m;
    scan.onModuleInit();
    const pos = (db.sql.prepare("SELECT position p FROM dup_groups WHERE scan_id = ? AND kind = 'probable' ORDER BY position").all(scanId) as Array<{ p: number }>).map((r) => r.p);
    expect(pos).toEqual([max + 1, max + 2]);
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionsService } from '../actions/actions.service';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { BatchService } from '../batch/batch.service';
import { ReviewService } from '../review/review.service';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { FoldersReconcileService } from './folders-reconcile.service';

let db: Db;
let cloud: FakeCloudProvider;
let batch: BatchService;
let svc: FoldersReconcileService;
let scanId: number;
let scan: ScanService;
const A = '/Minhas imagens/07-06-07';
const B = '/Minhas imagens/minhas fotos/07-06-07';

beforeEach(async () => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  const mi = cloud.addFolder(cloud.rootId, 'Minhas imagens');
  const a = cloud.addFolder(mi.id, '07-06-07');
  const mf = cloud.addFolder(mi.id, 'minhas fotos');
  const b = cloud.addFolder(mf.id, '07-06-07');
  const t = { takenAt: '2007-06-07T00:00:00Z', createdAt: '2007-06-07T00:00:00Z', modifiedAt: '2007-06-07T00:00:00Z' };
  for (const n of [1, 2, 3, 4]) {
    cloud.addFile(a.id, { id: `a${n}`, name: `img${n}.jpg`, quickXorHash: `h${n}`, size: 100 * n, ...t });
    cloud.addFile(b.id, { id: `b${n}`, name: `img${n}.jpg`, quickXorHash: `h${n}`, size: 100 * n, ...t });
  }
  scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  scanId = scan.start([mi]);
  await scan.whenIdle(scanId);
  const review = new ReviewService(db);
  const actions = new ActionsService(db, cloud, review);
  batch = new BatchService(db, review, actions, { offlineRetryMs: 0, sleep: async () => {} });
  svc = new FoldersReconcileService(db, review, batch);
});

describe('FoldersReconcileService', () => {
  it('lista um conjunto "contained" para as duas pastas', () => {
    const cs = svc.clusters(scanId);
    expect(cs).toHaveLength(1);
    expect(cs[0].folders.map((f) => f.path).sort()).toEqual([A, B].sort());
    expect(cs[0].folders.filter((f) => f.situation === 'contained')).toHaveLength(1);
    expect(cs[0].groupCount).toBe(4);
  });

  it('ver lista: pasta sem arquivos só dela devolve vazio', () => {
    const [c] = svc.clusters(scanId);
    expect(svc.unique(scanId, c.key, A)).toEqual([]);
  });

  it('plano coerente: 4 cópias saem da outra pasta', () => {
    const [c] = svc.clusters(scanId);
    const keep = c.suggestedKeep;
    const plan = svc.plan(scanId, c.key, keep);
    expect(plan.items).toHaveLength(4);
    expect(plan.deleteFiles.every((x) => x.folderPath !== keep)).toBe(true);
    expect(plan.bytes).toBe(1000);
  });

  it('apply executa e o conjunto some da lista', async () => {
    const [c] = svc.clusters(scanId);
    const plan = svc.plan(scanId, c.key, c.suggestedKeep);
    const summary = svc.apply(scanId, c.key, c.suggestedKeep, plan.items);
    await batch.whenIdle(summary.id);
    expect(svc.clusters(scanId)).toEqual([]);
    for (const x of plan.deleteFiles) expect(cloud.isInTrash(x.id)).toBe(true);
    for (const it of plan.items) expect(cloud.isInTrash(it.keepId)).toBe(false);
  });

  it('arquivo com ação feita (já na lixeira) fica fora do conjunto e do plano', () => {
    const gid = (db.sql.prepare("SELECT group_id g FROM dup_group_files WHERE file_id = 'b1'").get() as { g: number }).g;
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, 'b1', 'a1', 'done', 'x', 'x')").run(gid);
    const [c] = svc.clusters(scanId);
    expect(c.folders.find((x) => x.path === B)!.fileCount).toBe(3);
    expect(c.groupCount).toBe(3);
    const plan = svc.plan(scanId, c.key, A);
    expect(plan.items.map((i) => i.groupId)).not.toContain(gid);
    expect(plan.deleteFiles.map((x) => x.id).sort()).toEqual(['b2', 'b3', 'b4']);
    expect(plan.remaining.find((r) => r.path === B)!.fileCount).toBe(0);
  });

  it('erros com mensagens em português', () => {
    const [c] = svc.clusters(scanId);
    expect(() => svc.plan(scanId, '["x"]', A)).toThrow(NotFoundException);
    expect(() => svc.plan(scanId, '["x"]', A)).toThrow('Esse conjunto de pastas não existe mais. Abra de novo.');
    expect(() => svc.plan(scanId, c.key, '/Fora')).toThrow('Pasta escolhida inválida.');
    expect(() => svc.unique(scanId, c.key, '/Fora')).toThrow(BadRequestException);
    const plan = svc.plan(scanId, c.key, c.suggestedKeep);
    expect(() => svc.apply(scanId, c.key, c.suggestedKeep, plan.items.slice(1))).toThrow('A prévia mudou. Abra as pastas repetidas de novo.');
  });

  it('análise rodando devolve 400', () => {
    db.sql.prepare("UPDATE scans SET status = 'running' WHERE id = ?").run(scanId);
    expect(() => svc.clusters(scanId)).toThrow('Espere a análise terminar para ver as pastas repetidas.');
  });
});

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionsService } from '../actions/actions.service';
import { OfflineError } from '../cloud/errors';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { ReviewService } from '../review/review.service';
import { setRules } from '../review/rules-settings';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { BatchService } from './batch.service';

let db: Db;
let cloud: FakeCloudProvider;
let review: ReviewService;
let actions: ActionsService;
let scanId: number;
let batch: BatchService;

function makeBatch(): BatchService {
  return new BatchService(db, review, actions, { offlineRetryMs: 0, sleep: async () => {} });
}

/** Segurança: nenhum grupo da análise pode ficar sem uma cópia fora da lixeira. */
async function expectEveryGroupKeepsACopy(): Promise<void> {
  const groups = db.sql.prepare('SELECT id FROM dup_groups WHERE scan_id = ?').all(scanId) as Array<{ id: number }>;
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) {
    const ids = (db.sql.prepare('SELECT file_id FROM dup_group_files WHERE group_id = ?').all(g.id) as Array<{ file_id: string }>).map((r) => r.file_id);
    let present = 0;
    for (const id of ids) if ((await cloud.getItem(id)) && !cloud.isInTrash(id)) present++;
    expect(present, `grupo ${g.id} ficou sem cópia`).toBeGreaterThanOrEqual(1);
  }
}

// Pares: /A x /B (2 grupos), /A x /C (1 grupo). Em cada um o mais antigo (em /A) fica.
beforeEach(async () => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  const A = cloud.addFolder(cloud.rootId, 'A');
  const B = cloud.addFolder(cloud.rootId, 'B');
  const C = cloud.addFolder(cloud.rootId, 'C');
  const old = { takenAt: '2010-01-01T00:00:00Z', createdAt: '2010-01-01T00:00:00Z', modifiedAt: '2010-01-01T00:00:00Z' };
  const nw = { takenAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z', modifiedAt: '2020-01-01T00:00:00Z' };
  cloud.addFile(A.id, { id: 'a1', name: 'a1.jpg', quickXorHash: 'h1', size: 100, ...old });
  cloud.addFile(B.id, { id: 'b1', name: 'a1.jpg', quickXorHash: 'h1', size: 100, ...nw });
  cloud.addFile(A.id, { id: 'a2', name: 'a2.jpg', quickXorHash: 'h2', size: 200, ...old });
  cloud.addFile(B.id, { id: 'b2', name: 'a2.jpg', quickXorHash: 'h2', size: 200, ...nw });
  cloud.addFile(A.id, { id: 'a3', name: 'a3.jpg', quickXorHash: 'h3', size: 300, ...old });
  cloud.addFile(C.id, { id: 'c3', name: 'a3.jpg', quickXorHash: 'h3', size: 300, ...nw });
  const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  scanId = scan.start([A, B, C]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
  actions = new ActionsService(db, cloud, review);
  batch = makeBatch();
});

const lineFor = (folder: string) => batch.preview(scanId).lines.find((l) => l.removeFolders.includes(folder))!;
const groupStatus = (gid: number) => (db.sql.prepare('SELECT status FROM dup_groups WHERE id = ?').get(gid) as { status: string }).status;

describe('BatchService', () => {
  it('prévia: dois pares de pastas viram duas linhas', () => {
    const p = batch.preview(scanId);
    expect(p.lines).toHaveLength(2);
    expect(p.pendingCount).toBe(3);
    expect(p.tiesCount).toBe(0);
  });

  it('prévia: empate fica fora das linhas', () => {
    setRules(db, [{ type: 'largestResolution' }]);
    const p = batch.preview(scanId);
    expect(p.lines).toHaveLength(0);
    expect(p.tiesCount).toBe(3);
  });

  it('prévia: análise rodando dá 400', () => {
    db.sql.prepare("UPDATE scans SET status = 'running' WHERE id = ?").run(scanId);
    expect(() => batch.preview(scanId)).toThrow('Espere a análise terminar para revisar em lote.');
  });

  it('executa só as linhas escolhidas, mantém a sugerida e registra no histórico', async () => {
    const line = lineFor('/B');
    const s = batch.start(scanId, [line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', totalGroups: 2, doneGroups: 2, skippedGroups: 0, movedFiles: 2, movedBytes: 300, failedFiles: 0, restoredFiles: 0 });
    expect(cloud.isInTrash('b1') && cloud.isInTrash('b2')).toBe(true);
    for (const id of ['a1', 'a2', 'a3', 'c3']) expect(cloud.isInTrash(id)).toBe(false);
    expect(actions.history().every((h) => h.batchId === s.id)).toBe(true);
    expect(batch.list()).toHaveLength(1);
    await expectEveryGroupKeepsACopy();
  });

  it('grupo alterado no OneDrive depois da prévia é pulado e segue pendente', async () => {
    const line = lineFor('/B');
    const gid = line.items.find((i) => i.remove[0].id === 'b1')!.groupId;
    cloud.updateFile('b1', { size: 999 });
    const s = batch.start(scanId, [line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 1, skippedGroups: 1, movedFiles: 1 });
    expect(cloud.isInTrash('b1')).toBe(false);
    // o arquivo mudou e deixou de ser cópia: o grupo se atualiza sozinho (nada é movido)
    expect(groupStatus(gid)).not.toBe('done');
    await expectEveryGroupKeepsACopy();
  });

  it('grupo que virou empate depois da prévia é pulado', async () => {
    const line = lineFor('/B');
    // lote já gravado com a prévia antiga; as regras mudam antes de o laço chegar nos grupos
    const { lastInsertRowid } = db.sql.prepare("INSERT INTO batches (scan_id, created_at, status) VALUES (?, ?, 'paused')").run(scanId, new Date().toISOString());
    const s = { id: Number(lastInsertRowid) };
    line.items.forEach((it, i) =>
      db.sql.prepare("INSERT INTO batch_groups (batch_id, group_id, line_key, seq, status) VALUES (?, ?, ?, ?, 'pending')").run(s.id, it.groupId, line.key, i));
    setRules(db, [{ type: 'largestResolution' }]);
    batch.resume(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 0, skippedGroups: 2, movedFiles: 0 });
    expect(cloud.calls).not.toContain('moveToTrash');
    await expectEveryGroupKeepsACopy();
  });

  it('sem internet no meio: espera e termina', async () => {
    const line = lineFor('/B');
    cloud.failNext('getItem', new OfflineError(), 2);
    const s = batch.start(scanId, [line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 2, movedFiles: 2 });
    await expectEveryGroupKeepsACopy();
  });

  it('pausar e continuar', async () => {
    const line = lineFor('/B');
    const s = batch.start(scanId, [line.key]);
    batch.pause(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id).status).toBe('paused');
    batch.resume(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 2 });
    await expectEveryGroupKeepsACopy();
  });

  it('reinício: instância nova relança o lote que estava rodando', async () => {
    const line = lineFor('/B');
    const { lastInsertRowid } = db.sql.prepare("INSERT INTO batches (scan_id, created_at, status) VALUES (?, ?, 'running')").run(scanId, new Date().toISOString());
    const id = Number(lastInsertRowid);
    line.items.forEach((it, i) =>
      db.sql.prepare("INSERT INTO batch_groups (batch_id, group_id, line_key, seq, status) VALUES (?, ?, ?, ?, 'pending')").run(id, it.groupId, line.key, i));
    const fresh = makeBatch();
    fresh.onModuleInit();
    await fresh.whenIdle(id);
    expect(fresh.summary(id)).toMatchObject({ status: 'done', doneGroups: 2, movedFiles: 2 });
    await expectEveryGroupKeepsACopy();
  });

  it('só um lote por vez; chaves desconhecidas e lista vazia dão 400', async () => {
    const line = lineFor('/B');
    expect(() => batch.start(scanId, ['nada'])).toThrow('A prévia mudou. Abra o lote de novo.');
    expect(() => batch.start(scanId, [])).toThrow('Escolha pelo menos uma linha.');
    const s = batch.start(scanId, [line.key]);
    expect(() => batch.start(scanId, [lineFor('/C').key])).toThrow('Já existe um lote em andamento.');
    await batch.whenIdle(s.id);
    await expectEveryGroupKeepsACopy();
  });

  it('desfazer restaura tudo e os grupos voltam a pendente', async () => {
    const line = lineFor('/B');
    const s = batch.start(scanId, [line.key]);
    await batch.whenIdle(s.id);
    expect(batch.undo(s.id).status).toBe('undoing');
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'undone', restoredFiles: 2, movedFiles: 0, notRestoredFiles: 0 });
    expect(cloud.isInTrash('b1') || cloud.isInTrash('b2')).toBe(false);
    for (const it of line.items) expect(groupStatus(it.groupId)).toBe('pending');
    expect(() => batch.undo(s.id)).toThrow(BadRequestException);
    await expectEveryGroupKeepsACopy();
  });

  it('arquivo que saiu da lixeira conta em notRestoredFiles', async () => {
    const line = lineFor('/B');
    const s = batch.start(scanId, [line.key]);
    await batch.whenIdle(s.id);
    (cloud as unknown as { trash: Map<string, unknown> }).trash.delete('b1');
    batch.undo(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'undone', restoredFiles: 1, notRestoredFiles: 1 });
    await expectEveryGroupKeepsACopy();
  });
});

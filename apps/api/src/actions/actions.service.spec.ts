import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineError } from '../cloud/errors';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { ReviewService } from '../review/review.service';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { UnsafeDeletionError } from './deletion-plan';
import { ActionsService } from './actions.service';

let db: Db;
let cloud: FakeCloudProvider;
let review: ReviewService;
let actions: ActionsService;
let groupId: number;
let keep: string;
let extra: string[];

beforeEach(async () => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  const a = cloud.addFolder(cloud.rootId, 'A');
  cloud.addFile(a.id, { id: 'orig', name: 'x.jpg', quickXorHash: 'h', size: 500 });
  cloud.addFile(a.id, { id: 'c1', name: 'x 1.jpg', quickXorHash: 'h', size: 500 });
  cloud.addFile(a.id, { id: 'c2', name: 'x (2).jpg', quickXorHash: 'h', size: 500 });
  const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  const scanId = scan.start([a]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
  actions = new ActionsService(db, cloud, review);
  const g = review.current(scanId)!;
  groupId = g.id;
  keep = g.suggestion.keepId;
  extra = g.preMarkedIds;
});

describe('ActionsService', () => {
  it('prévia mostra contagem, espaço e listas', () => {
    const p = actions.preview(groupId, extra);
    expect(p.deleteFiles.map((f) => f.id).sort()).toEqual(['c1', 'c2']);
    expect(p.keepFiles.map((f) => f.id)).toEqual(['orig']);
    expect(p.bytes).toBe(1000);
  });

  it('prévia e aplicação recusam excluir todas', async () => {
    expect(() => actions.preview(groupId, ['orig', 'c1', 'c2'])).toThrow(UnsafeDeletionError);
    await expect(actions.apply(groupId, ['orig', 'c1', 'c2'])).rejects.toBeInstanceOf(UnsafeDeletionError);
    expect(cloud.calls).not.toContain('moveToTrash');
  });

  it('move para a lixeira, registra histórico e resolve o grupo', async () => {
    const r = await actions.apply(groupId, extra);
    expect(r.stale).toBe(false);
    expect(r.results.map((x) => x.status)).toEqual(['done', 'done']);
    expect(cloud.isInTrash('c1') && cloud.isInTrash('c2')).toBe(true);
    expect(cloud.isInTrash(keep)).toBe(false);
    expect(review.view(groupId).status).toBe('resolved');
    expect(actions.history()).toHaveLength(2);
  });

  it('se a cópia que fica sumiu, nada é movido e o grupo fica desatualizado', async () => {
    cloud.removeFile(keep);
    const r = await actions.apply(groupId, extra);
    expect(r).toEqual({ groupId, stale: true, results: [] });
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.view(groupId).status).toBe('stale');
  });

  it('se a cópia que fica mudou de conteúdo, nada é movido', async () => {
    cloud.updateFile(keep, { quickXorHash: 'editada' });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
  });

  it('se o arquivo que sai mudou, nada é movido', async () => {
    cloud.updateFile('c1', { size: 999 });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
  });

  it('se o arquivo que sai desapareceu, nada é movido e o grupo fica desatualizado', async () => {
    cloud.removeFile('c1');
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.view(groupId).status).toBe('stale');
  });

  it('sem conexão na conferência: rejeita, não move e não muda o grupo', async () => {
    cloud.failNext('getItem', new OfflineError());
    await expect(actions.apply(groupId, extra)).rejects.toBeInstanceOf(OfflineError);
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.view(groupId).status).toBe('pending');
  });

  it('recoverPending sem conexão mantém a ação pendente', async () => {
    const now = new Date().toISOString();
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(groupId, 'c1', keep, now, now);
    cloud.failNext('getItem', new OfflineError());
    await actions.recoverPending();
    expect(db.sql.prepare('SELECT status FROM actions').all()).toEqual([{ status: 'pending' }]);
  });

  it('apply simultâneos no mesmo grupo nunca levam todas as cópias', async () => {
    const [a, b] = await Promise.all([actions.apply(groupId, ['c1', 'c2']), actions.apply(groupId, ['orig']).catch((e) => e)]);
    expect(a.stale).toBe(false);
    expect(b).toBeInstanceOf(UnsafeDeletionError);
    expect(['orig', 'c1', 'c2'].some((id) => !cloud.isInTrash(id))).toBe(true);
    expect(cloud.isInTrash('orig')).toBe(false);
  });

  it('apply duplicado com os mesmos IDs não gera duas ações para o mesmo arquivo', async () => {
    const [a, b] = await Promise.all([actions.apply(groupId, ['c1']), actions.apply(groupId, ['c1']).catch((e) => e)]);
    expect(a.results).toHaveLength(1);
    expect(b).toBeInstanceOf(UnsafeDeletionError);
    expect(actions.history().filter((h) => h.file.id === 'c1')).toHaveLength(1);
  });

  it('já não estava no OneDrive: registra com nota e desfazer não chama restore', async () => {
    const spy = vi.spyOn(cloud, 'moveToTrash').mockResolvedValueOnce('already-gone');
    const r = await actions.apply(groupId, ['c1']);
    spy.mockRestore();
    expect(r.results[0]).toMatchObject({ status: 'done', error: 'Já não estava no OneDrive.' });
    const before = cloud.calls.filter((c) => c === 'restore').length;
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('not-in-trash');
    expect(cloud.calls.filter((c) => c === 'restore').length).toBe(before);
  });

  it('desfazer simultâneo a apply deixa o grupo consistente', async () => {
    const first = await actions.apply(groupId, ['c1']);
    const [, u] = await Promise.all([actions.apply(groupId, ['c2']), actions.undo(first.results[0].actionId)]);
    expect(u.result).toBe('restored');
    expect(cloud.isInTrash('c1')).toBe(false);
    expect(cloud.isInTrash('c2')).toBe(true);
    expect(review.view(groupId).status).toBe('pending');
    expect(review.activeFileIds(groupId)).toEqual(['c1', 'orig']);
  });

  it('falha parcial: cada item tem seu resultado e o grupo continua pendente', async () => {
    cloud.failNext('moveToTrash', new OfflineError());
    const r = await actions.apply(groupId, extra);
    expect(r.results.map((x) => x.status).sort()).toEqual(['done', 'failed']);
    expect(r.results.find((x) => x.status === 'failed')!.error).toBe('Sem conexão com a internet.');
    expect(review.view(groupId).status).toBe('pending');
    expect(review.activeFileIds(groupId)).toHaveLength(2);
  });

  it('diário: ação pendente após fechar o app é acertada na volta', async () => {
    const now = new Date().toISOString();
    const ins = db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)");
    ins.run(groupId, 'c1', keep, now, now);
    ins.run(groupId, 'c2', keep, now, now);
    await cloud.moveToTrash('c1'); // chegou a ser movido antes de o app fechar
    await actions.recoverPending();
    const statuses = db.sql.prepare('SELECT file_id, status FROM actions ORDER BY file_id').all();
    expect(statuses).toEqual([
      { file_id: 'c1', status: 'done' },
      { file_id: 'c2', status: 'failed' },
    ]);
  });

  it('desfazer restaura e devolve o grupo para revisão', async () => {
    const r = await actions.apply(groupId, ['c1']);
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('restored');
    expect(cloud.isInTrash('c1')).toBe(false);
    expect(actions.history()[0].status).toBe('undone');
    expect(review.view(groupId).status).toBe('pending');
  });

  it('desfazer: item que já saiu da lixeira e nome ocupado', async () => {
    const r = await actions.apply(groupId, ['c1', 'c2']);
    // simula a lixeira esvaziada pelo OneDrive
    await cloud.restore('c1');
    cloud.removeFile('c1');
    expect((await actions.undo(r.results.find((x) => x.fileId === 'c1')!.actionId)).message).toMatch('já saiu da lixeira');
    const [pastaA] = await cloud.listFolders(cloud.rootId);
    cloud.addFile(pastaA.id, { name: 'x (2).jpg' });
    expect((await actions.undo(r.results.find((x) => x.fileId === 'c2')!.actionId)).result).toBe('conflict');
  });
});

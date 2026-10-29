import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphError, OfflineError } from '../cloud/errors';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { ReviewService } from '../review/review.service';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { UnsafeDeletionError } from './deletion-plan';
import { ActionsController } from './actions.controller';
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
  it('apply com batchId grava batch_id e o histórico devolve batchId (null fora de lote)', async () => {
    const scanId = review.view(groupId).scanId;
    db.sql.prepare("INSERT INTO batches (id, scan_id, created_at, status) VALUES (7, ?, 'x', 'running')").run(scanId);
    await actions.apply(groupId, ['c1'], { batchId: 7 });
    await actions.apply(groupId, ['c2']);
    const h = actions.history();
    expect(h.find((x) => x.file.id === 'c1')!.batchId).toBe(7);
    expect(h.find((x) => x.file.id === 'c2')!.batchId).toBeNull();
  });

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

  it('se a cópia que fica sumiu, nada é movido e o grupo é atualizado sem ela', async () => {
    cloud.removeFile(keep);
    const r = await actions.apply(groupId, extra);
    expect(r).toEqual({ groupId, stale: true, results: [] });
    expect(cloud.calls).not.toContain('moveToTrash');
    const g = review.view(groupId);
    expect(g.status).toBe('pending');
    expect(g.files.map((f) => f.id).sort()).toEqual(['c1', 'c2']);
  });

  it('se a cópia que fica mudou de conteúdo, nada é movido e ela sai do grupo', async () => {
    cloud.updateFile(keep, { quickXorHash: 'editada' });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.activeFileIds(groupId)).toEqual(['c1', 'c2']);
    expect(db.sql.prepare("SELECT quick_xor_hash h FROM files WHERE id = ?").get(keep)).toEqual({ h: 'editada' });
  });

  it('se o arquivo que sai mudou, nada é movido e ele sai do grupo', async () => {
    cloud.updateFile('c1', { size: 999 });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.activeFileIds(groupId)).toEqual(['c2', 'orig']);
  });

  it('se o arquivo que sai desapareceu, nada é movido e o grupo é atualizado', async () => {
    cloud.removeFile('c1');
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.view(groupId)).toMatchObject({ status: 'pending' });
    expect(review.activeFileIds(groupId)).toEqual(['c2', 'orig']);
  });

  it('grupo desatualizado: o próximo grupo é o atualizado e a nova tentativa funciona', async () => {
    cloud.removeFile('c2');
    cloud.updateFile('c1', { modifiedAt: '2020-01-01T00:00:00Z' });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    const g = review.current(review.view(groupId).scanId)!;
    expect(g.id).toBe(groupId);
    expect(g.files.map((f) => f.id)).toEqual(['c1', 'orig']);
    expect(g.files.find((f) => f.id === 'c1')!.modifiedAt).toBe('2020-01-01T00:00:00Z');
    const r = await actions.apply(g.id, g.preMarkedIds);
    expect(r.stale).toBe(false);
    expect(r.results.map((x) => x.status)).toEqual(['done']);
    expect(review.view(groupId).status).toBe('resolved');
  });

  it('grupo desatualizado que fica com uma cópia só é dado como resolvido', async () => {
    cloud.removeFile('c1');
    cloud.removeFile('c2');
    expect((await actions.apply(groupId, ['c1'])).stale).toBe(true);
    expect(review.view(groupId).status).toBe('resolved');
    expect(review.current(review.view(groupId).scanId)).toBeNull();
    expect(cloud.isInTrash('orig')).toBe(false);
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

  it('duas análises da mesma pasta, apply em paralelo com escolhas opostas: sempre sobra uma cópia', async () => {
    class SlowCloud extends FakeCloudProvider {
      override async getItem(id: string) { await new Promise((r) => setTimeout(r, 0)); return super.getItem(id); }
      override async moveToTrash(id: string) { await new Promise((r) => setTimeout(r, 0)); return super.moveToTrash(id); }
    }
    const db2 = new Db(':memory:');
    const slow = new SlowCloud();
    const a = slow.addFolder(slow.rootId, 'A');
    slow.addFile(a.id, { id: 'orig', name: 'x.jpg', quickXorHash: 'h', size: 500 });
    slow.addFile(a.id, { id: 'c1', name: 'x 1.jpg', quickXorHash: 'h', size: 500 });
    const scan = new ScanService(db2, slow, { offlineRetryMs: 0 });
    const s1 = scan.start([a]);
    await scan.whenIdle(s1);
    const s2 = scan.start([a]);
    await scan.whenIdle(s2);
    const rv = new ReviewService(db2);
    const act = new ActionsService(db2, slow, rv);
    const g1 = rv.current(s1)!;
    const g2 = rv.current(s2)!;
    expect(g1.id).not.toBe(g2.id);
    const settled = await Promise.allSettled([act.apply(g1.id, ['c1']), act.apply(g2.id, ['orig'])]);
    expect(['orig', 'c1'].some((id) => !slow.isInTrash(id))).toBe(true);
    expect(settled.filter((x) => x.status === 'fulfilled' && !x.value.stale && x.value.results.length > 0)).toHaveLength(1);
  });

  it('apply duplicado com os mesmos IDs não gera duas ações para o mesmo arquivo', async () => {
    const [a, b] = await Promise.all([actions.apply(groupId, ['c1']), actions.apply(groupId, ['c1']).catch((e) => e)]);
    expect(a.results).toHaveLength(1);
    expect(b).toBeInstanceOf(UnsafeDeletionError);
    expect(actions.history().filter((h) => h.file.id === 'c1')).toHaveLength(1);
  });

  it('já não estava no OneDrive: registra com nota e desfazer tenta restaurar e informa', async () => {
    // 404 no DELETE: o arquivo não existe mais (apagado fora do app)
    const spy = vi.spyOn(cloud, 'moveToTrash').mockImplementationOnce(async (id) => { cloud.removeFile(id); return 'already-gone'; });
    const r = await actions.apply(groupId, ['c1']);
    spy.mockRestore();
    expect(r.results[0]).toMatchObject({ status: 'done', error: 'Já não estava no OneDrive.' });
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('not-in-trash');
    expect(cloud.calls).toContain('restore');
  });

  it('DELETE repetido após 503 respondeu 404, mas o arquivo está na lixeira: desfazer restaura', async () => {
    const real = cloud.moveToTrash.bind(cloud);
    vi.spyOn(cloud, 'moveToTrash').mockImplementationOnce(async (id) => { await real(id); return 'already-gone'; });
    const r = await actions.apply(groupId, ['c1']);
    expect(r.results[0].error).toBe('Já não estava no OneDrive.');
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('restored');
    expect(cloud.isInTrash('c1')).toBe(false);
  });

  it('desfazer: restauração que deu certo antes (ex.: tempo esgotado) é confirmada e conta como restaurada', async () => {
    const r = await actions.apply(groupId, ['c1']);
    await cloud.restore('c1'); // a primeira tentativa restaurou, mas a resposta não chegou
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('restored');
    expect(u.message).toBe('O arquivo já não está na lixeira e continua no OneDrive.');
    expect(actions.history()[0].status).toBe('undone');
    expect(review.view(groupId).status).toBe('pending');
  });

  it('desfazer: fora da lixeira e fora do OneDrive continua informando que não dá para restaurar', async () => {
    const r = await actions.apply(groupId, ['c1']);
    cloud.purgeFromTrash('c1');
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('not-in-trash');
    expect(actions.history()[0].status).toBe('done');
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

  it('erro de conexão depois de o OneDrive mover: confere e registra como feita', async () => {
    const real = cloud.moveToTrash.bind(cloud);
    vi.spyOn(cloud, 'moveToTrash').mockImplementationOnce(async (id) => { await real(id); throw new OfflineError(); });
    const r = await actions.apply(groupId, ['c1']);
    expect(r.results[0]).toMatchObject({ fileId: 'c1', status: 'done' });
    expect(cloud.isInTrash('c1')).toBe(true);
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('restored');
  });

  it('erro 5xx sem o OneDrive ter movido: confere e registra como não movido', async () => {
    cloud.failNext('moveToTrash', new GraphError(503, ''));
    const r = await actions.apply(groupId, ['c1']);
    expect(r.results[0]).toMatchObject({ status: 'failed', error: 'O OneDrive respondeu com erro 503.' });
    expect(review.activeFileIds(groupId)).toContain('c1');
  });

  it('erro e sem conexão para conferir: a ação fica pendente e o arquivo sai do grupo', async () => {
    const real = cloud.moveToTrash.bind(cloud);
    vi.spyOn(cloud, 'moveToTrash').mockImplementationOnce(async (id) => { await real(id); throw new OfflineError(); });
    const realGet = cloud.getItem.bind(cloud);
    let gets = 0;
    vi.spyOn(cloud, 'getItem').mockImplementation(async (id) => {
      gets += 1;
      if (gets > 3) throw new OfflineError(); // 3 conferências antes de mover; a 4ª é a reconciliação
      return realGet(id);
    });
    const r = await actions.apply(groupId, ['c1']);
    expect(r.results[0].status).toBe('pending');
    expect(r.results[0].error).toMatch(/conferido/);
    expect(review.activeFileIds(groupId)).not.toContain('c1');
    expect(review.view(groupId).status).toBe('pending');
    vi.mocked(cloud.getItem).mockRestore();
    // na volta da conexão, abrir o histórico acerta o diário
    const history = await new ActionsController(actions).history();
    expect(history.find((h) => h.file.id === 'c1')!.status).toBe('done');
  });

  it('apply acerta ações pendentes antes de planejar', async () => {
    const now = new Date().toISOString();
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(groupId, 'c1', keep, now, now);
    const r = await actions.apply(groupId, ['c2']);
    expect(r.results.map((x) => x.status)).toEqual(['done']);
    expect(db.sql.prepare("SELECT status FROM actions WHERE file_id = 'c1'").get()).toEqual({ status: 'failed' });
    expect(review.activeFileIds(groupId)).toEqual(['c1', 'orig']);
  });
});

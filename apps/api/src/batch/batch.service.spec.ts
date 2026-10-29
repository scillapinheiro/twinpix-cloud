import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsService } from '../actions/actions.service';
import { OfflineError, ReconnectRequiredError } from '../cloud/errors';
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
  const D = cloud.addFolder(cloud.rootId, 'D');
  cloud.addFile(A.id, { id: 'a4', name: 'a4.jpg', quickXorHash: 'h4', size: 400, ...old });
  cloud.addFile(D.id, { id: 'd4', name: 'a4.jpg', quickXorHash: 'h4', size: 400, ...nw });
  cloud.addFile(D.id, { id: 'd4x', name: 'a4 (1).jpg', quickXorHash: 'h4', size: 400, ...nw });
  const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  scanId = scan.start([A, B, C, D]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
  actions = new ActionsService(db, cloud, review);
  batch = makeBatch();
});

const lineFor = (folder: string) => batch.preview(scanId).lines.find((l) => l.removeFolders.includes(folder))!;
/** O que o cliente envia: a ★ de cada grupo das linhas marcadas, como a prévia mostrou. */
function keepsFor(lineKeys: string[], keepFolders: Record<string, string> = {}): Record<string, string> {
  const keeps: Record<string, string> = {};
  for (const l of batch.preview(scanId).lines.filter((x) => lineKeys.includes(x.key))) {
    const folder = keepFolders[l.key] ?? l.keepFolder;
    for (const it of l.items) keeps[it.groupId] = folder === l.keepFolder ? it.keep.id : it.keepByFolder[folder];
  }
  return keeps;
}
function startBatch(lineKeys: string[], keepFolders: Record<string, string> = {}) {
  return batch.start(scanId, lineKeys, keepFolders, keepsFor(lineKeys, keepFolders));
}
function manualBatch(line: { key: string; items: Array<{ groupId: number }> }, status = 'paused', keepFolder: string | null = null): number {
  const { lastInsertRowid } = db.sql.prepare('INSERT INTO batches (scan_id, created_at, status) VALUES (?, ?, ?)').run(scanId, new Date().toISOString(), status);
  const id = Number(lastInsertRowid);
  line.items.forEach((it, i) =>
    db.sql.prepare("INSERT INTO batch_groups (batch_id, group_id, line_key, seq, status, keep_folder) VALUES (?, ?, ?, ?, 'pending', ?)").run(id, it.groupId, line.key, i, keepFolder));
  return id;
}
const inGroup = (gid: number) => (db.sql.prepare('SELECT file_id FROM dup_group_files WHERE group_id = ?').all(gid) as Array<{ file_id: string }>).map((r) => r.file_id);
const groupStatus = (gid: number) => (db.sql.prepare('SELECT status FROM dup_groups WHERE id = ?').get(gid) as { status: string }).status;

describe('BatchService', () => {
  it('prévia: pares de pastas diferentes viram linhas diferentes', () => {
    const p = batch.preview(scanId);
    expect(p.lines).toHaveLength(3);
    expect(p.pendingCount).toBe(4);
    expect(p.tiesCount).toBe(0);
  });

  it('prévia: empate fica fora das linhas', () => {
    setRules(db, [{ type: 'largestResolution' }]);
    const p = batch.preview(scanId);
    expect(p.lines).toHaveLength(0);
    expect(p.tiesCount).toBe(4);
  });

  it('prévia: análise rodando dá 400', () => {
    db.sql.prepare("UPDATE scans SET status = 'running' WHERE id = ?").run(scanId);
    expect(() => batch.preview(scanId)).toThrow('Espere a análise terminar para revisar em lote.');
  });

  it('executa só as linhas escolhidas, mantém a sugerida e registra no histórico', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', totalGroups: 2, doneGroups: 2, skippedGroups: 0, movedFiles: 2, movedBytes: 300, failedFiles: 0, restoredFiles: 0 });
    expect(cloud.isInTrash('b1') && cloud.isInTrash('b2')).toBe(true);
    for (const id of ['a1', 'a2', 'a3', 'c3']) expect(cloud.isInTrash(id)).toBe(false);
    expect(actions.history().every((h) => h.batchId === s.id)).toBe(true);
    expect(batch.list()).toHaveLength(1);
    await expectEveryGroupKeepsACopy();
  });

  it('arquivo que mudou e deixou de ser cópia: grupo é pulado, resolvido sem ele, nada movido', async () => {
    const line = lineFor('/B');
    const gid = line.items.find((i) => i.remove[0].id === 'b1')!.groupId;
    cloud.updateFile('b1', { size: 999 });
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 1, skippedGroups: 1, movedFiles: 1 });
    expect(cloud.isInTrash('b1')).toBe(false);
    expect(groupStatus(gid)).toBe('resolved');
    expect(inGroup(gid)).toEqual(['a1']);
    await expectEveryGroupKeepsACopy();
  });

  it('grupo de 3 cópias em que uma cópia que sai mudou: pulado, nada movido e segue pendente', async () => {
    const line = lineFor('/D');
    const gid = line.items[0].groupId;
    cloud.updateFile('d4', { quickXorHash: 'editada' });
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 0, skippedGroups: 1, movedFiles: 0 });
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(groupStatus(gid)).toBe('pending');
    expect(inGroup(gid).sort()).toEqual(['a4', 'd4x']);
    await expectEveryGroupKeepsACopy();
  });

  it('sugestão mudou de pasta (linha diferente) antes de o laço chegar: pulado, nada movido, segue pendente', async () => {
    const line = lineFor('/B');
    const id = manualBatch(line);
    setRules(db, [{ type: 'inFolder', path: '/B' }]);
    batch.resume(id);
    await batch.whenIdle(id);
    expect(batch.summary(id)).toMatchObject({ status: 'done', doneGroups: 0, skippedGroups: 2, movedFiles: 0 });
    expect(cloud.calls).not.toContain('moveToTrash');
    for (const it of line.items) expect(groupStatus(it.groupId)).toBe('pending');
    await expectEveryGroupKeepsACopy();
  });

  it('regras mudam entre a leitura do lote e o apply: reconferido dentro da trava, pulado', async () => {
    const line = lineFor('/B');
    const real = actions.apply.bind(actions);
    vi.spyOn(actions, 'apply').mockImplementation((...args) => {
      setRules(db, [{ type: 'inFolder', path: '/B' }]);
      return real(...args);
    });
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 0, skippedGroups: 2, movedFiles: 0 });
    expect(cloud.calls).not.toContain('moveToTrash');
    for (const it of line.items) expect(groupStatus(it.groupId)).toBe('pending');
    await expectEveryGroupKeepsACopy();
  });

  it('grupo que virou empate depois da prévia é pulado', async () => {
    const line = lineFor('/B');
    const s = { id: manualBatch(line) };
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
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 2, movedFiles: 2 });
    await expectEveryGroupKeepsACopy();
  });

  it('pausar e continuar', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
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
    const id = manualBatch(line, 'running');
    const fresh = makeBatch();
    fresh.onModuleInit();
    await fresh.whenIdle(id);
    expect(fresh.summary(id)).toMatchObject({ status: 'done', doneGroups: 2, movedFiles: 2 });
    await expectEveryGroupKeepsACopy();
  });

  it('só um lote por vez; chaves desconhecidas e lista vazia dão 400', async () => {
    const line = lineFor('/B');
    expect(() => startBatch(['nada'])).toThrow('A prévia mudou. Abra o lote de novo.');
    expect(() => startBatch([])).toThrow('Escolha pelo menos uma linha.');
    const s = startBatch([line.key]);
    expect(() => startBatch([lineFor('/C').key])).toThrow('Já existe um lote em andamento.');
    await batch.whenIdle(s.id);
    await expectEveryGroupKeepsACopy();
  });

  it('desfazer restaura tudo e os grupos voltam a pendente', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
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
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    cloud.purgeFromTrash('b1');
    batch.undo(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'undone', restoredFiles: 1, notRestoredFiles: 1 });
    await expectEveryGroupKeepsACopy();
  });

  it('erro antigo é limpo quando o lote volta a rodar e quando o desfazer começa', async () => {
    const line = lineFor('/B');
    const id = manualBatch(line);
    db.sql.prepare("UPDATE batches SET error = 'velho' WHERE id = ?").run(id);
    batch.resume(id);
    await batch.whenIdle(id);
    expect(batch.summary(id)).toMatchObject({ status: 'done', error: null });
    db.sql.prepare("UPDATE batches SET error = 'velho' WHERE id = ?").run(id);
    batch.undo(id);
    await batch.whenIdle(id);
    expect(batch.summary(id)).toMatchObject({ status: 'undone', error: null });
  });

  it('desfazer sem internet: espera em waiting-network, volta a undoing e termina', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    const seen: string[] = [];
    const b2 = new BatchService(db, review, actions, {
      offlineRetryMs: 0,
      sleep: async () => { seen.push(b2.summary(s.id).status); },
    });
    cloud.failNext('restore', new OfflineError(), 2);
    b2.undo(s.id);
    await b2.whenIdle(s.id);
    expect(seen).toEqual(['waiting-network', 'waiting-network']);
    expect(b2.summary(s.id)).toMatchObject({ status: 'undone', restoredFiles: 2, notRestoredFiles: 0 });
    await expectEveryGroupKeepsACopy();
  });

  it('reinício durante o desfazer (undoing ou waiting-network) continua o desfazer', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    for (const st of ['undoing', 'waiting-network']) {
      db.sql.prepare('UPDATE batches SET status = ? WHERE id = ?').run(st, s.id);
      const fresh = makeBatch();
      fresh.onModuleInit();
      await fresh.whenIdle(s.id);
      expect(fresh.summary(s.id).status).toBe('undone');
      expect(cloud.isInTrash('b1')).toBe(false);
      // refaz o lote para a próxima volta
      await actions.apply(line.items[0].groupId, ['b1'], { batchId: s.id });
      await actions.apply(line.items[1].groupId, ['b2'], { batchId: s.id });
    }
  });

  it('pausar durante o desfazer dá 400', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    db.sql.prepare("UPDATE batches SET status = 'undoing' WHERE id = ?").run(s.id);
    expect(() => batch.pause(s.id)).toThrow('Não dá para pausar enquanto desfaz.');
  });

  it('desfazer ignora ações que já foram desfeitas à mão', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    const first = (db.sql.prepare("SELECT id FROM actions WHERE batch_id = ? ORDER BY id").get(s.id) as { id: number }).id;
    await actions.undo(first);
    batch.undo(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'undone', restoredFiles: 2, notRestoredFiles: 0 });
  });

  it('desfazer à mão correndo junto com o desfazer do lote: não conta como não restaurado', async () => {
    const line = lineFor('/B');
    const s = startBatch([line.key]);
    await batch.whenIdle(s.id);
    const real = actions.undo.bind(actions);
    // A ação é desfeita à mão (outra aba) no meio da chamada do lote, que então falha.
    vi.spyOn(actions, 'undo').mockImplementationOnce(async (actionId) => {
      await real(actionId);
      throw new Error('Esta ação já foi desfeita.');
    });
    batch.undo(s.id);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'undone', restoredFiles: 2, notRestoredFiles: 0, error: null });
  });

  describe('mensagens de erro: só frases fixas em português, nunca a exceção crua', () => {
    it('erro inesperado num grupo: pulado, e o erro guardado é a frase fixa', async () => {
      const line = lineFor('/B');
      vi.spyOn(actions, 'apply').mockRejectedValueOnce(new Error('SQLITE_BOOM'));
      const s = startBatch([line.key]);
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({
        status: 'done', skippedGroups: 1, doneGroups: 1,
        error: 'Um grupo foi pulado por um erro inesperado e volta para a revisão um por um.',
      });
      await expectEveryGroupKeepsACopy();
    });

    it('erro inesperado que derruba a execução: status error com a frase fixa', async () => {
      const line = lineFor('/B');
      vi.spyOn(batch as unknown as { setGroupStatus: () => void }, 'setGroupStatus').mockImplementation(() => { throw new Error('SQLITE_BOOM'); });
      const s = startBatch([line.key]);
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({ status: 'error', error: 'O lote parou por um erro inesperado.' });
    });

    it('conexão expirada na execução: needs-auth sem texto cru', async () => {
      const line = lineFor('/B');
      vi.spyOn(actions, 'apply').mockRejectedValueOnce(new ReconnectRequiredError('token xyz revogado'));
      const s = startBatch([line.key]);
      await batch.whenIdle(s.id);
      const sum = batch.summary(s.id);
      expect(sum.status).toBe('needs-auth');
      expect(sum.error ?? '').not.toContain('xyz');
    });

    it('desfazer: conexão expirada para em error com a frase fixa; erro inesperado conta como não restaurado', async () => {
      const line = lineFor('/B');
      const s = startBatch([line.key]);
      await batch.whenIdle(s.id);
      const spy = vi.spyOn(actions, 'undo').mockRejectedValueOnce(new ReconnectRequiredError('token xyz revogado'));
      batch.undo(s.id);
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({ status: 'error', error: 'Reconecte o OneDrive para terminar de desfazer o lote.' });
      spy.mockRejectedValueOnce(new Error('SQLITE_BOOM'));
      batch.undo(s.id);
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({
        status: 'undone', notRestoredFiles: 1, restoredFiles: 1,
        error: 'Algum arquivo não foi restaurado por um erro inesperado. Confira no Histórico.',
      });
    });
  });

  describe('a ★ enviada é exatamente a da prévia', () => {
    const nBatches = () => (db.sql.prepare('SELECT COUNT(*) n FROM batches').get() as { n: number }).n;

    it('caminho feliz: fixa keep_id = a ★ enviada', () => {
      const line = lineFor('/B');
      const keeps = keepsFor([line.key]);
      const s = batch.start(scanId, [line.key], {}, keeps);
      const rows = db.sql.prepare('SELECT group_id, keep_id FROM batch_groups WHERE batch_id = ? ORDER BY seq').all(s.id) as Array<{ group_id: number; keep_id: string }>;
      expect(Object.fromEntries(rows.map((r) => [r.group_id, r.keep_id]))).toEqual(keeps);
    });

    it('grupo entrou na linha depois da prévia: 400 e nada é criado', async () => {
      // Um grupo resolvido à mão fica fora da prévia; desfeito em outra aba, volta para a mesma linha.
      const before = lineFor('/B');
      const gid = before.items[0].groupId;
      const r = await actions.apply(gid, before.items[0].remove.map((f) => f.id));
      const seen = lineFor('/B');
      expect(seen.items.map((i) => i.groupId)).not.toContain(gid);
      const keeps = keepsFor([seen.key]);
      await actions.undo(r.results[0].actionId!);
      expect(lineFor('/B').items.map((i) => i.groupId)).toContain(gid);
      expect(() => batch.start(scanId, [seen.key], {}, keeps)).toThrow('A prévia mudou. Abra o lote de novo.');
      expect(nBatches()).toBe(0);
    });

    it('grupo saiu da linha depois da prévia (resolvido em outra aba): 400 e nada é criado', async () => {
      const seen = lineFor('/B');
      const keeps = keepsFor([seen.key]);
      const gone = seen.items[0];
      await actions.apply(gone.groupId, gone.remove.map((f) => f.id));
      expect(lineFor('/B').items.map((i) => i.groupId)).not.toContain(gone.groupId);
      expect(() => batch.start(scanId, [seen.key], {}, keeps)).toThrow('A prévia mudou. Abra o lote de novo.');
      expect(nBatches()).toBe(0);
    });

    it('★ mudou depois da prévia: 400 e nada é criado', () => {
      const line = lineFor('/D');
      const keeps = keepsFor([line.key], { [line.key]: '/D' });
      expect(Object.values(keeps)).toEqual(['d4']);
      // Na prévia que a autora viu, a ★ em /D era d4x; hoje a regra escolhe d4.
      const seen = { [line.items[0].groupId]: 'd4x' };
      expect(() => batch.start(scanId, [line.key], { [line.key]: '/D' }, seen)).toThrow('A prévia mudou. Abra o lote de novo.');
      expect(nBatches()).toBe(0);
    });

    it('grupo enviado fora das linhas marcadas, grupo faltando ou keeps inválido: 400', () => {
      const b = lineFor('/B');
      const c = lineFor('/C');
      const keeps = keepsFor([b.key]);
      const extra = { ...keeps, ...keepsFor([c.key]) };
      expect(() => batch.start(scanId, [b.key], {}, extra)).toThrow('A prévia mudou. Abra o lote de novo.');
      const missing = { ...keeps };
      delete missing[b.items[0].groupId];
      expect(() => batch.start(scanId, [b.key], {}, missing)).toThrow('A prévia mudou. Abra o lote de novo.');
      for (const bad of [undefined, null, [], 'x', { [b.items[0].groupId]: 5 }]) {
        expect(() => batch.start(scanId, [b.key], {}, bad as never)).toThrow('A prévia mudou. Abra o lote de novo.');
      }
      expect(nBatches()).toBe(0);
    });
  });

  describe('inverter (escolher a pasta que fica)', () => {
    it('prévia traz keepOptions e a cópia que ficaria em cada pasta', () => {
      const d = lineFor('/D');
      expect(d.keepOptions).toEqual(['/A', '/D']);
      const item = d.items[0];
      expect(item.keep.id).toBe('a4');
      expect(item.keepByFolder).toEqual({ '/A': 'a4', '/D': 'd4' });
      expect(item.remove.map((r) => r.webUrl).every(Boolean)).toBe(true);
    });

    it('pasta fora das opções (ou de linha não marcada) dá 400 e nada é criado', () => {
      const line = lineFor('/B');
      expect(() => startBatch([line.key], { [line.key]: '/Z' })).toThrow('Pasta escolhida inválida. Abra o lote de novo.');
      expect(() => startBatch([line.key], { [lineFor('/C').key]: '/A' })).toThrow('Pasta escolhida inválida. Abra o lote de novo.');
      expect(db.sql.prepare('SELECT COUNT(*) n FROM batches').get()).toEqual({ n: 0 });
    });

    it('linha invertida move as cópias da pasta sugerida e mantém a da pasta escolhida', async () => {
      const line = lineFor('/B');
      const s = startBatch([line.key], { [line.key]: '/B' });
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 2, skippedGroups: 0, movedFiles: 2 });
      expect(cloud.isInTrash('a1') && cloud.isInTrash('a2')).toBe(true);
      for (const id of ['b1', 'b2', 'a3', 'c3', 'a4', 'd4', 'd4x']) expect(cloud.isInTrash(id)).toBe(false);
      await expectEveryGroupKeepsACopy();
    });

    it('escolher a própria pasta sugerida equivale a não inverter', async () => {
      const line = lineFor('/B');
      const s = startBatch([line.key], { [line.key]: line.keepFolder });
      await batch.whenIdle(s.id);
      expect(cloud.isInTrash('b1') && cloud.isInTrash('b2')).toBe(true);
      expect(cloud.isInTrash('a1') || cloud.isInTrash('a2')).toBe(false);
      await expectEveryGroupKeepsACopy();
    });

    it('pasta escolhida com 2 cópias: a regra desempata dentro dela e as outras saem', async () => {
      const line = lineFor('/D');
      const s = startBatch([line.key], { [line.key]: '/D' });
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 1, movedFiles: 2 });
      expect(cloud.isInTrash('a4') && cloud.isInTrash('d4x')).toBe(true);
      expect(cloud.isInTrash('d4')).toBe(false);
      await expectEveryGroupKeepsACopy();
    });

    it('composição mudou (regra mudou a linha): pulado também com inversão', async () => {
      const line = lineFor('/B');
      const id = manualBatch(line, 'paused', '/B');
      setRules(db, [{ type: 'inFolder', path: '/B' }]);
      batch.resume(id);
      await batch.whenIdle(id);
      expect(batch.summary(id)).toMatchObject({ status: 'done', doneGroups: 0, skippedGroups: 2, movedFiles: 0 });
      expect(cloud.calls).not.toContain('moveToTrash');
      await expectEveryGroupKeepsACopy();
    });

    it('a cópia da pasta escolhida mudou: grupo pulado, nada dele movido', async () => {
      const line = lineFor('/B');
      const gid = line.items.find((i) => i.remove[0].id === 'b1')!.groupId;
      const id = manualBatch(line, 'paused', '/B');
      cloud.updateFile('b1', { quickXorHash: 'outra' });
      batch.resume(id);
      await batch.whenIdle(id);
      expect(cloud.isInTrash('a1')).toBe(false);
      expect(cloud.isInTrash('b1')).toBe(false);
      expect(batch.summary(id).skippedGroups).toBeGreaterThanOrEqual(1);
      expect(inGroup(gid)).toEqual(['a1']);
      await expectEveryGroupKeepsACopy();
    });

    it('composição muda entre a leitura e a trava: reconferido dentro do apply, nada movido', async () => {
      const line = lineFor('/B');
      const real = actions.apply.bind(actions);
      vi.spyOn(actions, 'apply').mockImplementation((...args) => {
        setRules(db, [{ type: 'inFolder', path: '/B' }]);
        return real(...args);
      });
      const s = startBatch([line.key], { [line.key]: '/B' });
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({ doneGroups: 0, skippedGroups: 2, movedFiles: 0 });
      expect(cloud.calls).not.toContain('moveToTrash');
      await expectEveryGroupKeepsACopy();
    });

    it('keepFolders que não é objeto simples dá 400 e nada é criado', () => {
      const line = lineFor('/B');
      for (const bad of [[], null, 'x', 5, ['/A']]) {
        expect(() => batch.start(scanId, [line.key], bad as never)).toThrow('Pasta escolhida inválida. Abra o lote de novo.');
      }
      expect(db.sql.prepare('SELECT COUNT(*) n FROM batches').get()).toEqual({ n: 0 });
    });

    it('a cópia que fica é fixada ao iniciar (keep_id = a ★ da prévia)', () => {
      const line = lineFor('/D');
      const s = startBatch([line.key], { [line.key]: '/D' });
      const rows = db.sql.prepare('SELECT keep_id, keep_folder FROM batch_groups WHERE batch_id = ?').all(s.id);
      expect(rows).toEqual([{ keep_id: 'd4', keep_folder: '/D' }]);
    });

    it('cópia fixada na prévia difere da que a escolha atual manteria: pulado, nada movido', async () => {
      const line = lineFor('/D');
      const id = manualBatch(line, 'paused', '/D');
      // A prévia fixou d4x, mas hoje a regra escolheria d4 dentro de /D: nada pode ser movido.
      db.sql.prepare('UPDATE batch_groups SET keep_id = ? WHERE batch_id = ?').run('d4x', id);
      batch.resume(id);
      await batch.whenIdle(id);
      expect(batch.summary(id)).toMatchObject({ doneGroups: 0, skippedGroups: 1, movedFiles: 0 });
      expect(cloud.calls).not.toContain('moveToTrash');
      await expectEveryGroupKeepsACopy();
    });

    it('regra muda entre a leitura e a trava (com pasta escolhida): pulado', async () => {
      const line = lineFor('/D');
      const real = actions.apply.bind(actions);
      vi.spyOn(actions, 'apply').mockImplementation((...args) => {
        setRules(db, [{ type: 'largestSize' }]);
        return real(...args);
      });
      const s = startBatch([line.key], { [line.key]: '/D' });
      await batch.whenIdle(s.id);
      expect(batch.summary(s.id)).toMatchObject({ doneGroups: 0, skippedGroups: 1, movedFiles: 0 });
      expect(cloud.calls).not.toContain('moveToTrash');
      await expectEveryGroupKeepsACopy();
    });
  });
});

describe('BatchService: empate dentro da pasta escolhida', () => {
  it('pasta com 2 cópias empatadas (só a ordem alfabética decide) não é oferecida nem aceita', async () => {
    db = new Db(':memory:');
    cloud = new FakeCloudProvider();
    const E = cloud.addFolder(cloud.rootId, 'E');
    const F = cloud.addFolder(cloud.rootId, 'F');
    const old = { takenAt: '2010-01-01T00:00:00Z', createdAt: '2010-01-01T00:00:00Z', modifiedAt: '2010-01-01T00:00:00Z' };
    const nw = { takenAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z', modifiedAt: '2020-01-01T00:00:00Z' };
    cloud.addFile(E.id, { id: 'e1', name: 'm.jpg', quickXorHash: 'hm', size: 100, ...old });
    cloud.addFile(F.id, { id: 'f1', name: 'x.jpg', quickXorHash: 'hm', size: 100, ...nw });
    cloud.addFile(F.id, { id: 'f2', name: 'y.jpg', quickXorHash: 'hm', size: 100, ...nw });
    const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
    scanId = scan.start([E, F]);
    await scan.whenIdle(scanId);
    review = new ReviewService(db);
    actions = new ActionsService(db, cloud, review);
    batch = makeBatch();

    const line = batch.preview(scanId).lines[0];
    expect(line).toMatchObject({ keepFolder: '/E', removeFolders: ['/F'], keepOptions: ['/E'] });
    expect(line.items[0].keepByFolder).toEqual({ '/E': 'e1' });
    expect(() => batch.start(scanId, [line.key], { [line.key]: '/F' }, { [line.items[0].groupId]: 'f1' }))
      .toThrow('Pasta escolhida inválida. Abra o lote de novo.');
    expect(db.sql.prepare('SELECT COUNT(*) n FROM batches').get()).toEqual({ n: 0 });
  });
});

describe('BatchService: cópia fixada sem pasta escolhida', () => {
  it('duas cópias idênticas na pasta sugerida: fixa a sugestão global e move as outras (não pula)', async () => {
    db = new Db(':memory:');
    cloud = new FakeCloudProvider();
    const E = cloud.addFolder(cloud.rootId, 'E');
    const F = cloud.addFolder(cloud.rootId, 'F');
    const old = { takenAt: '2010-01-01T00:00:00Z', createdAt: '2010-01-01T00:00:00Z', modifiedAt: '2010-01-01T00:00:00Z' };
    const nw = { takenAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z', modifiedAt: '2020-01-01T00:00:00Z' };
    cloud.addFile(E.id, { id: 'e1', name: 'm.jpg', quickXorHash: 'hm', size: 100, ...old });
    cloud.addFile(E.id, { id: 'e2', name: 'm (1).jpg', quickXorHash: 'hm', size: 100, ...old });
    cloud.addFile(F.id, { id: 'f1', name: 'm.jpg', quickXorHash: 'hm', size: 100, ...nw });
    const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
    scanId = scan.start([E, F]);
    await scan.whenIdle(scanId);
    review = new ReviewService(db);
    actions = new ActionsService(db, cloud, review);
    batch = makeBatch();

    const line = batch.preview(scanId).lines[0];
    const globalKeep = line.items[0].keep.id;
    expect(globalKeep).toBe('e1');
    const s = startBatch([line.key]);
    const pinned = db.sql.prepare('SELECT keep_id FROM batch_groups WHERE batch_id = ?').get(s.id) as { keep_id: string };
    expect(pinned.keep_id).toBe(globalKeep);
    await batch.whenIdle(s.id);
    expect(batch.summary(s.id)).toMatchObject({ status: 'done', doneGroups: 1, skippedGroups: 0, movedFiles: 2 });
    expect(cloud.isInTrash('e1')).toBe(false);
    expect(cloud.isInTrash('e2') && cloud.isInTrash('f1')).toBe(true);
    await expectEveryGroupKeepsACopy();
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { BatchLine, BatchPreview, BatchSummary, FolderCluster, GroupView, ReconcilePlan, ScanSummary } from '@twinpix/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import type { FakeCloudProvider } from './cloud/fake-cloud-provider';
import { loadConfig } from './config';
import { DomainErrorFilter } from './http/domain-error.filter';
import { sessionMiddleware } from './security/session.middleware';
import { CLOUD_PROVIDER } from './tokens';

let app: INestApplication;
const T = 'tok';

beforeAll(async () => {
  const config = loadConfig(
    { TWINPIX_DATA_DIR: mkdtempSync(join(tmpdir(), 'twinpix-e2e-')), TWINPIX_SESSION_TOKEN: T },
    ['node', 'main.js', '--demo'],
  );
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  app = mod.createNestApplication({ logger: false });
  app.use(sessionMiddleware(config.sessionToken, config.allowedOrigins));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainErrorFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const api = () => ({
  get: (p: string) => request(app.getHttpServer()).get(p).set('X-TwinPix-Token', T),
  post: (p: string, body?: object) => request(app.getHttpServer()).post(p).set('X-TwinPix-Token', T).send(body ?? {}),
});

async function waitDone(id: number): Promise<ScanSummary> {
  for (let i = 0; i < 100; i++) {
    const { body } = await api().get(`/api/scans/${id}`);
    if (body.status === 'done') return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('varredura não terminou');
}

describe('API em modo demonstração', () => {
  it('fluxo completo: pastas → varredura → revisão → lixeira → desfazer', async () => {
    await request(app.getHttpServer()).get('/api/auth/status').expect(401);
    expect((await api().get('/api/auth/status')).body).toMatchObject({ connected: true, demo: true });

    const root = (await api().get('/api/folders/root')).body;
    const folders = (await api().get(`/api/folders/${encodeURIComponent(root.id)}/children`)).body;
    expect(folders.map((f: { name: string }) => f.name)).toEqual(['Imagens', 'Minhas imagens']);

    const nesting = (await api().post('/api/folders/check-nesting', { paths: ['/Imagens', '/Imagens/Imagens da Câmera'] })).body;
    expect(nesting).toHaveLength(1);

    const started = (await api().post('/api/scans', { roots: folders })).body as ScanSummary;
    const done = await waitDone(started.id);
    expect(done.groupsTotal).toBeGreaterThanOrEqual(10);
    expect(done.unanalyzedCount).toBe(1);

    const group = (await api().get(`/api/scans/${started.id}/groups/current`)).body as GroupView;
    expect(group.position).toBe(1);

    await api().post(`/api/groups/${group.id}/preview`, { deleteIds: group.files.map((f) => f.id) }).expect(400);
    const preview = (await api().post(`/api/groups/${group.id}/preview`, { deleteIds: group.preMarkedIds })).body;
    expect(preview.deleteFiles).toHaveLength(group.preMarkedIds.length);

    const applied = (await api().post(`/api/groups/${group.id}/apply`, { deleteIds: group.preMarkedIds })).body;
    expect(applied.stale).toBe(false);
    expect(applied.results.every((r: { status: string }) => r.status === 'done')).toBe(true);

    const history = (await api().get('/api/history')).body;
    expect(history.length).toBe(group.preMarkedIds.length);
    const undo = (await api().post(`/api/actions/${history[0].actionId}/undo`)).body;
    expect(undo.result).toBe('restored');

    expect((await api().get(`/api/files/${group.files[0].id}/thumbnail`)).body.url).toMatch(/^data:image\/svg\+xml/);
  });

  it('lote: prévia → executar (uma linha invertida) → cada grupo mantém uma cópia → desfazer', async () => {
    const root = (await api().get('/api/folders/root')).body;
    const folders = (await api().get(`/api/folders/${encodeURIComponent(root.id)}/children`)).body;
    const started = (await api().post('/api/scans', { roots: folders })).body as ScanSummary;
    await waitDone(started.id);

    const preview = (await api().get(`/api/scans/${started.id}/batch`)).body as BatchPreview;
    expect(preview.lines.length).toBeGreaterThanOrEqual(2);

    // Inverte uma linha que ofereça outra pasta para ficar com a cópia.
    const inverted = preview.lines.find((l: BatchLine) =>
      l.keepOptions.some((f) => f !== l.keepFolder && l.items.every((it) => it.keepByFolder[f])));
    const keepFolders: Record<string, string> = {};
    if (inverted) keepFolders[inverted.key] = inverted.keepOptions.find((f) => f !== inverted.keepFolder && inverted.items.every((it) => it.keepByFolder[f]))!;
    expect(Object.keys(keepFolders)).toHaveLength(1);

    // A ★ de cada grupo, exatamente como a prévia mostrou (o que o cliente envia).
    const keeps: Record<string, string> = {};
    for (const l of preview.lines) {
      const folder = keepFolders[l.key] ?? l.keepFolder;
      for (const it of l.items) keeps[it.groupId] = folder === l.keepFolder ? it.keep.id : it.keepByFolder[folder];
    }
    // Sem as ★, recusa: o lote só roda o que a autora viu.
    await api().post(`/api/scans/${started.id}/batch`, { lineKeys: preview.lines.map((l: BatchLine) => l.key), keepFolders }).expect(400);
    const sent = (await api().post(`/api/scans/${started.id}/batch`, { lineKeys: preview.lines.map((l: BatchLine) => l.key), keepFolders, keeps }).expect(200)).body as BatchSummary;
    let summary = sent;
    for (let i = 0; i < 200 && summary.status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      summary = (await api().get(`/api/batches/${sent.id}`)).body;
    }
    expect(summary.status).toBe('done');
    const groupsInLines = preview.lines.reduce((n: number, l: BatchLine) => n + l.items.length, 0);
    expect(summary).toMatchObject({ totalGroups: groupsInLines, doneGroups: groupsInLines, skippedGroups: 0, failedFiles: 0 });
    // Cada grupo move todas as cópias menos uma: nenhum grupo perde todas.
    const expectedMoved = preview.lines.reduce((n: number, l: BatchLine) => n + l.items.reduce((m, it) => m + it.remove.length, 0), 0);
    expect(summary.movedFiles).toBe(expectedMoved);
    // A ★ que a autora viu em cada grupo continua fora da lixeira; todas as outras cópias foram para lá.
    const cloud = app.get<FakeCloudProvider>(CLOUD_PROVIDER, { strict: false });
    for (const l of preview.lines) {
      for (const it of l.items) {
        const star = keeps[it.groupId];
        expect(await cloud.getItem(star), `★ ${star} do grupo ${it.groupId}`).not.toBeNull();
        expect(cloud.isInTrash(star), `★ ${star} do grupo ${it.groupId} foi para a lixeira`).toBe(false);
        for (const f of [it.keep, ...it.remove].filter((x) => x.id !== star)) expect(cloud.isInTrash(f.id)).toBe(true);
      }
    }

    // Os empates continuam pendentes para a revisão um por um.
    const after = (await api().get(`/api/scans/${started.id}/batch`)).body as BatchPreview;
    expect(after.lines).toHaveLength(0);
    expect(after.pendingCount).toBe(preview.pendingCount - groupsInLines);

    await api().post(`/api/batches/${sent.id}/undo`).expect(200);
    let undone = summary;
    for (let i = 0; i < 200 && undone.status !== 'undone'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      undone = (await api().get(`/api/batches/${sent.id}`)).body;
    }
    expect(undone.status).toBe('undone');
    expect(undone.restoredFiles).toBe(summary.movedFiles);
    expect(undone.notRestoredFiles).toBe(0);
  });

  it('reconciliação de pastas: conjunto 07-06-07 → prévia → executar → só as cópias da outra pasta vão à lixeira → desfazer', async () => {
    const root = (await api().get('/api/folders/root')).body;
    const folders = (await api().get(`/api/folders/${encodeURIComponent(root.id)}/children`)).body;
    const started = (await api().post('/api/scans', { roots: folders })).body as ScanSummary;
    await waitDone(started.id);
    const base = `/api/scans/${started.id}/folder-clusters`;

    const clusters = (await api().get(base)).body as FolderCluster[];
    const cluster = clusters.find((c) => c.folders.some((f) => f.path.endsWith('/07-06-07')) && c.folders.some((f) => f.path.endsWith('/minhas fotos/07-06-07')));
    expect(cluster, 'conjunto 07-06-07').toBeDefined();
    const keepFolder = cluster!.suggestedKeep;
    expect(keepFolder.endsWith('/Minhas imagens/07-06-07')).toBe(true);
    expect(cluster!.folders.find((f) => f.path.endsWith('/minhas fotos/07-06-07'))!.situation).toBe('contained');
    const otherFolders = cluster!.folders.map((f) => f.path).filter((p) => p !== keepFolder);

    const q = `key=${encodeURIComponent(cluster!.key)}&keep=${encodeURIComponent(keepFolder)}`;
    const plan = (await api().get(`${base}/plan?${q}`)).body as ReconcilePlan;
    expect(plan.items).toHaveLength(4);
    expect(plan.deleteFiles).toHaveLength(4);
    for (const f of plan.deleteFiles) expect(otherFolders).toContain(f.folderPath);
    for (const f of plan.keepFiles) expect(f.folderPath).toBe(keepFolder);

    const uniqueBefore = (await api().get(`${base}/unique?key=${encodeURIComponent(cluster!.key)}&folder=${encodeURIComponent(keepFolder)}`)).body as Array<{ id: string; name?: string }>;
    expect(uniqueBefore.map((u: { name?: string }) => u.name)).toContain('IMG_0005.JPG');
    // Sem os itens vistos, recusa.
    await api().post(`${base}/apply`, { key: cluster!.key, keepFolder }).expect(400);
    const sent = (await api().post(`${base}/apply`, { key: cluster!.key, keepFolder, items: plan.items }).expect(200)).body as BatchSummary;
    let summary = sent;
    for (let i = 0; i < 200 && summary.status !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      summary = (await api().get(`/api/batches/${sent.id}`)).body;
    }
    expect(summary.status).toBe('done');
    expect(summary).toMatchObject({ totalGroups: plan.items.length, doneGroups: plan.items.length, failedFiles: 0 });
    expect(summary.movedFiles).toBe(plan.deleteFiles.length);

    const cloud = app.get<FakeCloudProvider>(CLOUD_PROVIDER, { strict: false });
    for (const f of plan.deleteFiles) expect(cloud.isInTrash(f.id), `${f.name} deveria estar na lixeira`).toBe(true);
    for (const item of plan.items) {
      expect(cloud.isInTrash(item.keepId)).toBe(false);
      expect(await cloud.getItem(item.keepId)).not.toBeNull();
    }
    // Arquivos únicos nunca são tocados.
    for (const f of plan.deleteFiles) expect(f.folderPath.endsWith('/minhas fotos/07-06-07')).toBe(true);
    for (const u of uniqueBefore) expect(cloud.isInTrash(u.id), `único ${u.id}`).toBe(false);

    // Os arquivos que saíram não aparecem mais no conjunto/plano.
    const afterClusters = (await api().get(base)).body as FolderCluster[];
    expect(afterClusters.find((c) => c.key === cluster!.key)).toBeUndefined();
    await api().get(`${base}/plan?${q}`).expect(404);

    await api().post(`/api/batches/${sent.id}/undo`).expect(200);
    let undone = summary;
    for (let i = 0; i < 200 && undone.status !== 'undone'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      undone = (await api().get(`/api/batches/${sent.id}`)).body;
    }
    expect(undone.status).toBe('undone');
    expect(undone.restoredFiles).toBe(summary.movedFiles);
    expect(undone.notRestoredFiles).toBe(0);
    for (const f of plan.deleteFiles) expect(cloud.isInTrash(f.id)).toBe(false);
  });

  it('prováveis cópias: sem pré-marcação → aplicar uma cópia → desfazer; fora do lote', async () => {
    const root = (await api().get('/api/folders/root')).body;
    const folders = (await api().get(`/api/folders/${encodeURIComponent(root.id)}/children`)).body;
    const started = (await api().post('/api/scans', { roots: folders })).body as ScanSummary;
    const done = await waitDone(started.id);
    expect(done.probableTotal).toBeGreaterThanOrEqual(2);

    const group = (await api().get(`/api/scans/${started.id}/groups/current?kind=probable`)).body as GroupView;
    expect(group.files.length).toBeGreaterThanOrEqual(2);
    expect(group.preMarkedIds).toEqual([]);

    const victim = group.files.find((f) => f.id !== group.suggestion?.keepId) ?? group.files[1];
    const applied = (await api().post(`/api/groups/${group.id}/apply`, { deleteIds: [victim.id] })).body;
    expect(applied.stale).toBe(false);
    expect(applied.results.every((r: { status: string }) => r.status === 'done')).toBe(true);
    const cloud = app.get<FakeCloudProvider>(CLOUD_PROVIDER, { strict: false });
    expect(cloud.isInTrash(victim.id)).toBe(true);

    const history = (await api().get('/api/history')).body;
    const entry = history.find((h: { file: { id: string } }) => h.file.id === victim.id);
    expect(entry).toBeDefined();
    expect((await api().post(`/api/actions/${entry.actionId}/undo`)).body.result).toBe('restored');
    expect(cloud.isInTrash(victim.id)).toBe(false);

    // O lote só tem idênticas: nenhum grupo provável entra.
    const probableIds = new Set<number>([group.id]);
    const batch = (await api().get(`/api/scans/${started.id}/batch`)).body as BatchPreview;
    for (const l of batch.lines) for (const it of l.items) expect(probableIds.has(it.groupId)).toBe(false);
  });

  it('id de análise não numérico devolve 400 nas rotas de pastas repetidas', async () => {
    await api().get('/api/scans/abc/folder-clusters').expect(400);
    await api().get('/api/scans/abc/folder-clusters/plan?key=x&keep=y').expect(400);
    await api().post('/api/scans/abc/folder-clusters/apply', { key: 'x', keepFolder: 'y', items: [] }).expect(400);
  });

  it('link inválido devolve 400 com mensagem', async () => {
    const r = await api().post('/api/folders/resolve-link', { url: 'https://example.com' }).expect(400);
    expect(r.body.message).toBe('No modo demonstração, só dá para escolher as pastas fictícias da lista acima.');
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { BatchLine, BatchPreview, BatchSummary, GroupView, ScanSummary } from '@twinpix/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { DomainErrorFilter } from './http/domain-error.filter';
import { sessionMiddleware } from './security/session.middleware';

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

    const sent = (await api().post(`/api/scans/${started.id}/batch`, { lineKeys: preview.lines.map((l: BatchLine) => l.key), keepFolders }).expect(200)).body as BatchSummary;
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

  it('link inválido devolve 400 com mensagem', async () => {
    const r = await api().post('/api/folders/resolve-link', { url: 'https://example.com' }).expect(400);
    expect(r.body.message).toBe('No modo demonstração, só dá para escolher as pastas fictícias da lista acima.');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { Db } from '../storage/db';
import { ScanService } from './scan.service';

let db: Db;
let cloud: FakeCloudProvider;
let scan: ScanService;

function tree() {
  const a = cloud.addFolder(cloud.rootId, 'A');
  const sub = cloud.addFolder(a.id, 'Sub');
  const b = cloud.addFolder(cloud.rootId, 'B');
  cloud.addFile(a.id, { name: 'x.jpg', quickXorHash: 'h1', size: 10 });
  cloud.addFile(sub.id, { name: 'x 1.jpg', quickXorHash: 'h1', size: 10 });
  cloud.addFile(b.id, { name: 'y.jpg', quickXorHash: 'h2', size: 20 });
  cloud.addFile(b.id, { name: 'y 1.jpg', quickXorHash: 'h2', size: 20 });
  cloud.addFile(b.id, { name: 'sem-hash.jpg', quickXorHash: null });
  cloud.addFile(b.id, { name: 'unica.jpg', quickXorHash: 'h3', size: 30 });
  return { a, sub, b };
}

beforeEach(() => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  cloud.pageSize = 2;
  scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
});

describe('ScanService', () => {
  it('varre várias pastas com subpastas e agrupa idênticas entre elas', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    const s = scan.summary(id);
    expect(s.status).toBe('done');
    expect(s.filesFound).toBe(6);
    expect(s.foldersDone).toBe(3);
    expect(s.foldersTotal).toBe(3);
    expect(s.unanalyzedCount).toBe(1);
    expect(s.groupsTotal).toBe(2);
    expect(s.groupsPending).toBe(2);
    expect(scan.unanalyzed(id).map((f) => f.name)).toEqual(['sem-hash.jpg']);
  });

  it('pasta escolhida dentro de outra escolhida não duplica arquivos', async () => {
    const { a, sub } = tree();
    const id = scan.start([a, sub]);
    await scan.whenIdle(id);
    expect(scan.summary(id).filesFound).toBe(2);
    expect(scan.summary(id).groupsTotal).toBe(1);
  });

  it('sem internet: espera e continua sozinha', async () => {
    const { a } = tree();
    cloud.failNext('listChildren', new OfflineError(), 2);
    const id = scan.start([a]);
    await scan.whenIdle(id);
    expect(scan.summary(id).status).toBe('done');
    expect(scan.summary(id).filesFound).toBe(2);
  });

  it('token expirado: pausa pedindo reconexão e retoma sem perder nada', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    // nova varredura que falha logo na primeira chamada (a falha é registrada ANTES do start,
    // porque start() já chama listChildren de forma síncrona)
    cloud.failNext('listChildren', new ReconnectRequiredError());
    const id2 = scan.start([a, b]);
    await scan.whenIdle(id2);
    expect(scan.summary(id2).status).toBe('needs-auth');
    scan.resume(id2);
    await scan.whenIdle(id2);
    expect(scan.summary(id2)).toMatchObject({ status: 'done', filesFound: 6 });
  });

  it('pausar e retomar continua de onde parou, incluindo a página', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    scan.pause(id);
    await scan.whenIdle(id);
    expect(scan.summary(id).status).toBe('paused');
    scan.resume(id);
    await scan.whenIdle(id);
    expect(scan.summary(id)).toMatchObject({ status: 'done', filesFound: 6, groupsTotal: 2 });
  });

  it('retomada após reinício do app (onModuleInit) termina a varredura', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    scan.pause(id);
    await scan.whenIdle(id);
    db.sql.prepare("UPDATE scans SET status = 'running' WHERE id = ?").run(id);
    const again = new ScanService(db, cloud, { offlineRetryMs: 0 });
    again.onModuleInit();
    await again.whenIdle(id);
    expect(again.summary(id).status).toBe('done');
  });

  it('pasta sem permissão é pulada e o resto continua', async () => {
    const { a, b } = tree();
    cloud.failNext('listChildren', new ForbiddenError());
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    expect(scan.summary(id).status).toBe('done');
  });

  it('grupos ganham posição pela ordem de descoberta e não se repetem', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    const rows = db.sql.prepare('SELECT key, position FROM dup_groups WHERE scan_id = ? ORDER BY position').all(id);
    expect(rows).toEqual([
      { key: 'h1:10', position: 1 },
      { key: 'h2:20', position: 2 },
    ]);
  });

  it('latest devolve a varredura mais recente', async () => {
    const { a } = tree();
    expect(scan.latest()).toBeNull();
    const id = scan.start([a]);
    await scan.whenIdle(id);
    expect(scan.latest()?.id).toBe(id);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { ReviewService } from './review.service';
import { getRules, setRules } from './rules-settings';

let db: Db;
let review: ReviewService;
let scanId: number;

beforeEach(async () => {
  db = new Db(':memory:');
  const cloud = new FakeCloudProvider();
  const a = cloud.addFolder(cloud.rootId, 'A');
  for (const n of [1, 2, 3]) {
    cloud.addFile(a.id, { name: `f${n}.jpg`, quickXorHash: `h${n}`, size: n * 100, modifiedAt: '2015-01-01T00:00:00Z' });
    cloud.addFile(a.id, { name: `f${n} 1.jpg`, quickXorHash: `h${n}`, size: n * 100, modifiedAt: '2016-01-01T00:00:00Z' });
  }
  const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  scanId = scan.start([a]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
});

describe('ReviewService', () => {
  it('grupo atual começa no primeiro, com sugestão, motivo e pré-marcação', () => {
    const g = review.current(scanId)!;
    expect(g).toMatchObject({ position: 1, total: 3, kind: 'identical', status: 'pending' });
    expect(g.files.map((f) => f.name)).toEqual(['f1 1.jpg', 'f1.jpg']);
    const keep = g.files.find((f) => f.id === g.suggestion.keepId)!;
    expect(keep.name).toBe('f1.jpg');
    expect(g.suggestion.reason).toBe('regra: nome sem sufixo de cópia');
    expect(g.preMarkedIds).toEqual(g.files.filter((f) => f.id !== keep.id).map((f) => f.id));
  });

  it('pular vai para o próximo e o cursor é lembrado', () => {
    const g1 = review.current(scanId)!;
    const g2 = review.skip(g1.id)!;
    expect(g2.position).toBe(2);
    expect(review.current(scanId)!.id).toBe(g2.id);
  });

  it('voltar mostra o grupo anterior, mesmo já pulado', () => {
    const g1 = review.current(scanId)!;
    const g2 = review.skip(g1.id)!;
    const back = review.previous(g2.id)!;
    expect(back.id).toBe(g1.id);
    expect(back.status).toBe('skipped');
    expect(review.previous(g1.id)).toBeNull();
  });

  it('depois de pular todos, current é null; rever puladas recomeça', () => {
    let g = review.current(scanId);
    while (g) g = review.skip(g.id);
    expect(review.current(scanId)).toBeNull();
    review.unskipAll(scanId);
    expect(review.current(scanId)!.position).toBe(1);
  });

  it('usa as regras configuradas', () => {
    setRules(db, [{ type: 'oldestModified' }]);
    expect(getRules(db)).toEqual([{ type: 'oldestModified' }]);
    const g = review.current(scanId)!;
    expect(g.suggestion.reason).toBe('regra: mais antiga (modificada em)');
  });

  it('arquivo já na lixeira sai da lista do grupo', () => {
    const g = review.current(scanId)!;
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'done', 'x', 'x')")
      .run(g.id, g.preMarkedIds[0], g.suggestion.keepId);
    expect(review.activeFileIds(g.id)).toEqual([g.suggestion.keepId]);
  });

  it('arquivo levado para a lixeira por outra análise também sai do grupo', async () => {
    const g = review.current(scanId)!;
    db.sql.prepare("INSERT INTO dup_groups (scan_id, kind, key, position, status) VALUES (?, 'identical', 'outra', 99, 'pending')").run(scanId);
    const other = (db.sql.prepare("SELECT id FROM dup_groups WHERE key = 'outra'").get() as { id: number }).id;
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', 'x', 'x')")
      .run(other, g.preMarkedIds[0], g.suggestion.keepId);
    expect(review.activeFileIds(g.id)).toEqual([g.suggestion.keepId]);
  });
});

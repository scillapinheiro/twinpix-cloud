import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GroupStatus, GroupView } from '@twinpix/shared';
import { suggestKeep } from '../rules/suggest-keep';
import type { Db } from '../storage/db';
import { getFilesByIds } from '../storage/rows';
import { DB } from '../tokens';
import { getRules } from './rules-settings';

interface GroupRow { id: number; scan_id: number; position: number; status: GroupStatus }

@Injectable()
export class ReviewService {
  constructor(@Inject(DB) private readonly db: Db) {}

  activeFileIds(groupId: number): string[] {
    return (this.db.sql
      .prepare(
        `SELECT gf.file_id FROM dup_group_files gf
         WHERE gf.group_id = ?
           -- qualquer ação feita/pendente sobre o arquivo, em qualquer grupo de qualquer análise
           AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.file_id = gf.file_id AND a.status IN ('done','pending'))
         ORDER BY gf.file_id`,
      )
      .all(groupId) as Array<{ file_id: string }>).map((r) => r.file_id);
  }

  view(groupId: number): GroupView {
    const g = this.group(groupId);
    const files = getFilesByIds(this.db.sql, g.scan_id, this.activeFileIds(groupId));
    const suggestion = suggestKeep(files, getRules(this.db));
    const position = (this.db.sql
      .prepare('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND position <= ?')
      .get(g.scan_id, g.position) as { n: number }).n;
    const total = (this.db.sql.prepare('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ?').get(g.scan_id) as { n: number }).n;
    const bytesFreedSoFar = (this.db.sql
      .prepare(
        `SELECT COALESCE(SUM(f.size), 0) n FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         WHERE g.scan_id = ? AND a.status = 'done'`,
      )
      .get(g.scan_id) as { n: number }).n;
    return {
      id: g.id,
      scanId: g.scan_id,
      kind: 'identical',
      status: g.status,
      position,
      total,
      files,
      suggestion,
      preMarkedIds: files.filter((f) => f.id !== suggestion.keepId).map((f) => f.id),
      bytesFreedSoFar,
    };
  }

  current(scanId: number): GroupView | null {
    const sql = this.db.sql;
    const cursor = sql.prepare('SELECT cursor_group_id c FROM scans WHERE id = ?').get(scanId) as { c: number | null } | undefined;
    if (!cursor) throw new NotFoundException('Varredura não encontrada.');
    const cursorPos = cursor.c
      ? ((sql.prepare('SELECT position p FROM dup_groups WHERE id = ?').get(cursor.c) as { p: number } | undefined)?.p ?? 0)
      : 0;
    const pick = (q: string, ...p: unknown[]) => sql.prepare(q).get(...p) as { id: number } | undefined;
    const next =
      pick("SELECT id FROM dup_groups WHERE scan_id = ? AND status IN ('pending','stale') AND position >= ? ORDER BY position LIMIT 1", scanId, cursorPos) ??
      pick("SELECT id FROM dup_groups WHERE scan_id = ? AND status IN ('pending','stale') ORDER BY position LIMIT 1", scanId);
    if (!next) return null;
    sql.prepare('UPDATE scans SET cursor_group_id = ? WHERE id = ?').run(next.id, scanId);
    return this.view(next.id);
  }

  skip(groupId: number): GroupView | null {
    const g = this.group(groupId);
    this.db.sql.prepare("UPDATE dup_groups SET status = 'skipped' WHERE id = ? AND status IN ('pending','stale')").run(groupId);
    return this.current(g.scan_id);
  }

  previous(groupId: number): GroupView | null {
    const g = this.group(groupId);
    const prev = this.db.sql
      .prepare('SELECT id FROM dup_groups WHERE scan_id = ? AND position < ? ORDER BY position DESC LIMIT 1')
      .get(g.scan_id, g.position) as { id: number } | undefined;
    if (!prev) return null;
    this.db.sql.prepare('UPDATE scans SET cursor_group_id = ? WHERE id = ?').run(prev.id, g.scan_id);
    return this.view(prev.id);
  }

  unskipAll(scanId: number): void {
    this.db.sql.prepare("UPDATE dup_groups SET status = 'pending' WHERE scan_id = ? AND status = 'skipped'").run(scanId);
    this.db.sql.prepare('UPDATE scans SET cursor_group_id = NULL WHERE id = ?').run(scanId);
  }

  private group(groupId: number): GroupRow {
    const g = this.db.sql.prepare('SELECT id, scan_id, position, status FROM dup_groups WHERE id = ?').get(groupId) as GroupRow | undefined;
    if (!g) throw new NotFoundException('Grupo não encontrado.');
    return g;
  }
}

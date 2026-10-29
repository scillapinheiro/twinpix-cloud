import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GroupStatus, GroupView } from '@twinpix/shared';
import { suggestKeep } from '../rules/suggest-keep';
import type { Db } from '../storage/db';
import { getFilesByIds } from '../storage/rows';
import { DB } from '../tokens';
import { getRules } from './rules-settings';

type Kind = GroupView['kind'];
interface GroupRow { id: number; scan_id: number; kind: Kind; position: number; status: GroupStatus }

/** Condição SQL: o grupo (tabela com o alias dado) tem 2+ arquivos ativos (mesmo critério de activeFileIds). */
export const hasTwoActiveFiles = (alias: string) =>
  `(SELECT COUNT(*) FROM dup_group_files gf WHERE gf.group_id = ${alias}.id
     AND EXISTS (SELECT 1 FROM files f WHERE f.scan_id = ${alias}.scan_id AND f.id = gf.file_id)
     AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.file_id = gf.file_id AND a.status IN ('done','pending'))) >= 2`;

const cursorColumn = (kind: Kind) => (kind === 'probable' ? 'cursor_probable_id' : 'cursor_group_id');

@Injectable()
export class ReviewService {
  constructor(@Inject(DB) private readonly db: Db) {}

  activeFileIds(groupId: number): string[] {
    return (this.db.sql
      .prepare(
        `SELECT gf.file_id FROM dup_group_files gf
         JOIN dup_groups g ON g.id = gf.group_id
         WHERE gf.group_id = ?
           -- o arquivo ainda existe na análise (some dela quando sumiu do OneDrive)
           AND EXISTS (SELECT 1 FROM files f WHERE f.scan_id = g.scan_id AND f.id = gf.file_id)
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
      .prepare('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND kind = ? AND position <= ?')
      .get(g.scan_id, g.kind, g.position) as { n: number }).n;
    const total = (this.db.sql.prepare('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND kind = ?').get(g.scan_id, g.kind) as { n: number }).n;
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
      kind: g.kind,
      status: g.status,
      position,
      total,
      files,
      suggestion,
      // prováveis cópias nunca vêm pré-marcadas
      preMarkedIds: g.kind === 'probable' ? [] : files.filter((f) => f.id !== suggestion.keepId).map((f) => f.id),
      bytesFreedSoFar,
    };
  }

  current(scanId: number, kind: Kind = 'identical'): GroupView | null {
    const sql = this.db.sql;
    const col = cursorColumn(kind);
    const cursor = sql.prepare(`SELECT ${col} c FROM scans WHERE id = ?`).get(scanId) as { c: number | null } | undefined;
    if (!cursor) throw new NotFoundException('Varredura não encontrada.');
    const cursorPos = cursor.c
      ? ((sql.prepare('SELECT position p FROM dup_groups WHERE id = ?').get(cursor.c) as { p: number } | undefined)?.p ?? 0)
      : 0;
    // grupos com menos de 2 ativos (um arquivo saiu por outro grupo) são pulados sem mudar o status
    const pending = (sql
      .prepare("SELECT id, position FROM dup_groups WHERE scan_id = ? AND kind = ? AND status IN ('pending','stale') ORDER BY position")
      .all(scanId, kind) as Array<{ id: number; position: number }>);
    const ordered = [...pending.filter((g) => g.position >= cursorPos), ...pending.filter((g) => g.position < cursorPos)];
    const next = ordered.find((g) => this.activeFileIds(g.id).length >= 2);
    if (!next) return null;
    sql.prepare(`UPDATE scans SET ${col} = ? WHERE id = ?`).run(next.id, scanId);
    return this.view(next.id);
  }

  skip(groupId: number): GroupView | null {
    const g = this.group(groupId);
    this.db.sql.prepare("UPDATE dup_groups SET status = 'skipped' WHERE id = ? AND status IN ('pending','stale')").run(groupId);
    return this.current(g.scan_id, g.kind);
  }

  previous(groupId: number): GroupView | null {
    const g = this.group(groupId);
    const prev = this.db.sql
      .prepare('SELECT id FROM dup_groups WHERE scan_id = ? AND kind = ? AND position < ? ORDER BY position DESC LIMIT 1')
      .get(g.scan_id, g.kind, g.position) as { id: number } | undefined;
    if (!prev) return null;
    this.db.sql.prepare(`UPDATE scans SET ${cursorColumn(g.kind)} = ? WHERE id = ?`).run(prev.id, g.scan_id);
    return this.view(prev.id);
  }

  unskipAll(scanId: number, kind: Kind = 'identical'): void {
    this.db.sql.prepare("UPDATE dup_groups SET status = 'pending' WHERE scan_id = ? AND kind = ? AND status = 'skipped'").run(scanId, kind);
    this.db.sql.prepare(`UPDATE scans SET ${cursorColumn(kind)} = NULL WHERE id = ?`).run(scanId);
  }

  private group(groupId: number): GroupRow {
    const g = this.db.sql.prepare('SELECT id, scan_id, kind, position, status FROM dup_groups WHERE id = ?').get(groupId) as GroupRow | undefined;
    if (!g) throw new NotFoundException('Grupo não encontrado.');
    return g;
  }
}

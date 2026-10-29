import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { ActionResult, ActionStatus, ApplyResult, DeletionPreview, HistoryEntry, UndoResponse } from '@twinpix/shared';
import type { CloudProvider } from '../cloud/cloud-provider';
import { ReviewService } from '../review/review.service';
import type { Db } from '../storage/db';
import { getFilesByIds, nowIso, rowToItem, type FileRow } from '../storage/rows';
import { CLOUD_PROVIDER, DB } from '../tokens';
import { planDeletion } from './deletion-plan';

const ALREADY_GONE_NOTE = 'Já não estava no OneDrive.';

const UNDO_MESSAGES = {
  restored: 'Arquivo restaurado para a pasta original.',
  'not-in-trash': 'Não é mais possível restaurar: o arquivo já saiu da lixeira do OneDrive.',
  conflict:
    'Não foi possível restaurar: já existe um arquivo com o mesmo nome na pasta original, ou a pasta foi apagada. ' +
    'Confira a lixeira em onedrive.live.com.',
} as const;

@Injectable()
export class ActionsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider,
    private readonly review: ReviewService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverPending();
  }

  preview(groupId: number, deleteIds: string[]): DeletionPreview {
    const { scanId, plan } = this.plan(groupId, deleteIds);
    const deleteFiles = getFilesByIds(this.db.sql, scanId, plan.deleteIds);
    const keepFiles = getFilesByIds(this.db.sql, scanId, plan.keepIds);
    return { groupId, deleteFiles, keepFiles, bytes: deleteFiles.reduce((s, f) => s + f.size, 0) };
  }

  private readonly locks = new Map<number, Promise<unknown>>();

  /** Serializa operações do mesmo grupo (apply/undo) dentro do processo. */
  private withGroupLock<T>(groupId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(groupId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(groupId, tail);
    void tail.then(() => {
      if (this.locks.get(groupId) === tail) this.locks.delete(groupId);
    });
    return run;
  }

  apply(groupId: number, deleteIds: string[]): Promise<ApplyResult> {
    return this.withGroupLock(groupId, () => this.applyLocked(groupId, deleteIds));
  }

  private async applyLocked(groupId: number, deleteIds: string[]): Promise<ApplyResult> {
    const { scanId, plan } = this.plan(groupId, deleteIds);
    const stored = new Map(getFilesByIds(this.db.sql, scanId, [...plan.deleteIds, ...plan.keepIds]).map((f) => [f.id, f]));

    // Confere o que sai E o que fica antes de mover qualquer coisa.
    for (const id of [...plan.keepIds, ...plan.deleteIds]) {
      const current = await this.cloud.getItem(id);
      const before = stored.get(id)!;
      if (!current || current.quickXorHash !== before.quickXorHash || current.size !== before.size) {
        this.setGroupStatus(groupId, 'stale');
        return { groupId, stale: true, results: [] };
      }
    }

    const keptRef = plan.keepIds[0];
    const results: ActionResult[] = [];
    for (const id of plan.deleteIds) {
      const now = nowIso();
      const { lastInsertRowid } = this.db.sql
        .prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)")
        .run(groupId, id, keptRef, now, now);
      const actionId = Number(lastInsertRowid);
      let status: ActionStatus = 'done';
      let error: string | null = null;
      try {
        const moved = await this.cloud.moveToTrash(id);
        if (moved === 'already-gone') error = ALREADY_GONE_NOTE;
      } catch (e) {
        status = 'failed';
        error = (e as Error).message;
      }
      this.setActionStatus(actionId, status, error);
      results.push({ actionId, fileId: id, fileName: stored.get(id)!.name, status, error });
    }
    this.setGroupStatus(groupId, results.every((r) => r.status === 'done') ? 'resolved' : 'pending');
    return { groupId, stale: false, results };
  }

  async recoverPending(): Promise<void> {
    const pending = this.db.sql.prepare("SELECT id, file_id FROM actions WHERE status = 'pending'").all() as Array<{ id: number; file_id: string }>;
    for (const a of pending) {
      try {
        const item = await this.cloud.getItem(a.file_id);
        if (item) this.setActionStatus(a.id, 'failed', 'Interrompida antes de mover; nada foi alterado.');
        else this.setActionStatus(a.id, 'done', null);
      } catch {
        // Sem conexão agora: tenta de novo na próxima inicialização.
      }
    }
  }

  history(): HistoryEntry[] {
    const rows = this.db.sql
      .prepare(
        `SELECT a.id action_id, a.group_id, a.status, a.error, a.created_at action_created_at, f.*
         FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         ORDER BY a.id DESC`,
      )
      .all() as Array<FileRow & { action_id: number; group_id: number; status: ActionStatus; error: string | null; action_created_at: string }>;
    return rows.map((r) => ({
      actionId: r.action_id,
      groupId: r.group_id,
      file: rowToItem(r),
      status: r.status,
      error: r.error,
      createdAt: r.action_created_at,
    }));
  }

  undo(actionId: number): Promise<UndoResponse> {
    const row = this.db.sql.prepare('SELECT group_id FROM actions WHERE id = ?').get(actionId) as { group_id: number } | undefined;
    if (!row) throw new NotFoundException('Ação não encontrada.');
    return this.withGroupLock(row.group_id, () => this.undoLocked(actionId));
  }

  private async undoLocked(actionId: number): Promise<UndoResponse> {
    const a = this.db.sql.prepare('SELECT id, group_id, file_id, status, error FROM actions WHERE id = ?').get(actionId) as
      | { id: number; group_id: number; file_id: string; status: ActionStatus; error: string | null }
      | undefined;
    if (!a) throw new NotFoundException('Ação não encontrada.');
    if (a.status !== 'done') throw new BadRequestException('Só dá para desfazer arquivos que foram para a lixeira.');
    if (a.error === ALREADY_GONE_NOTE) return { result: 'not-in-trash', message: UNDO_MESSAGES['not-in-trash'] };
    const result = await this.cloud.restore(a.file_id);
    if (result === 'restored') {
      this.setActionStatus(a.id, 'undone', null);
      this.setGroupStatus(a.group_id, 'pending');
    }
    return { result, message: UNDO_MESSAGES[result] };
  }

  private plan(groupId: number, deleteIds: string[]) {
    const view = this.review.view(groupId);
    const plan = planDeletion(this.review.activeFileIds(groupId), Array.isArray(deleteIds) ? deleteIds : []);
    return { scanId: view.scanId, plan };
  }

  private setActionStatus(id: number, status: ActionStatus, error: string | null): void {
    this.db.sql.prepare('UPDATE actions SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, nowIso(), id);
  }

  private setGroupStatus(groupId: number, status: 'pending' | 'resolved' | 'stale'): void {
    this.db.sql.prepare('UPDATE dup_groups SET status = ? WHERE id = ?').run(status, groupId);
  }
}

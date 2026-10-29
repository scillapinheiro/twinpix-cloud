import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { ActionResult, ActionStatus, ApplyResult, DeletionPreview, HistoryEntry, UndoResponse } from '@twinpix/shared';
import type { CloudItem } from '@twinpix/shared';
import type { CloudProvider } from '../cloud/cloud-provider';
import { ForbiddenError } from '../cloud/errors';
import { ReviewService } from '../review/review.service';
import type { Db } from '../storage/db';
import { getFilesByIds, insertFile, nowIso, rowToItem, type FileRow } from '../storage/rows';
import { CLOUD_PROVIDER, DB } from '../tokens';
import { planDeletion } from './deletion-plan';

const ALREADY_GONE_NOTE = 'Já não estava no OneDrive.';
const UNCONFIRMED_NOTE = 'Não deu para confirmar se foi para a lixeira (sem conexão). Será conferido de novo.';
const INTERRUPTED_NOTE = 'Interrompida antes de mover; nada foi alterado.';

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

  private lock: Promise<unknown> = Promise.resolve();

  /**
   * Serializa TODAS as operações que mexem no OneDrive (apply/undo/acerto do diário), de qualquer
   * grupo e de qualquer análise: o mesmo arquivo pode estar em grupos de análises diferentes.
   */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  apply(groupId: number, deleteIds: string[], opts: { batchId?: number } = {}): Promise<ApplyResult> {
    return this.withLock(() => this.applyLocked(groupId, deleteIds, opts.batchId ?? null));
  }

  private async applyLocked(groupId: number, deleteIds: string[], batchId: number | null): Promise<ApplyResult> {
    // Acerta o diário antes de planejar: uma ação pendente pode ter (ou não) levado um arquivo.
    await this.recoverPendingLocked();
    const { scanId, plan } = this.plan(groupId, deleteIds);
    const stored = new Map(getFilesByIds(this.db.sql, scanId, [...plan.deleteIds, ...plan.keepIds]).map((f) => [f.id, f]));

    // Confere o que sai E o que fica antes de mover qualquer coisa.
    const fresh = new Map<string, CloudItem | null>();
    for (const id of [...plan.keepIds, ...plan.deleteIds]) fresh.set(id, await this.cloud.getItem(id));
    const changed = [...fresh].some(([id, current]) => {
      const before = stored.get(id)!;
      return !current || current.quickXorHash !== before.quickXorHash || current.size !== before.size;
    });
    if (changed) {
      this.refreshGroup(groupId, scanId, fresh);
      return { groupId, stale: true, results: [] };
    }

    const keptRef = plan.keepIds[0];
    const results: ActionResult[] = [];
    for (const id of plan.deleteIds) {
      const now = nowIso();
      const { lastInsertRowid } = this.db.sql
        .prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at, batch_id) VALUES (?, ?, ?, 'pending', ?, ?, ?)")
        .run(groupId, id, keptRef, now, now, batchId);
      const actionId = Number(lastInsertRowid);
      let status: ActionStatus = 'done';
      let error: string | null = null;
      try {
        const moved = await this.cloud.moveToTrash(id);
        if (moved === 'already-gone') error = ALREADY_GONE_NOTE;
      } catch (e) {
        ({ status, error } = await this.reconcileAfterError(id, e as Error));
      }
      this.setActionStatus(actionId, status, error);
      results.push({ actionId, fileId: id, fileName: stored.get(id)!.name, status, error });
    }
    this.setGroupStatus(groupId, results.every((r) => r.status === 'done') ? 'resolved' : 'pending');
    return { groupId, stale: false, results };
  }

  /**
   * Erro no DELETE nem sempre quer dizer que nada aconteceu: sem conexão ou 5xx podem chegar depois
   * de o OneDrive já ter movido o arquivo. Confere o estado real antes de registrar.
   */
  private async reconcileAfterError(id: string, e: Error): Promise<{ status: ActionStatus; error: string | null }> {
    if (e instanceof ForbiddenError) return { status: 'failed', error: e.message };
    try {
      const item = await this.cloud.getItem(id);
      return item ? { status: 'failed', error: e.message } : { status: 'done', error: null };
    } catch {
      return { status: 'pending', error: UNCONFIRMED_NOTE };
    }
  }

  /** Confere no OneDrive as ações que ficaram pendentes (app fechado no meio, ou sem conexão). */
  recoverPending(): Promise<void> {
    return this.withLock(() => this.recoverPendingLocked());
  }

  private async recoverPendingLocked(): Promise<void> {
    const pending = this.db.sql.prepare("SELECT id, file_id FROM actions WHERE status = 'pending'").all() as Array<{ id: number; file_id: string }>;
    for (const a of pending) {
      try {
        const item = await this.cloud.getItem(a.file_id);
        if (item) this.setActionStatus(a.id, 'failed', INTERRUPTED_NOTE);
        else this.setActionStatus(a.id, 'done', null);
      } catch {
        // Sem conexão agora: continua pendente e é conferida na próxima vez.
      }
    }
  }

  history(): HistoryEntry[] {
    const rows = this.db.sql
      .prepare(
        `SELECT a.id action_id, a.group_id, a.status, a.error, a.created_at action_created_at, a.batch_id, f.*
         FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         ORDER BY a.id DESC`,
      )
      .all() as Array<FileRow & { action_id: number; group_id: number; status: ActionStatus; error: string | null; action_created_at: string; batch_id: number | null }>;
    return rows.map((r) => ({
      actionId: r.action_id,
      groupId: r.group_id,
      file: rowToItem(r),
      status: r.status,
      error: r.error,
      createdAt: r.action_created_at,
      batchId: r.batch_id,
    }));
  }

  undo(actionId: number): Promise<UndoResponse> {
    const row = this.db.sql.prepare('SELECT id FROM actions WHERE id = ?').get(actionId);
    if (!row) throw new NotFoundException('Ação não encontrada.');
    return this.withLock(() => this.undoLocked(actionId));
  }

  private async undoLocked(actionId: number): Promise<UndoResponse> {
    const a = this.db.sql.prepare('SELECT id, group_id, file_id, status, error FROM actions WHERE id = ?').get(actionId) as
      | { id: number; group_id: number; file_id: string; status: ActionStatus; error: string | null }
      | undefined;
    if (!a) throw new NotFoundException('Ação não encontrada.');
    if (a.status !== 'done') throw new BadRequestException('Só dá para desfazer arquivos que foram para a lixeira.');
    const result = await this.cloud.restore(a.file_id);
    if (result === 'restored') {
      this.setActionStatus(a.id, 'undone', null);
      this.setGroupStatus(a.group_id, 'pending');
    }
    return { result, message: UNDO_MESSAGES[result] };
  }

  /**
   * O grupo mudou no OneDrive: grava a situação atual em vez de só marcar "desatualizado", para que a
   * próxima revisão mostre o grupo certo e uma nova tentativa possa dar certo.
   * - arquivo que sumiu sai do grupo (e da análise, se não tiver ações registradas);
   * - arquivo que mudou tem os dados atualizados e, se o conteúdo não bate mais com a chave do grupo
   *   (mesmo hash + tamanho), sai do grupo;
   * - sobrando menos de 2 cópias, não há mais o que revisar: o grupo fica resolvido.
   */
  private refreshGroup(groupId: number, scanId: number, fresh: Map<string, CloudItem | null>): void {
    const sql = this.db.sql;
    const { key } = sql.prepare('SELECT key FROM dup_groups WHERE id = ?').get(groupId) as { key: string };
    const removeFromGroup = sql.prepare('DELETE FROM dup_group_files WHERE group_id = ? AND file_id = ?');
    const hasActions = sql.prepare(
      'SELECT 1 FROM actions a JOIN dup_groups g ON g.id = a.group_id WHERE g.scan_id = ? AND a.file_id = ? LIMIT 1',
    );
    sql.transaction(() => {
      for (const [id, item] of fresh) {
        if (!item) {
          removeFromGroup.run(groupId, id);
          if (!hasActions.get(scanId, id)) sql.prepare('DELETE FROM files WHERE scan_id = ? AND id = ?').run(scanId, id);
          continue;
        }
        insertFile(sql, scanId, item, 'REPLACE');
        if (!item.quickXorHash || `${item.quickXorHash}:${item.size}` !== key) removeFromGroup.run(groupId, id);
      }
      this.setGroupStatus(groupId, this.review.activeFileIds(groupId).length < 2 ? 'resolved' : 'pending');
    })();
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

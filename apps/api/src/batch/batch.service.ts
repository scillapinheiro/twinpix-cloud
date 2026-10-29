import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { BatchPreview, GroupView, BatchStatus, BatchSummary } from '@twinpix/shared';
import { ActionsService } from '../actions/actions.service';
import { OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { ReviewService } from '../review/review.service';
import type { Db } from '../storage/db';
import { nowIso } from '../storage/rows';
import { suggestKeep } from '../rules/suggest-keep';
import { getRules } from '../review/rules-settings';
import { DB } from '../tokens';
import { buildBatchLines, lineKeyOf, type BatchGroupInput } from './batch-lines';

export const BATCH_OPTIONS = 'BATCH_OPTIONS';

export interface BatchOptions {
  offlineRetryMs: number;
  sleep?: (ms: number) => Promise<void>;
}

interface BatchGroupRow { group_id: number; line_key: string; keep_folder: string | null }

@Injectable()
export class BatchService implements OnModuleInit {
  private readonly running = new Map<number, Promise<void>>();
  private readonly pauseRequested = new Set<number>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly review: ReviewService,
    private readonly actions: ActionsService,
    @Inject(BATCH_OPTIONS) private readonly options: BatchOptions,
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  onModuleInit(): void {
    const rows = this.db.sql
      .prepare("SELECT id FROM batches WHERE status IN ('running', 'waiting-network', 'undoing')")
      .all() as Array<{ id: number }>;
    for (const r of rows) this.launch(r.id, this.isUndoMode(r.id) ? 'undo' : 'apply');
  }

  preview(scanId: number): BatchPreview {
    const sql = this.db.sql;
    const scan = sql.prepare('SELECT status FROM scans WHERE id = ?').get(scanId) as { status: string } | undefined;
    if (!scan) throw new NotFoundException('Varredura não encontrada.');
    if (scan.status === 'running' || scan.status === 'waiting-network') {
      throw new BadRequestException('Espere a análise terminar para revisar em lote.');
    }
    const ids = (sql
      .prepare("SELECT id FROM dup_groups WHERE scan_id = ? AND status = 'pending' AND kind = 'identical' ORDER BY position")
      .all(scanId) as Array<{ id: number }>).map((r) => r.id);
    const inputs: BatchGroupInput[] = ids.map((id) => {
      const v = this.review.view(id);
      const rules = getRules(this.db);
      const keepByFolder: Record<string, string> = {};
      for (const folder of new Set(v.files.map((f) => f.folderPath))) {
        keepByFolder[folder] = suggestKeep(v.files.filter((f) => f.folderPath === folder), rules).keepId;
      }
      return { groupId: id, kind: 'identical', files: v.files, suggestion: v.suggestion, keepByFolder };
    });
    const { lines, tiesCount } = buildBatchLines(inputs);
    return { scanId, lines, tiesCount, pendingCount: ids.length };
  }

  start(scanId: number, lineKeys: string[], keepFolders: Record<string, string> = {}): BatchSummary {
    if (!lineKeys.length) throw new BadRequestException('Escolha pelo menos uma linha.');
    const active = this.db.sql
      .prepare("SELECT 1 FROM batches WHERE status IN ('running', 'waiting-network', 'undoing') LIMIT 1")
      .get();
    if (active) throw new BadRequestException('Já existe um lote em andamento.');
    const { lines } = this.preview(scanId);
    const byKey = new Map(lines.map((l) => [l.key, l]));
    const chosen = [...new Set(lineKeys)].map((k) => byKey.get(k));
    if (chosen.some((l) => !l)) throw new BadRequestException('A prévia mudou. Abra o lote de novo.');
    const keepFor = new Map<string, string>();
    for (const [key, folder] of Object.entries(keepFolders)) {
      const line = byKey.get(key);
      if (!line || !chosen.includes(line) || typeof folder !== 'string' || !line.keepOptions.includes(folder)) {
        throw new BadRequestException('Pasta escolhida inválida. Abra o lote de novo.');
      }
      if (folder !== line.keepFolder) keepFor.set(key, folder);
    }

    const sql = this.db.sql;
    const id = sql.transaction(() => {
      const { lastInsertRowid } = sql
        .prepare("INSERT INTO batches (scan_id, created_at, status) VALUES (?, ?, 'running')")
        .run(scanId, nowIso());
      const batchId = Number(lastInsertRowid);
      let seq = 0;
      for (const line of chosen) {
        for (const item of line!.items) {
          sql.prepare("INSERT INTO batch_groups (batch_id, group_id, line_key, seq, status, keep_folder) VALUES (?, ?, ?, ?, 'pending', ?)")
            .run(batchId, item.groupId, line!.key, seq++, keepFor.get(line!.key) ?? null);
        }
      }
      return batchId;
    })();
    this.launch(id, 'apply');
    return this.summary(id);
  }

  /**
   * Desfazendo = 'undoing', ou 'waiting-network' sem grupos pendentes (o desfazer encerra os pendentes
   * ao começar; uma execução esperando rede sempre tem o grupo atual pendente).
   */
  private isUndoMode(id: number): boolean {
    const status = this.mustStatus(id);
    if (status === 'undoing') return true;
    if (status !== 'waiting-network') return false;
    return !this.db.sql.prepare("SELECT 1 FROM batch_groups WHERE batch_id = ? AND status = 'pending' LIMIT 1").get(id);
  }

  pause(id: number): BatchSummary {
    const status = this.mustStatus(id);
    if (this.isUndoMode(id)) throw new BadRequestException('Não dá para pausar enquanto desfaz.');
    if (this.running.has(id)) {
      this.pauseRequested.add(id);
    } else if (status === 'running' || status === 'waiting-network') {
      this.setStatus(id, 'paused');
    }
    return this.summary(id);
  }

  resume(id: number): BatchSummary {
    const status = this.mustStatus(id);
    this.pauseRequested.delete(id);
    if (!this.running.has(id) && ['paused', 'needs-auth', 'running', 'waiting-network'].includes(status)) {
      const other = this.db.sql
        .prepare("SELECT 1 FROM batches WHERE id != ? AND status IN ('running', 'waiting-network', 'undoing') LIMIT 1")
        .get(id);
      if (other) throw new BadRequestException('Já existe um lote em andamento.');
      this.launch(id, this.isUndoMode(id) ? 'undo' : 'apply');
    }
    return this.summary(id);
  }

  undo(id: number): BatchSummary {
    const status = this.mustStatus(id);
    if (this.running.has(id) || !['done', 'paused', 'error'].includes(status)) {
      throw new BadRequestException('Só dá para desfazer um lote que terminou ou está pausado.');
    }
    // Desfazer encerra o que faltava executar; não há como continuar a execução depois.
    this.db.sql.prepare("UPDATE batch_groups SET status = 'skipped' WHERE batch_id = ? AND status = 'pending'").run(id);
    this.setStatus(id, 'undoing');
    this.launch(id, 'undo');
    return this.summary(id);
  }

  whenIdle(id: number): Promise<void> {
    return this.running.get(id) ?? Promise.resolve();
  }

  list(): BatchSummary[] {
    return (this.db.sql.prepare('SELECT id FROM batches ORDER BY id DESC').all() as Array<{ id: number }>).map((r) => this.summary(r.id));
  }

  summary(id: number): BatchSummary {
    const sql = this.db.sql;
    const b = sql.prepare('SELECT scan_id, created_at, status, error, not_restored FROM batches WHERE id = ?').get(id) as
      | { scan_id: number; created_at: string; status: BatchStatus; error: string | null; not_restored: number }
      | undefined;
    if (!b) throw new NotFoundException('Lote não encontrado.');
    const n = (q: string) => (sql.prepare(q).get(id) as { n: number }).n;
    const actionCount = (status: string) =>
      n(`SELECT COUNT(*) n FROM actions WHERE batch_id = ? AND status = '${status}'`);
    return {
      id,
      scanId: b.scan_id,
      status: b.status,
      createdAt: b.created_at,
      totalGroups: n('SELECT COUNT(*) n FROM batch_groups WHERE batch_id = ?'),
      doneGroups: n("SELECT COUNT(*) n FROM batch_groups WHERE batch_id = ? AND status = 'done'"),
      skippedGroups: n("SELECT COUNT(*) n FROM batch_groups WHERE batch_id = ? AND status = 'skipped'"),
      movedFiles: actionCount('done'),
      movedBytes: n(
        `SELECT COALESCE(SUM(f.size), 0) n FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         WHERE a.batch_id = ? AND a.status = 'done'`,
      ),
      failedFiles: actionCount('failed'),
      restoredFiles: actionCount('undone'),
      notRestoredFiles: b.not_restored,
      error: b.error,
    };
  }

  private mustStatus(id: number): BatchStatus {
    const row = this.db.sql.prepare('SELECT status FROM batches WHERE id = ?').get(id) as { status: BatchStatus } | undefined;
    if (!row) throw new NotFoundException('Lote não encontrado.');
    return row.status;
  }

  private launch(id: number, mode: 'apply' | 'undo'): void {
    const job = (mode === 'apply' ? this.runApply(id) : this.runUndo(id)).finally(() => this.running.delete(id));
    this.running.set(id, job);
  }

  private async runApply(id: number): Promise<void> {
    try {
      await this.applyLoop(id);
    } catch (e) {
      this.setStatus(id, 'error', (e as Error).message);
    }
  }

  private async applyLoop(id: number): Promise<void> {
    const sql = this.db.sql;
    const batchId = id;
    sql.prepare('UPDATE batches SET error = NULL WHERE id = ?').run(id);
    this.setStatus(id, 'running');
    for (;;) {
      if (this.pauseRequested.delete(id)) {
        this.setStatus(id, 'paused');
        return;
      }
      const next = sql
        .prepare("SELECT group_id, line_key, keep_folder FROM batch_groups WHERE batch_id = ? AND status = 'pending' ORDER BY seq LIMIT 1")
        .get(id) as BatchGroupRow | undefined;
      if (!next) {
        this.setStatus(id, 'done');
        return;
      }
      try {
        const outcome = await this.processGroup(batchId, next);
        this.setGroupStatus(id, next.group_id, outcome);
      } catch (e) {
        if (e instanceof OfflineError) {
          this.setStatus(id, 'waiting-network');
          await this.sleep(this.options.offlineRetryMs);
          this.setStatus(id, 'running');
          continue;
        }
        if (e instanceof ReconnectRequiredError) {
          this.setStatus(id, 'needs-auth', e.message);
          return;
        }
        sql.prepare('UPDATE batches SET error = ? WHERE id = ?').run((e as Error).message, id);
        this.setGroupStatus(id, next.group_id, 'skipped');
      }
    }
  }

  private async processGroup(batchId: number, row: BatchGroupRow): Promise<'done' | 'skipped'> {
    const view = this.review.view(row.group_id);
    if (!this.stillMatches(view, row.line_key)) return 'skipped';
    // A mesma conferência roda de novo dentro da trava do ActionsService, com o grupo recalculado.
    const rules = getRules(this.db);
    // Com pasta escolhida, a cópia que fica é a regra aplicada só às cópias dessa pasta; senão, a sugerida.
    const pickKeep = (v: GroupView): string | null => {
      if (row.keep_folder === null) return v.suggestion.keepId;
      const candidates = v.files.filter((f) => f.folderPath === row.keep_folder);
      return candidates.length ? suggestKeep(candidates, rules).keepId : null;
    };
    const keepId = pickKeep(view);
    if (keepId === null) return 'skipped';
    const deleteIds = view.files.filter((f) => f.id !== keepId).map((f) => f.id);
    const expectedSuggested = view.suggestion.keepId;
    const result = await this.actions.apply(row.group_id, deleteIds, {
      batchId,
      expect: (v) =>
        v.suggestion.keepId === expectedSuggested &&
        this.stillMatches(v, row.line_key) &&
        pickKeep(v) === keepId &&
        v.files.some((f) => f.id === keepId) &&
        v.files.length === deleteIds.length + 1 &&
        deleteIds.every((id) => v.files.some((f) => f.id === id)),
    });
    return result.stale || result.skipped ? 'skipped' : 'done';
  }

  /** Grupo ainda pendente, com regra clara, e na mesma linha da prévia (mesma pasta que fica e mesmas pastas que saem). */
  private stillMatches(view: GroupView, lineKey: string): boolean {
    if (view.status !== 'pending' || view.suggestion.fallback) return false;
    const keep = view.files.find((f) => f.id === view.suggestion.keepId);
    if (!keep || view.preMarkedIds.length === 0) return false;
    const removeFolders = view.files.filter((f) => f.id !== keep.id).map((f) => f.folderPath);
    return lineKeyOf(keep.folderPath, [...new Set(removeFolders)]) === lineKey;
  }

  private async runUndo(id: number): Promise<void> {
    try {
      await this.undoLoop(id);
    } catch (e) {
      this.setStatus(id, 'error', (e as Error).message);
    }
  }

  private async undoLoop(id: number): Promise<void> {
    const sql = this.db.sql;
    this.setStatus(id, 'undoing');
    sql.prepare('UPDATE batches SET error = NULL WHERE id = ?').run(id);
    // Reinício no meio: as ações já restauradas viraram 'undone'; as não restauradas voltam a ser contadas.
    sql.prepare('UPDATE batches SET not_restored = 0 WHERE id = ?').run(id);
    const pending = (sql
      .prepare("SELECT id FROM actions WHERE batch_id = ? AND status = 'done' ORDER BY id DESC")
      .all(id) as Array<{ id: number }>).map((r) => r.id);
    for (const actionId of pending) {
      for (;;) {
        // Já desfeita à mão (um a um) enquanto o lote rodava: não conta como não restaurada.
        const current = sql.prepare('SELECT status FROM actions WHERE id = ?').get(actionId) as { status: string } | undefined;
        if (current?.status !== 'done') break;
        try {
          const r = await this.actions.undo(actionId);
          if (r.result !== 'restored') sql.prepare('UPDATE batches SET not_restored = not_restored + 1 WHERE id = ?').run(id);
          break;
        } catch (e) {
          if (e instanceof OfflineError) {
            this.setStatus(id, 'waiting-network');
            await this.sleep(this.options.offlineRetryMs);
            this.setStatus(id, 'undoing');
            continue;
          }
          if (e instanceof ReconnectRequiredError) {
            // 'error' (e não 'needs-auth') para que "continuar" nunca relance a execução no lugar do desfazer.
            this.setStatus(id, 'error', `Reconecte o OneDrive para terminar de desfazer o lote. ${e.message}`);
            return;
          }
          sql.prepare('UPDATE batches SET not_restored = not_restored + 1, error = ? WHERE id = ?').run((e as Error).message, id);
          break;
        }
      }
    }
    this.setStatus(id, 'undone');
  }

  private setStatus(id: number, status: BatchStatus, error: string | null = null): void {
    if (status === 'running' || status === 'done' || status === 'paused' || status === 'undone') {
      this.db.sql.prepare('UPDATE batches SET status = ? WHERE id = ?').run(status, id);
    } else {
      this.db.sql.prepare('UPDATE batches SET status = ?, error = COALESCE(?, error) WHERE id = ?').run(status, error, id);
    }
  }

  private setGroupStatus(batchId: number, groupId: number, status: 'done' | 'skipped'): void {
    this.db.sql.prepare('UPDATE batch_groups SET status = ? WHERE batch_id = ? AND group_id = ?').run(status, batchId, groupId);
  }
}

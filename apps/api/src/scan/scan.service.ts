import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { CloudFolder, CloudItem, ScanStatus, ScanSummary } from '@twinpix/shared';
import type { CloudProvider } from '../cloud/cloud-provider';
import { ForbiddenError, OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { groupIdentical } from '../grouping/group-identical';
import type { Db } from '../storage/db';
import { insertFile, nowIso, rowToItem, type FileRow } from '../storage/rows';
import { CLOUD_PROVIDER, DB } from '../tokens';

export const SCAN_OPTIONS = 'SCAN_OPTIONS';

export interface ScanOptions {
  offlineRetryMs: number;
  sleep?: (ms: number) => Promise<void>;
}

interface FolderRow { folder_id: string; path: string; page_token: string | null }

@Injectable()
export class ScanService implements OnModuleInit {
  private readonly running = new Map<number, Promise<void>>();
  private readonly pauseRequested = new Set<number>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider,
    @Inject(SCAN_OPTIONS) private readonly options: ScanOptions,
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  onModuleInit(): void {
    const rows = this.db.sql
      .prepare("SELECT id FROM scans WHERE status IN ('running', 'waiting-network')")
      .all() as Array<{ id: number }>;
    for (const { id } of rows) this.launch(id);
  }

  start(roots: CloudFolder[]): number {
    const sql = this.db.sql;
    const id = sql.transaction(() => {
      const { lastInsertRowid } = sql
        .prepare("INSERT INTO scans (created_at, status) VALUES (?, 'running')")
        .run(nowIso());
      const scanId = Number(lastInsertRowid);
      for (const r of roots) {
        sql.prepare('INSERT OR IGNORE INTO scan_roots (scan_id, folder_id, name, path, child_count) VALUES (?, ?, ?, ?, ?)')
          .run(scanId, r.id, r.name, r.path, r.childCount);
        this.enqueueFolder(scanId, r.id, r.path);
      }
      return scanId;
    })();
    this.launch(id);
    return id;
  }

  pause(scanId: number): void {
    if (this.running.has(scanId)) this.pauseRequested.add(scanId);
    else this.setStatus(scanId, 'paused');
  }

  resume(scanId: number): void {
    this.pauseRequested.delete(scanId);
    if (!this.running.has(scanId)) this.launch(scanId);
  }

  whenIdle(scanId: number): Promise<void> {
    return this.running.get(scanId) ?? Promise.resolve();
  }

  latest(): ScanSummary | null {
    const row = this.db.sql.prepare('SELECT id FROM scans ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
    return row ? this.summary(row.id) : null;
  }

  summary(scanId: number): ScanSummary {
    const sql = this.db.sql;
    const scan = sql.prepare('SELECT status, error FROM scans WHERE id = ?').get(scanId) as
      | { status: ScanStatus; error: string | null }
      | undefined;
    if (!scan) throw new Error(`Varredura ${scanId} não existe.`);
    const roots = (sql.prepare('SELECT folder_id, name, path, child_count FROM scan_roots WHERE scan_id = ?').all(scanId) as Array<{
      folder_id: string; name: string; path: string; child_count: number;
    }>).map((r) => ({ id: r.folder_id, name: r.name, path: r.path, childCount: r.child_count }));
    const count = (q: string, ...p: unknown[]) => (sql.prepare(q).get(scanId, ...p) as { n: number }).n;
    return {
      id: scanId,
      status: scan.status,
      roots,
      foldersDone: count("SELECT COUNT(*) n FROM scan_folders WHERE scan_id = ? AND status != 'pending'"),
      foldersTotal: count('SELECT COUNT(*) n FROM scan_folders WHERE scan_id = ?'),
      filesFound: count('SELECT COUNT(*) n FROM files WHERE scan_id = ?'),
      unanalyzedCount: count('SELECT COUNT(*) n FROM files WHERE scan_id = ? AND quick_xor_hash IS NULL'),
      groupsTotal: count('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ?'),
      groupsPending: count("SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND status IN ('pending', 'stale')"),
      groupsSkipped: count("SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND status = 'skipped'"),
      bytesFreed: (sql.prepare(
        `SELECT COALESCE(SUM(f.size), 0) n FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         WHERE g.scan_id = ? AND a.status = 'done'`,
      ).get(scanId) as { n: number }).n,
      error: scan.error,
    };
  }

  unanalyzed(scanId: number): CloudItem[] {
    const rows = this.db.sql
      .prepare('SELECT * FROM files WHERE scan_id = ? AND quick_xor_hash IS NULL ORDER BY folder_path, name')
      .all(scanId) as FileRow[];
    return rows.map(rowToItem);
  }

  private launch(scanId: number): void {
    const job = this.run(scanId).finally(() => this.running.delete(scanId));
    this.running.set(scanId, job);
  }

  private async run(scanId: number): Promise<void> {
    try {
      await this.runLoop(scanId);
    } catch (e) {
      this.setStatus(scanId, 'error', (e as Error).message);
    }
  }

  private async runLoop(scanId: number): Promise<void> {
    this.setStatus(scanId, 'running');
    for (;;) {
      if (this.pauseRequested.delete(scanId)) {
        this.setStatus(scanId, 'paused');
        return;
      }
      const folder = this.db.sql
        .prepare("SELECT folder_id, path, page_token FROM scan_folders WHERE scan_id = ? AND status = 'pending' ORDER BY seq LIMIT 1")
        .get(scanId) as FolderRow | undefined;
      if (!folder) {
        this.regroup(scanId);
        this.setStatus(scanId, 'done');
        return;
      }
      try {
        const finished = await this.processFolder(scanId, folder);
        if (!finished) continue; // pausa pedida no meio da pasta; o topo do laço trata
        this.regroup(scanId);
      } catch (e) {
        if (e instanceof OfflineError) {
          this.setStatus(scanId, 'waiting-network');
          await this.sleep(this.options.offlineRetryMs);
          this.setStatus(scanId, 'running');
          continue;
        }
        if (e instanceof ReconnectRequiredError) {
          this.setStatus(scanId, 'needs-auth', e.message);
          return;
        }
        if (e instanceof ForbiddenError) {
          this.db.sql.prepare("UPDATE scan_folders SET status = 'forbidden' WHERE scan_id = ? AND folder_id = ?")
            .run(scanId, folder.folder_id);
          continue;
        }
        this.setStatus(scanId, 'error', (e as Error).message);
        return;
      }
    }
  }

  /** Devolve false se parou no meio por pedido de pausa. */
  private async processFolder(scanId: number, folder: FolderRow): Promise<boolean> {
    const sql = this.db.sql;
    let token = folder.page_token;
    for (;;) {
      const page = await this.cloud.listChildren(folder.folder_id, token);
      sql.transaction(() => {
        for (const f of page.files) insertFile(sql, scanId, f);
        for (const sub of page.folders) this.enqueueFolder(scanId, sub.id, sub.path);
        sql.prepare('UPDATE scan_folders SET page_token = ? WHERE scan_id = ? AND folder_id = ?')
          .run(page.nextPageToken, scanId, folder.folder_id);
        if (!page.nextPageToken) {
          sql.prepare("UPDATE scan_folders SET status = 'done' WHERE scan_id = ? AND folder_id = ?")
            .run(scanId, folder.folder_id);
        }
      })();
      if (!page.nextPageToken) return true;
      token = page.nextPageToken;
      if (this.pauseRequested.has(scanId)) return false;
    }
  }

  private enqueueFolder(scanId: number, folderId: string, path: string): void {
    const sql = this.db.sql;
    const { n } = sql.prepare('SELECT COALESCE(MAX(seq), 0) + 1 n FROM scan_folders WHERE scan_id = ?').get(scanId) as { n: number };
    sql.prepare("INSERT OR IGNORE INTO scan_folders (scan_id, folder_id, path, status, seq) VALUES (?, ?, ?, 'pending', ?)")
      .run(scanId, folderId, path, n);
  }

  private regroup(scanId: number): void {
    const sql = this.db.sql;
    const files = sql
      .prepare('SELECT id, quick_xor_hash AS quickXorHash, size FROM files WHERE scan_id = ? AND quick_xor_hash IS NOT NULL ORDER BY folder_path, name')
      .all(scanId) as Array<{ id: string; quickXorHash: string; size: number }>;
    const order = new Map(files.map((f, i) => [f.id, i]));
    const firstIndex = (ids: string[]) => Math.min(...ids.map((id) => order.get(id) ?? Infinity));
    // grupos novos desta chamada: pela menor pasta/nome; a posição, uma vez gravada, nunca muda
    const groups = groupIdentical(files).sort((x, y) => firstIndex(x.fileIds) - firstIndex(y.fileIds));
    sql.transaction(() => {
      for (const g of groups) {
        let row = sql.prepare("SELECT id FROM dup_groups WHERE scan_id = ? AND kind = 'identical' AND key = ?").get(scanId, g.key) as
          | { id: number }
          | undefined;
        if (!row) {
          const { n } = sql.prepare('SELECT COALESCE(MAX(position), 0) + 1 n FROM dup_groups WHERE scan_id = ?').get(scanId) as { n: number };
          const { lastInsertRowid } = sql
            .prepare("INSERT INTO dup_groups (scan_id, kind, key, position, status) VALUES (?, 'identical', ?, ?, 'pending')")
            .run(scanId, g.key, n);
          row = { id: Number(lastInsertRowid) };
        }
        for (const fileId of g.fileIds) {
          sql.prepare('INSERT OR IGNORE INTO dup_group_files (group_id, file_id) VALUES (?, ?)').run(row.id, fileId);
        }
      }
    })();
  }

  private setStatus(scanId: number, status: ScanStatus, error: string | null = null): void {
    this.db.sql.prepare('UPDATE scans SET status = ?, error = ? WHERE id = ?').run(status, error, scanId);
  }
}

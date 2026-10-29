import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BatchSummary, CloudItem, FolderCluster, ReconcileItem, ReconcilePlan } from '@twinpix/shared';
import { BatchService } from '../batch/batch.service';
import { getRules } from '../review/rules-settings';
import { ReviewService } from '../review/review.service';
import { suggestKeep } from '../rules/suggest-keep';
import type { Db } from '../storage/db';
import { type FileRow, rowToItem } from '../storage/rows';
import { DB } from '../tokens';
import { findFolderClusters, type FolderGroupInput, uniqueFilesOf } from './folder-clusters';
import { planReconcile } from './reconcile-plan';

interface Snapshot {
  files: CloudItem[];
  groups: FolderGroupInput[];
  clusters: FolderCluster[];
}

@Injectable()
export class FoldersReconcileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly review: ReviewService,
    private readonly batch: BatchService,
  ) {}

  /** Sempre recalculado do banco: arquivos ativos e grupos de idênticas ainda não resolvidos. */
  private snapshot(scanId: number): Snapshot {
    const sql = this.db.sql;
    const scan = sql.prepare('SELECT status FROM scans WHERE id = ?').get(scanId) as { status: string } | undefined;
    if (!scan) throw new NotFoundException('Varredura não encontrada.');
    if (scan.status === 'running' || scan.status === 'waiting-network') {
      throw new BadRequestException('Espere a análise terminar para ver as pastas repetidas.');
    }
    const rows = sql
      .prepare(
        `SELECT * FROM files f WHERE f.scan_id = ?
           AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.file_id = f.id AND a.status IN ('done','pending'))
         ORDER BY f.folder_path, f.name, f.id`,
      )
      .all(scanId) as FileRow[];
    const files = rows.map(rowToItem);
    const groupIds = (sql
      .prepare("SELECT id FROM dup_groups WHERE scan_id = ? AND kind = 'identical' AND status != 'resolved' ORDER BY position")
      .all(scanId) as Array<{ id: number }>).map((r) => r.id);
    const groups = groupIds.map((groupId) => ({ groupId, fileIds: this.review.activeFileIds(groupId) }));
    return { files, groups, clusters: findFolderClusters(files, groups) };
  }

  private clusterOf(snap: Snapshot, key: string): FolderCluster {
    const c = snap.clusters.find((x) => x.key === key);
    if (!c) throw new NotFoundException('Esse conjunto de pastas não existe mais. Abra de novo.');
    return c;
  }

  clusters(scanId: number): FolderCluster[] {
    return this.snapshot(scanId).clusters;
  }

  unique(scanId: number, key: string, folder: string): CloudItem[] {
    const snap = this.snapshot(scanId);
    const cluster = this.clusterOf(snap, key);
    if (!cluster.folders.some((f) => f.path === folder)) throw new BadRequestException('Pasta escolhida inválida.');
    return uniqueFilesOf(cluster, folder, snap.files, snap.groups);
  }

  private buildPlan(snap: Snapshot, key: string, keep: string): ReconcilePlan {
    const cluster = this.clusterOf(snap, key);
    if (typeof keep !== 'string' || !cluster.folders.some((f) => f.path === keep)) throw new BadRequestException('Pasta escolhida inválida.');
    const rules = getRules(this.db);
    return planReconcile(cluster, keep, snap.files, snap.groups, (cands) => suggestKeep(cands, rules).keepId);
  }

  plan(scanId: number, key: string, keep: string): ReconcilePlan {
    return this.buildPlan(this.snapshot(scanId), key, keep);
  }

  apply(scanId: number, key: string, keepFolder: string, items: ReconcileItem[]): BatchSummary {
    const plan = this.buildPlan(this.snapshot(scanId), key, keepFolder);
    return this.batch.startFolders(scanId, plan, items);
  }
}

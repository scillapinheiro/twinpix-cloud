import type { CloudItem, MediaKind } from '@twinpix/shared';
import type Database from 'better-sqlite3';

export interface FileRow {
  scan_id: number;
  id: string;
  name: string;
  folder_path: string;
  size: number;
  quick_xor_hash: string | null;
  mime_type: string;
  kind: MediaKind;
  taken_at: string | null;
  created_at: string;
  modified_at: string;
  width: number | null;
  height: number | null;
  camera_make: string | null;
  camera_model: string | null;
  duration_ms: number | null;
  web_url: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function rowToItem(r: FileRow): CloudItem {
  return {
    id: r.id,
    name: r.name,
    folderPath: r.folder_path,
    size: r.size,
    quickXorHash: r.quick_xor_hash,
    mimeType: r.mime_type,
    kind: r.kind,
    takenAt: r.taken_at,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    width: r.width,
    height: r.height,
    cameraMake: r.camera_make,
    cameraModel: r.camera_model,
    durationMs: r.duration_ms,
    webUrl: r.web_url,
  };
}

export function insertFile(sql: Database.Database, scanId: number, i: CloudItem, mode: 'IGNORE' | 'REPLACE' = 'IGNORE'): void {
  sql
    .prepare(
      `INSERT OR ${mode} INTO files (scan_id, id, name, folder_path, size, quick_xor_hash, mime_type, kind,
        taken_at, created_at, modified_at, width, height, camera_make, camera_model, duration_ms, web_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scanId, i.id, i.name, i.folderPath, i.size, i.quickXorHash, i.mimeType, i.kind,
      i.takenAt, i.createdAt, i.modifiedAt, i.width, i.height, i.cameraMake, i.cameraModel,
      i.durationMs, i.webUrl,
    );
}

export function getFilesByIds(sql: Database.Database, scanId: number, ids: string[]): CloudItem[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = sql
    .prepare(`SELECT * FROM files WHERE scan_id = ? AND id IN (${placeholders}) ORDER BY folder_path, name`)
    .all(scanId, ...ids) as FileRow[];
  return rows.map(rowToItem);
}

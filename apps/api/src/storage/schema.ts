export const SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  cursor_group_id INTEGER
);
CREATE TABLE IF NOT EXISTS scan_roots (
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  child_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scan_id, folder_id)
);
CREATE TABLE IF NOT EXISTS scan_folders (
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  folder_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  page_token TEXT,
  seq INTEGER NOT NULL,
  PRIMARY KEY (scan_id, folder_id)
);
CREATE TABLE IF NOT EXISTS files (
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  quick_xor_hash TEXT,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  taken_at TEXT,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  camera_make TEXT,
  camera_model TEXT,
  duration_ms INTEGER,
  web_url TEXT NOT NULL,
  PRIMARY KEY (scan_id, id)
);
CREATE INDEX IF NOT EXISTS files_hash ON files (scan_id, quick_xor_hash, size);
CREATE TABLE IF NOT EXISTS dup_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (scan_id, kind, key)
);
CREATE TABLE IF NOT EXISTS dup_group_files (
  group_id INTEGER NOT NULL REFERENCES dup_groups(id),
  file_id TEXT NOT NULL,
  PRIMARY KEY (group_id, file_id)
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES dup_groups(id),
  file_id TEXT NOT NULL,
  kept_file_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  not_restored INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS batch_groups (
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  group_id INTEGER NOT NULL REFERENCES dup_groups(id),
  line_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  keep_folder TEXT,
  PRIMARY KEY (batch_id, group_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

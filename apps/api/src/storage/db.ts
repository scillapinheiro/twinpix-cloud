import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export class Db {
  readonly sql: Database.Database;

  constructor(file: string) {
    this.sql = new Database(file);
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('foreign_keys = ON');
    this.sql.exec(SCHEMA);
    this.migrate();
  }

  /** Migrações idempotentes para bancos criados com esquemas antigos. */
  private migrate(): void {
    const hasColumn = (table: string, column: string): boolean =>
      (this.sql.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
    if (!hasColumn('actions', 'batch_id')) {
      this.sql.exec('ALTER TABLE actions ADD COLUMN batch_id INTEGER REFERENCES batches(id)');
    }
    if (!hasColumn('batches', 'not_restored')) {
      this.sql.exec('ALTER TABLE batches ADD COLUMN not_restored INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn('batch_groups', 'keep_folder')) {
      this.sql.exec('ALTER TABLE batch_groups ADD COLUMN keep_folder TEXT');
    }
  }

  close(): void {
    this.sql.close();
  }
}

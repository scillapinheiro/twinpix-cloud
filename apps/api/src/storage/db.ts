import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export class Db {
  readonly sql: Database.Database;

  constructor(file: string) {
    this.sql = new Database(file);
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('foreign_keys = ON');
    this.sql.exec(SCHEMA);
  }

  close(): void {
    this.sql.close();
  }
}

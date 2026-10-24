import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 将现有 Worker 的 D1 调用原样落到 SQLite，批量操作必须在同一事务同步完成。 */
export class SqliteD1 {
  constructor(filename, migrationsDirectory) {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.sqlite = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    try {
      this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
      this.migrate(migrationsDirectory);
    } catch (error) { this.sqlite.close(); throw error; }
  }
  migrate(directory) {
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS _huitong_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const names = readdirSync(directory).filter(name => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
    if (!names.length) throw new Error('No database migrations found');
    const applied = this.sqlite.prepare('SELECT name, sha256 FROM _huitong_migrations').all();
    if (applied.some(row => !names.includes(row.name))) throw new Error('Applied migration is missing from release');
    for (const name of names) {
      const sql = readFileSync(join(directory, name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const previous = applied.find(row => row.name === name);
      if (previous) {
        if (previous.sha256 !== hash) throw new Error('Applied migration was modified');
        continue;
      }
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        this.sqlite.exec(sql);
        this.sqlite.prepare('INSERT INTO _huitong_migrations VALUES (?, ?, ?)').run(name, hash, new Date().toISOString());
        this.sqlite.exec('COMMIT');
      } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    }
  }
  prepare(sql) {
    const owner = this;
    function bound(values = []) {
      return {
        owner,
        bind(...parameters) { return bound(parameters); },
        async first() { return owner.sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: owner.sqlite.prepare(sql).all(...values) }; },
        execute() { const result = owner.sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
        async run() { return this.execute(); },
      };
    }
    return bound();
  }
  async batch(statements) {
    if (statements.some(statement => statement.owner !== this)) throw new Error('Statement belongs to another database');
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      // 不 await 单条语句，防止其他 HTTP 请求在事务中间插入操作。
      const result = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}

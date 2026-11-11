// Maps the Tauri SQL plugin interface onto Node's built-in SQLite for testing.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pools = new Map();

function toPositional(sql) {
  // $1, $2, ... → ?, ?, ...
  return sql.replace(/\$(\d+)/g, () => "?");
}

export default class MockPluginDatabase {
  constructor(handle) {
    this.handle = handle;
  }

  static async load(connection) {
    if (!pools.has(connection)) {
      const file = connection.replace(/^sqlite:/, "") || "test.db";
      const path = file.includes("/") ? file : join(mkdirSync(join(tmpdir(), `folio-test-${Date.now()}`), { recursive: true }), file);
      pools.set(connection, new MockPluginDatabase(new DatabaseSync(path)));
    }
    return pools.get(connection);
  }

  async execute(sql, params = []) {
    const converted = toPositional(sql);
    if (/^\s*(pragma)/i.test(converted)) {
      this.handle.exec(converted);
      return { rowsAffected: 0 };
    }
    if (/^\s*(select)/i.test(converted)) {
      this.handle.prepare(converted).all(...params);
      return { rowsAffected: 0 };
    }
    const statement = this.handle.prepare(converted);
    const result = statement.run(...params);
    return { rowsAffected: Number(result?.changes ?? 0) };
  }

  async select(sql, params = []) {
    return this.handle.prepare(toPositional(sql)).all(...params).map((row) => ({ ...row }));
  }
}

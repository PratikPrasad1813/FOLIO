import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { PgColumn, PgDialect, PgTable } from "drizzle-orm/pg-core";
import type { FolioDatabase } from "@/db";

type Row = Record<string, unknown>;

const globalForMockDb = globalThis as typeof globalThis & {
  __folioMockStore?: Map<string, Row[]>;
  __folioMockWarned?: boolean;
};

function getStore(): Map<string, Row[]> {
  if (!globalForMockDb.__folioMockStore) {
    globalForMockDb.__folioMockStore = new Map();
  }
  return globalForMockDb.__folioMockStore;
}

function getTableRows(tableName: string): Row[] {
  const store = getStore();
  let rows = store.get(tableName);
  if (!rows) {
    rows = [];
    store.set(tableName, rows);
  }
  return rows;
}

const dialect = new PgDialect();

function compileSql(expr: SQL): { sql: string; params: unknown[] } | null {
  try {
    return dialect.sqlToQuery(expr);
  } catch {
    return null;
  }
}

interface ColLookup {
  tableName: string;
  jsBySqlCol: Map<string, string>;
}

function buildLookup(tables: PgTable[]): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  for (const table of tables) {
    const tName = getTableName(table);
    const cols = getTableColumns(table);
    const jsBySql = new Map<string, string>();
    for (const [jsKey, col] of Object.entries(cols)) {
      jsBySql.set(col.name, jsKey);
    }
    map.set(tName, jsBySql);
  }
  return map;
}

function resolveField(
  lookup: Map<string, Map<string, string>>,
  rowByTable: Map<string, Row | null>,
  tableName: string,
  sqlCol: string,
): unknown {
  const row = rowByTable.get(tableName);
  if (!row) return undefined;
  const jsKey = lookup.get(tableName)?.get(sqlCol) ?? sqlCol;
  return row[jsKey];
}

function toComparable(v: unknown): number | string | boolean | null | undefined {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return ms;
  }
  return v as number | string | boolean | null | undefined;
}

function compareValues(a: unknown, b: unknown): number {
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (ca === cb) return 0;
  if (ca === null || ca === undefined) return -1;
  if (cb === null || cb === undefined) return 1;
  if (typeof ca === "number" && typeof cb === "number") return ca - cb;
  return String(ca) < String(cb) ? -1 : 1;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return toComparable(a) === toComparable(b);
}

/**
 * Lightweight recursive-descent evaluator for compiled Drizzle WHERE / JOIN
 * SQL fragments (`"t"."c" = $1`, `and`, `or`, `in`, `is null`, `>`, `<`, `ilike`).
 * Unknown complex Postgres expressions safely evaluate to `true` so queries
 * never crash when the database is mocked.
 */
function evaluateSql(
  sqlText: string,
  params: unknown[],
  lookup: Map<string, Map<string, string>>,
  rowByTable: Map<string, Row | null>,
): boolean {
  const trimmed = sqlText.trim();
  if (!trimmed) return true;

  // Strip matching outer parentheses
  let s = trimmed;
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth === 0 && i < s.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (wrapsAll) s = s.slice(1, -1).trim();
    else break;
  }

  // Split top-level ` or ` / ` and `
  const splitTopLevel = (text: string, sep: string): string[] | null => {
    const parts: string[] = [];
    let depth = 0;
    let inSingleQuote = false;
    let last = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'" && text[i - 1] !== "\\") inSingleQuote = !inSingleQuote;
      if (inSingleQuote) continue;
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && text.slice(i, i + sep.length).toLowerCase() === sep) {
        parts.push(text.slice(last, i));
        i += sep.length - 1;
        last = i + 1;
      }
    }
    if (!parts.length) return null;
    parts.push(text.slice(last));
    return parts;
  };

  const orParts = splitTopLevel(s, " or ");
  if (orParts) {
    return orParts.some((part) => evaluateSql(part, params, lookup, rowByTable));
  }
  const andParts = splitTopLevel(s, " and ");
  if (andParts) {
    return andParts.every((part) => evaluateSql(part, params, lookup, rowByTable));
  }

  if (s.toLowerCase().startsWith("not ")) {
    return !evaluateSql(s.slice(4), params, lookup, rowByTable);
  }

  // Join / excluded column comparison: "t1"."c1" <= excluded.c2 (or =)
  const twoColMatch = /^"?([^"\s.]+)"?\."?([^"\s.]+)"?\s*(=|<>|!=|>=|<=|>|<)\s*"?([^"\s.]+)"?\."?([^"\s.]+)"?$/.exec(s);
  if (twoColMatch) {
    const left = resolveField(lookup, rowByTable, twoColMatch[1], twoColMatch[2]);
    const right = resolveField(lookup, rowByTable, twoColMatch[4], twoColMatch[5]);
    if (left === undefined || right === undefined) return false;
    const op = twoColMatch[3];
    if (op === "=") return valuesEqual(left, right);
    if (op === "<>" || op === "!=") return !valuesEqual(left, right);
    if (op === ">") return left != null && compareValues(left, right) > 0;
    if (op === ">=") return left != null && compareValues(left, right) >= 0;
    if (op === "<") return left != null && compareValues(left, right) < 0;
    if (op === "<=") return left != null && compareValues(left, right) <= 0;
  }

  // Column IS NULL / IS NOT NULL
  const nullMatch = /^"([^"]+)"\."([^"]+)"\s+is\s+(not\s+)?null$/i.exec(s);
  if (nullMatch) {
    const val = resolveField(lookup, rowByTable, nullMatch[1], nullMatch[2]);
    const isNull = val === null || val === undefined;
    return nullMatch[3] ? !isNull : isNull;
  }

  // Column IN ($1, $2, ...)
  const inMatch = /^"([^"]+)"\."([^"]+)"\s+in\s*\(([^)]+)\)$/i.exec(s);
  if (inMatch) {
    const val = resolveField(lookup, rowByTable, inMatch[1], inMatch[2]);
    const list = inMatch[3]
      .split(",")
      .map((token) => {
        const p = /^\$(\d+)$/.exec(token.trim());
        return p ? params[Number(p[1]) - 1] : token.trim().replace(/^'|'$/g, "");
      });
    return list.some((candidate) => valuesEqual(val, candidate));
  }

  // Column OP $N or literal
  const cmpMatch = /^"([^"]+)"\."([^"]+)"\s*(=|<>|!=|>=|<=|>|<|ilike|like)\s*(.+)$/i.exec(s);
  if (cmpMatch) {
    const left = resolveField(lookup, rowByTable, cmpMatch[1], cmpMatch[2]);
    const op = cmpMatch[3].toLowerCase();
    const rhsRaw = cmpMatch[4].trim();
    const paramMatch = /^\$(\d+)$/.exec(rhsRaw);
    const right = paramMatch
      ? params[Number(paramMatch[1]) - 1]
      : rhsRaw === "true"
        ? true
        : rhsRaw === "false"
          ? false
          : rhsRaw.replace(/^'|'$/g, "");

    if (op === "=") return valuesEqual(left, right);
    if (op === "<>" || op === "!=") return !valuesEqual(left, right);
    if (op === ">") return left != null && compareValues(left, right) > 0;
    if (op === ">=") return left != null && compareValues(left, right) >= 0;
    if (op === "<") return left != null && compareValues(left, right) < 0;
    if (op === "<=") return left != null && compareValues(left, right) <= 0;
    if (op === "ilike" || op === "like") {
      const pattern = String(right).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
      return new RegExp(`^${pattern}$`, op === "ilike" ? "i" : "").test(String(left ?? ""));
    }
  }

  return true;
}

function projectRow(
  selection: Record<string, unknown> | undefined,
  primaryTable: PgTable,
  rowByTable: Map<string, Row | null>,
): unknown {
  const primaryName = getTableName(primaryTable);
  const primaryRow = rowByTable.get(primaryName);
  if (!selection) return primaryRow ? { ...primaryRow } : null;

  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(selection)) {
    if (spec instanceof PgColumn) {
      const tName = getTableName(spec.table);
      const r = rowByTable.get(tName);
      const cols = getTableColumns(spec.table);
      const jsKey = Object.entries(cols).find(([, col]) => col.name === spec.name)?.[0] ?? spec.name;
      out[key] = r ? r[jsKey] ?? null : null;
    } else if (spec instanceof PgTable) {
      const tName = getTableName(spec);
      const r = rowByTable.get(tName);
      out[key] = r ? { ...r } : null;
    } else if (is(spec, SQL)) {
      const compiled = compileSql(spec);
      if (compiled && /count\(\*\)/i.test(compiled.sql)) {
        out[key] = 1;
      } else {
        out[key] = null;
      }
    } else {
      out[key] = null;
    }
  }
  return out;
}

function applyDefaults(table: PgTable, input: Row): Row {
  const cols = getTableColumns(table);
  const row: Row = { ...input };
  for (const [jsKey, col] of Object.entries(cols)) {
    if (row[jsKey] !== undefined) continue;
    if (col.columnType === "PgUUID" && jsKey === "id") {
      row[jsKey] = randomUUID();
    } else if (col.columnType === "PgTimestamp" && col.hasDefault) {
      row[jsKey] = new Date();
    } else if (col.hasDefault && col.default !== undefined && !is(col.default, SQL)) {
      row[jsKey] = typeof col.default === "object" && col.default !== null
        ? structuredClone(col.default)
        : col.default;
    } else {
      row[jsKey] = null;
    }
  }
  return row;
}

export function createMockDb(): FolioDatabase {
  if (!globalForMockDb.__folioMockWarned) {
    globalForMockDb.__folioMockWarned = true;
    console.warn("[AI Studio] Database not connected — using in-memory mock");
  }

  const mockDb = {
    select(selection?: Record<string, unknown>) {
      let primaryTable: PgTable | null = null;
      const joins: { type: "inner" | "left"; table: PgTable; on: SQL }[] = [];
      let whereExpr: SQL | undefined;
      let limitCount: number | undefined;
      let offsetCount = 0;

      const executeSelect = async () => {
        if (!primaryTable) return [];
        const pName = getTableName(primaryTable);
        const tables: PgTable[] = [primaryTable, ...joins.map((j) => j.table)];
        const lookup = buildLookup(tables);
        const pRows = getTableRows(pName);

        let joined: Map<string, Row | null>[] = pRows.map((r) => new Map([[pName, r]]));

        for (const join of joins) {
          const jName = getTableName(join.table);
          const jRows = getTableRows(jName);
          const compiled = compileSql(join.on);
          const nextJoined: Map<string, Row | null>[] = [];
          for (const entry of joined) {
            let matched = false;
            for (const jr of jRows) {
              const candidate = new Map(entry);
              candidate.set(jName, jr);
              const ok = compiled ? evaluateSql(compiled.sql, compiled.params, lookup, candidate) : true;
              if (ok) {
                matched = true;
                nextJoined.push(candidate);
              }
            }
            if (!matched && join.type === "left") {
              const candidate = new Map(entry);
              candidate.set(jName, null);
              nextJoined.push(candidate);
            }
          }
          joined = nextJoined;
        }

        if (whereExpr) {
          const compiled = compileSql(whereExpr);
          if (compiled) {
            joined = joined.filter((rowMap) => evaluateSql(compiled.sql, compiled.params, lookup, rowMap));
          }
        }

        // Handle count(*) aggregate selections accurately
        if (selection) {
          const entries = Object.entries(selection);
          const hasCount = entries.some(([, v]) => is(v, SQL) && /count\(\*\)/i.test(compileSql(v)?.sql ?? ""));
          if (hasCount && entries.length === 1) {
            const [key] = entries[0];
            return [{ [key]: joined.length }];
          }
        }

        const sliced = joined.slice(offsetCount, limitCount !== undefined ? offsetCount + limitCount : undefined);
        return sliced.map((rowMap) => projectRow(selection, primaryTable!, rowMap));
      };

      const builder: Record<string, unknown> = {
        from(table: PgTable) {
          primaryTable = table;
          return builder;
        },
        innerJoin(table: PgTable, on: SQL) {
          joins.push({ type: "inner", table, on });
          return builder;
        },
        leftJoin(table: PgTable, on: SQL) {
          joins.push({ type: "left", table, on });
          return builder;
        },
        where(expr?: SQL) {
          whereExpr = expr;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit(n: number) {
          limitCount = n;
          return builder;
        },
        offset(n: number) {
          offsetCount = n;
          return builder;
        },
        for() {
          return builder;
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
          return executeSelect().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    insert(table: PgTable) {
      const tableName = getTableName(table);
      let inputValues: Row[] = [];
      let ignoreConflict = false;
      let conflictTargetCols: PgColumn[] = [];
      let conflictSet: Row | null = null;
      let conflictSetWhere: SQL | undefined;
      let returningSelection: Record<string, unknown> | undefined;

      const executeInsert = async () => {
        const rows = getTableRows(tableName);
        const cols = getTableColumns(table);
        const lookup = buildLookup([table]);
        const tableJsMap = lookup.get(tableName);
        if (tableJsMap) lookup.set("excluded", tableJsMap);
        const resultRows: Row[] = [];

        const targetJsKeys = conflictTargetCols.map(
          (col) => Object.entries(cols).find(([, c]) => c.name === col.name)?.[0] ?? col.name,
        );

        for (const raw of inputValues) {
          const candidate = applyDefaults(table, raw);
          const uniqueKeys = targetJsKeys.length
            ? targetJsKeys
            : ["id", "email", "tokenHash", "key", "userId"].filter((k) => {
                if (!(k in cols) || candidate[k] == null) return false;
                if (k === "id") return true;
                return k !== "userId" || tableName === "folio_notification_prefs" || tableName === "folio_ai_preferences" || tableName === "folio_google_accounts";
              });

          const existing = uniqueKeys.length
            ? rows.find((r) => uniqueKeys.every((k) => valuesEqual(r[k], candidate[k])))
            : undefined;

          if (existing) {
            if (ignoreConflict) continue;
            if (conflictSet) {
              if (conflictSetWhere) {
                const compiledWhere = compileSql(conflictSetWhere);
                if (
                  compiledWhere &&
                  !evaluateSql(
                    compiledWhere.sql,
                    compiledWhere.params,
                    lookup,
                    new Map([
                      [tableName, existing],
                      ["excluded", candidate],
                    ]),
                  )
                ) {
                  continue;
                }
              }
              for (const [k, v] of Object.entries(conflictSet)) {
                if (!is(v, SQL)) existing[k] = v;
              }
              if (tableName === "folio_auth_rate_limits") {
                existing.count = Number(existing.count ?? 0) + 1;
              }
              resultRows.push(existing);
              continue;
            }
          }

          rows.push(candidate);
          resultRows.push(candidate);
        }

        if (!returningSelection) return resultRows;
        return resultRows.map((r) =>
          projectRow(returningSelection, table, new Map([[tableName, r]])),
        );
      };

      const builder: Record<string, unknown> = {
        values(vals: Row | Row[]) {
          inputValues = Array.isArray(vals) ? vals : [vals];
          return builder;
        },
        onConflictDoNothing(opts?: { target?: PgColumn | PgColumn[] }) {
          ignoreConflict = true;
          if (opts?.target) {
            conflictTargetCols = Array.isArray(opts.target) ? opts.target : [opts.target];
          }
          return builder;
        },
        onConflictDoUpdate(opts?: { target?: PgColumn | PgColumn[]; set?: Row; setWhere?: SQL }) {
          if (opts?.target) {
            conflictTargetCols = Array.isArray(opts.target) ? opts.target : [opts.target];
          }
          conflictSet = opts?.set ?? {};
          conflictSetWhere = opts?.setWhere;
          return builder;
        },
        returning(sel?: Record<string, unknown>) {
          returningSelection = sel;
          return builder;
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
          return executeInsert().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    update(table: PgTable) {
      const tableName = getTableName(table);
      let patch: Row = {};
      let whereExpr: SQL | undefined;
      let returningSelection: Record<string, unknown> | undefined;

      const executeUpdate = async () => {
        const rows = getTableRows(tableName);
        const lookup = buildLookup([table]);
        const compiled = whereExpr ? compileSql(whereExpr) : null;
        const updated: Row[] = [];

        for (const r of rows) {
          const ok = compiled ? evaluateSql(compiled.sql, compiled.params, lookup, new Map([[tableName, r]])) : true;
          if (!ok) continue;
          for (const [k, v] of Object.entries(patch)) {
            if (!is(v, SQL)) r[k] = v;
          }
          updated.push(r);
        }

        if (!returningSelection) return updated;
        return updated.map((r) =>
          projectRow(returningSelection, table, new Map([[tableName, r]])),
        );
      };

      const builder: Record<string, unknown> = {
        set(vals: Row) {
          patch = vals;
          return builder;
        },
        where(expr?: SQL) {
          whereExpr = expr;
          return builder;
        },
        returning(sel?: Record<string, unknown>) {
          returningSelection = sel;
          return builder;
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
          return executeUpdate().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    delete(table: PgTable) {
      const tableName = getTableName(table);
      let whereExpr: SQL | undefined;
      let returningSelection: Record<string, unknown> | undefined;

      const executeDelete = async () => {
        const rows = getTableRows(tableName);
        const lookup = buildLookup([table]);
        const compiled = whereExpr ? compileSql(whereExpr) : null;
        const kept: Row[] = [];
        const removed: Row[] = [];

        for (const r of rows) {
          const ok = compiled ? evaluateSql(compiled.sql, compiled.params, lookup, new Map([[tableName, r]])) : true;
          if (ok) removed.push(r);
          else kept.push(r);
        }

        getStore().set(tableName, kept);
        if (!returningSelection) return removed;
        return removed.map((r) =>
          projectRow(returningSelection, table, new Map([[tableName, r]])),
        );
      };

      const builder: Record<string, unknown> = {
        where(expr?: SQL) {
          whereExpr = expr;
          return builder;
        },
        returning(sel?: Record<string, unknown>) {
          returningSelection = sel;
          return builder;
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
          return executeDelete().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },

    async execute() {
      return { rows: [{ "?column?": 1 }] };
    },

    async transaction<T>(fn: (tx: FolioDatabase) => Promise<T>): Promise<T> {
      return fn(mockDb as unknown as FolioDatabase);
    },
  };

  return mockDb as unknown as FolioDatabase;
}

export function createMockPool() {
  return {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Doble en memoria de Supabase para los tests de servidor (ticket 20 de la
 * auditoría). Cubre lo que usa el servidor: `from(t)` con `select` (proyecta las
 * columnas pedidas, como PostgREST: un campo que no se pidió sale `undefined`),
 * filtros (`eq`, `neq`, `in`, `is`, `gt(e)`, `lt(e)`, `or` simple, `not`,
 * `match`, `filter`), `order`/`limit`/`range`, `single`/`maybeSingle` (con el
 * `PGRST116` de verdad), `insert`, `update`, `upsert` (`onConflict`,
 * `ignoreDuplicates`), `delete` (las escrituras devuelven filas con `.select()`),
 * `rpc` con manejadores inyectables y `auth.admin.deleteUser`.
 *
 * No es Postgres: no hay tipos, ni RLS, ni joins embebidos (`rel(col)` devuelve
 * la fila entera). Lo que decide un test de RLS va contra la BD, no aquí.
 */

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

export type FakeFilter =
  | {
      kind: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is" | "like" | "ilike";
      column: string;
      value: unknown;
    }
  | { kind: "in"; column: string; value: unknown[] }
  | { kind: "not"; column: string; operator: string; value: unknown }
  | { kind: "or"; expression: string };

export type FakeOp = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc" | "auth.deleteUser";
  /** Columnas pedidas en `select` (vacío = todas). */
  columns: string[];
  filters: FakeFilter[];
  /** Lo que se escribe (`insert`/`update`/`upsert`), los argumentos del `rpc` o el id borrado. */
  payload?: unknown;
};

export type FakeError = { message: string; code?: string; details?: string };
type Result = { data: unknown; error: FakeError | null; count?: number | null };

export type RpcHandler = (args: Record<string, unknown>, tables: FakeTables) => unknown;

export type FakeOptions = {
  /**
   * Devuelve un error (o `true` para uno genérico) en la operación que cumpla
   * la condición: para probar ramas de fallo y los *fail-open*.
   */
  failOn?: (op: FakeOp) => FakeError | boolean | null | undefined;
  rpc?: Record<string, RpcHandler>;
};

const NOT_FOUND: FakeError = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
};

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (typeof a !== "string" || typeof b !== "string") {
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Valor de un filtro de PostgREST en texto (`or=(a.eq.1,b.is.null)`). */
function literal(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function likeToRegExp(pattern: string, flags: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*");
  return new RegExp(`^${escaped}$`, flags);
}

function matchesOperator(row: FakeRow, column: string, operator: string, value: unknown): boolean {
  const cell = row[column];
  switch (operator) {
    case "eq":
      return same(cell, value);
    case "neq":
      return cell != null && !same(cell, value);
    case "gt":
      return cell != null && compare(cell, value) > 0;
    case "gte":
      return cell != null && compare(cell, value) >= 0;
    case "lt":
      return cell != null && compare(cell, value) < 0;
    case "lte":
      return cell != null && compare(cell, value) <= 0;
    case "is":
      return value === null ? cell == null : cell === value;
    case "like":
      return cell != null && likeToRegExp(String(value), "").test(String(cell));
    case "ilike":
      return cell != null && likeToRegExp(String(value), "i").test(String(cell));
    case "in": {
      const list = Array.isArray(value)
        ? value
        : String(value)
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map(literal);
      return cell != null && list.some((v) => same(cell, v));
    }
    default:
      throw new Error(`fake-supabase: operador no soportado "${operator}"`);
  }
}

/** `or("a.eq.1,b.is.null")`: solo condiciones simples separadas por comas. */
function matchesOr(row: FakeRow, expression: string): boolean {
  return expression.split(",").some((part) => {
    const [column, operator, ...rest] = part.trim().split(".");
    if (!column || !operator || !rest.length) {
      throw new Error(`fake-supabase: or() no soportado "${expression}"`);
    }
    return matchesOperator(row, column, operator, literal(rest.join(".")));
  });
}

function matches(row: FakeRow, filters: FakeFilter[]): boolean {
  return filters.every((f) => {
    if (f.kind === "or") return matchesOr(row, f.expression);
    if (f.kind === "not") return !matchesOperator(row, f.column, f.operator, f.value);
    return matchesOperator(row, f.column, f.kind, f.value);
  });
}

/** `"a, b, alias:c"` → columnas; `*` o un embebido `rel(...)` → todas. */
function parseColumns(columns: string | undefined): string[] {
  if (!columns || columns.trim() === "*" || columns.includes("(")) return [];
  return columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function project(row: FakeRow, columns: string[]): FakeRow {
  if (!columns.length) return { ...row };
  const out: FakeRow = {};
  for (const column of columns) {
    const [alias, source] = column.includes(":") ? column.split(":") : [column, column];
    out[alias.trim()] = row[source.trim()];
  }
  return out;
}

export function createFakeSupabase(tables: FakeTables = {}, opts: FakeOptions = {}) {
  const calls: FakeOp[] = [];
  // `updated_at` estrictamente creciente aunque dos escrituras caigan en el
  // mismo milisegundo: así un test de CAS no depende del reloj.
  let clock = 0;
  const nextUpdatedAt = () => {
    clock = Math.max(clock + 1, Date.now());
    return new Date(clock).toISOString();
  };

  const failureOf = (op: FakeOp): FakeError | null => {
    const failure = opts.failOn?.(op);
    if (!failure) return null;
    return failure === true
      ? { message: `fake-supabase: fallo forzado en ${op.table}.${op.op}` }
      : failure;
  };

  const rowsOf = (table: string) => (tables[table] ??= []);

  class Query implements PromiseLike<Result> {
    private op: FakeOp["op"] = "select";
    private columns: string[] = [];
    private returning = false;
    private filters: FakeFilter[] = [];
    private payload: unknown;
    private conflict: string[] = ["id"];
    private ignoreDuplicates = false;
    private ordering: { column: string; ascending: boolean }[] = [];
    private limitTo: number | null = null;
    private rangeOf: [number, number] | null = null;
    private mode: "many" | "single" | "maybeSingle" = "many";
    private countMode: "exact" | null = null;
    private head = false;

    constructor(private readonly table: string) {}

    select(
      columns?: string,
      options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
    ) {
      this.columns = parseColumns(columns);
      if (this.op === "select") {
        this.countMode = options?.count ? "exact" : null;
        this.head = !!options?.head;
      } else {
        this.returning = true;
      }
      return this;
    }
    insert(rows: FakeRow | FakeRow[]) {
      this.op = "insert";
      this.payload = rows;
      return this;
    }
    update(patch: FakeRow) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    upsert(
      rows: FakeRow | FakeRow[],
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) {
      this.op = "upsert";
      this.payload = rows;
      if (options?.onConflict) this.conflict = options.onConflict.split(",").map((c) => c.trim());
      this.ignoreDuplicates = !!options?.ignoreDuplicates;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }

    private push(filter: FakeFilter) {
      this.filters.push(filter);
      return this;
    }
    eq(column: string, value: unknown) {
      return this.push({ kind: "eq", column, value });
    }
    neq(column: string, value: unknown) {
      return this.push({ kind: "neq", column, value });
    }
    gt(column: string, value: unknown) {
      return this.push({ kind: "gt", column, value });
    }
    gte(column: string, value: unknown) {
      return this.push({ kind: "gte", column, value });
    }
    lt(column: string, value: unknown) {
      return this.push({ kind: "lt", column, value });
    }
    lte(column: string, value: unknown) {
      return this.push({ kind: "lte", column, value });
    }
    is(column: string, value: unknown) {
      return this.push({ kind: "is", column, value });
    }
    like(column: string, value: string) {
      return this.push({ kind: "like", column, value });
    }
    ilike(column: string, value: string) {
      return this.push({ kind: "ilike", column, value });
    }
    in(column: string, value: unknown[]) {
      return this.push({ kind: "in", column, value: [...value] });
    }
    not(column: string, operator: string, value: unknown) {
      return this.push({ kind: "not", column, operator, value });
    }
    or(expression: string) {
      return this.push({ kind: "or", expression });
    }
    match(query: FakeRow) {
      for (const [column, value] of Object.entries(query)) this.eq(column, value);
      return this;
    }
    filter(column: string, operator: string, value: unknown) {
      if (operator === "in")
        return this.in(
          column,
          String(value)
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map(literal),
        );
      return this.push({ kind: operator as "eq", column, value });
    }

    order(column: string, options?: { ascending?: boolean }) {
      this.ordering.push({ column, ascending: options?.ascending ?? true });
      return this;
    }
    limit(count: number) {
      this.limitTo = count;
      return this;
    }
    range(from: number, to: number) {
      this.rangeOf = [from, to];
      return this;
    }
    single() {
      this.mode = "single";
      return this;
    }
    maybeSingle() {
      this.mode = "maybeSingle";
      return this;
    }
    returns() {
      return this;
    }

    then<A = Result, B = never>(
      onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve()
        .then(() => this.run())
        .then(onfulfilled, onrejected);
    }

    private run(): Result {
      const op: FakeOp = {
        table: this.table,
        op: this.op,
        columns: this.columns,
        filters: this.filters,
        ...(this.payload !== undefined ? { payload: structuredClone(this.payload) } : {}),
      };
      calls.push(op);
      const failure = failureOf(op);
      if (failure) return { data: null, error: failure };

      const rows = rowsOf(this.table);
      let affected: FakeRow[];
      switch (this.op) {
        case "select":
          affected = rows.filter((r) => matches(r, this.filters));
          break;
        case "insert": {
          const incoming = ([] as FakeRow[])
            .concat(this.payload as FakeRow[])
            .map((r) => ({ ...r }));
          rows.push(...incoming);
          affected = incoming;
          break;
        }
        case "update": {
          affected = rows.filter((r) => matches(r, this.filters));
          for (const row of affected) {
            Object.assign(row, this.payload as FakeRow);
            if ("updated_at" in row) row.updated_at = nextUpdatedAt();
          }
          break;
        }
        case "upsert": {
          affected = [];
          for (const incoming of ([] as FakeRow[]).concat(this.payload as FakeRow[])) {
            const existing = rows.find((r) => this.conflict.every((c) => same(r[c], incoming[c])));
            if (existing) {
              if (this.ignoreDuplicates) continue;
              Object.assign(existing, incoming);
              if ("updated_at" in existing) existing.updated_at = nextUpdatedAt();
              affected.push(existing);
            } else {
              const row = { ...incoming };
              rows.push(row);
              affected.push(row);
            }
          }
          break;
        }
        case "delete": {
          affected = rows.filter((r) => matches(r, this.filters));
          tables[this.table] = rows.filter((r) => !affected.includes(r));
          break;
        }
        default:
          throw new Error(`fake-supabase: operación inesperada ${this.op}`);
      }

      if (this.op !== "select" && !this.returning) return { data: null, error: null };

      let out = [...affected];
      for (const { column, ascending } of [...this.ordering].reverse()) {
        out.sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]));
      }
      const count = this.countMode ? out.length : null;
      if (this.rangeOf) out = out.slice(this.rangeOf[0], this.rangeOf[1] + 1);
      if (this.limitTo != null) out = out.slice(0, this.limitTo);
      const data = out.map((r) => project(r, this.columns));

      if (this.head) return { data: null, error: null, count };
      if (this.mode === "single") {
        return data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: NOT_FOUND };
      }
      if (this.mode === "maybeSingle") {
        if (data.length > 1) return { data: null, error: NOT_FOUND };
        return { data: data[0] ?? null, error: null };
      }
      return { data, error: null, count };
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
      const op: FakeOp = { table: name, op: "rpc", columns: [], filters: [], payload: args };
      calls.push(op);
      const failure = failureOf(op);
      if (failure) return { data: null, error: failure };
      const handler = opts.rpc?.[name];
      if (!handler) {
        return {
          data: null,
          error: { code: "PGRST202", message: `fake-supabase: rpc "${name}" sin manejador` },
        };
      }
      return { data: handler(args, tables), error: null };
    },
    auth: {
      admin: {
        deleteUser: async (id: string): Promise<Result> => {
          const op: FakeOp = {
            table: "auth.users",
            op: "auth.deleteUser",
            columns: [],
            filters: [],
            payload: id,
          };
          calls.push(op);
          const failure = failureOf(op);
          if (failure) return { data: null, error: failure };
          return { data: { user: null }, error: null };
        },
      },
    },
  };

  return {
    /** Para pasárselo a las funciones de servidor: es su `AnyClient`. */
    client: client as unknown as SupabaseClient<never, never, never>,
    /** El mismo objeto con su tipo real, para que el test consulte o siembre. */
    db: client,
    /** Registro en orden de cada operación que llegó a ejecutarse (o a fallar). */
    calls,
    /** Estado tras las escrituras (el mismo objeto que se pasó, mutado). */
    tables,
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;

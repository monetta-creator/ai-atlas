import { cache } from 'react';
import { q } from '../db';

// One cached read of the live public schema for the Schema map (/datasets/schema).
// NEVER reads a row of application data: only information_schema/pg_catalog
// metadata (column names/types, constraints, live-row estimates, comments).
// Two layers of caching: React cache() dedupes within one request (Header-style
// pattern, lib/data/desk.ts), and a 10-minute module memo (Fluid Compute keeps
// warm instances between requests, so this also saves repeat introspection
// across nearby requests on the same instance) survives across requests until
// it goes stale.

export interface SchemaColumn {
  name: string;
  type: string;             // display type (udt_name, e.g. 'text', 'uuid', 'jsonb', or an enum name)
  nullable: boolean;
  comment: string | null;
  enumValues?: string[];    // present only when `type` names a pg_enum type
}

export interface SchemaFk {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface SchemaTable {
  name: string;
  comment: string | null;
  rows: number;              // pg_stat_user_tables.n_live_tup (an estimate, not exact)
  lastAnalyzed: string | null;
  columns: SchemaColumn[];
  fks: SchemaFk[];
}

interface ColumnRow {
  table_name: string; column_name: string; udt_name: string; is_nullable: 'YES' | 'NO'; ordinal_position: number;
}
interface TableCommentRow { table_name: string; table_comment: string | null }
interface ColumnCommentRow { table_name: string; column_name: string; description: string | null }
interface StatRow { table_name: string; n_live_tup: number | null; last_autoanalyze: string | null }
interface FkRow { from_table: string; from_column: string; to_table: string; to_column: string }
interface EnumRow { enum_name: string; value: string }

async function loadSchemaTables(): Promise<SchemaTable[]> {
  const [columns, tableComments, columnComments, stats, fks, enums] = await Promise.all([
    q<ColumnRow>(
      `select table_name, column_name, udt_name, is_nullable, ordinal_position
         from information_schema.columns
        where table_schema = 'public' and table_name <> '_migrations'
        order by table_name, ordinal_position`
    ),
    q<TableCommentRow>(
      `select cls.relname as table_name, dsc.description as table_comment
         from pg_class cls
         join pg_namespace ns on ns.oid = cls.relnamespace
         left join pg_description dsc on dsc.objoid = cls.oid and dsc.objsubid = 0
        where ns.nspname = 'public' and cls.relkind = 'r' and cls.relname <> '_migrations'`
    ),
    q<ColumnCommentRow>(
      `select cls.relname as table_name, a.attname as column_name, dsc.description
         from pg_class cls
         join pg_namespace ns on ns.oid = cls.relnamespace
         join pg_attribute a on a.attrelid = cls.oid and a.attnum > 0 and not a.attisdropped
         left join pg_description dsc on dsc.objoid = cls.oid and dsc.objsubid = a.attnum
        where ns.nspname = 'public' and cls.relkind = 'r' and cls.relname <> '_migrations'`
    ),
    q<StatRow>(
      `select relname as table_name, n_live_tup, to_char(last_autoanalyze, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_autoanalyze
         from pg_stat_user_tables
        where schemaname = 'public' and relname <> '_migrations'`
    ),
    q<FkRow>(
      `select tc.table_name as from_table, kcu.column_name as from_column,
              ccu.table_name as to_table, ccu.column_name as to_column
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`
    ),
    q<EnumRow>(
      `select t.typname as enum_name, e.enumlabel as value
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        order by t.typname, e.enumsortorder`
    ),
  ]);

  const enumValuesByType = new Map<string, string[]>();
  for (const e of enums) {
    const list = enumValuesByType.get(e.enum_name) ?? [];
    list.push(e.value);
    enumValuesByType.set(e.enum_name, list);
  }
  const tableComment = new Map(tableComments.map((t) => [t.table_name, t.table_comment]));
  const columnComment = new Map(columnComments.map((c) => [`${c.table_name}.${c.column_name}`, c.description]));
  const statByTable = new Map(stats.map((s) => [s.table_name, s]));

  const byTable = new Map<string, SchemaTable>();
  for (const c of columns) {
    let t = byTable.get(c.table_name);
    if (!t) {
      const stat = statByTable.get(c.table_name);
      t = {
        name: c.table_name,
        comment: tableComment.get(c.table_name) ?? null,
        rows: stat?.n_live_tup ?? 0,
        lastAnalyzed: stat?.last_autoanalyze ?? null,
        columns: [],
        fks: [],
      };
      byTable.set(c.table_name, t);
    }
    const enumValues = enumValuesByType.get(c.udt_name);
    t.columns.push({
      name: c.column_name,
      type: c.udt_name,
      nullable: c.is_nullable === 'YES',
      comment: columnComment.get(`${c.table_name}.${c.column_name}`) ?? null,
      ...(enumValues ? { enumValues } : {}),
    });
  }
  for (const f of fks) {
    const t = byTable.get(f.from_table);
    if (!t) continue; // a constraint on a table introspection didn't see (shouldn't happen; belt and braces)
    t.fks.push({ column: f.from_column, refTable: f.to_table, refColumn: f.to_column });
  }

  return [...byTable.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const TEN_MINUTES_MS = 10 * 60_000;
let moduleCache: { at: number; tables: SchemaTable[] } | null = null;

async function loadSchemaTablesMemoized(): Promise<SchemaTable[]> {
  if (moduleCache && Date.now() - moduleCache.at < TEN_MINUTES_MS) return moduleCache.tables;
  const tables = await loadSchemaTables();
  moduleCache = { at: Date.now(), tables };
  return tables;
}

// React cache() dedupes within one request; the module memo above survives
// across requests on a warm instance for up to ten minutes.
export const getSchemaTables = cache(loadSchemaTablesMemoized);

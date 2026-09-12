import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { expectedTables } from "./check-schema.ts";

const { Pool } = pg;
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

type Journal = {
  entries: Array<{ tag: string; when: number }>;
};

const expectedLegacyColumns = [
  ["poll_candidates", "id", "integer", true, "sequence"],
  ["poll_candidates", "poll_id", "integer", true, null],
  ["poll_candidates", "label", "text", true, null],
  ["poll_candidates", "position", "integer", true, null],
  ["poll_responses", "id", "integer", true, "sequence"],
  ["poll_responses", "poll_id", "integer", true, null],
  ["poll_responses", "name", "text", true, null],
  ["poll_responses", "answers", "jsonb", true, null],
  ["poll_responses", "comment", "text", false, null],
  ["poll_responses", "created_at", "timestamp with time zone", true, "now"],
  ["poll_responses", "updated_at", "timestamp with time zone", true, "now"],
  ["polls", "id", "integer", true, "sequence"],
  ["polls", "share_id", "text", true, null],
  ["polls", "admin_key", "text", false, null],
  ["polls", "title", "text", true, null],
  ["polls", "note", "text", true, "empty_text"],
  ["polls", "deadline", "timestamp with time zone", false, null],
  ["polls", "confirmed_candidate_id", "integer", false, null],
  ["polls", "created_at", "timestamp with time zone", true, "now"],
] as const;

const ownerUserIdColumn = [
  "polls",
  "owner_user_id",
  "text",
  false,
  null,
] as const;

const expectedLegacyConstraints = [
  ["poll_candidates", "poll_candidates_pkey", "p", ["id"], null, [], " "],
  [
    "poll_candidates",
    "poll_candidates_poll_id_polls_id_fk",
    "f",
    ["poll_id"],
    "polls",
    ["id"],
    "c",
  ],
  ["poll_responses", "poll_responses_pkey", "p", ["id"], null, [], " "],
  [
    "poll_responses",
    "poll_responses_poll_id_polls_id_fk",
    "f",
    ["poll_id"],
    "polls",
    ["id"],
    "c",
  ],
  ["polls", "polls_admin_key_unique", "u", ["admin_key"], null, [], " "],
  ["polls", "polls_pkey", "p", ["id"], null, [], " "],
  ["polls", "polls_share_id_unique", "u", ["share_id"], null, [], " "],
] as const;

const expectedLegacyIndexes = [
  [
    "poll_responses",
    "poll_responses_poll_name_idx",
    true,
    ["poll_id", "name"],
  ],
] as const;

function normalizeDefault(value: string | null) {
  if (value === null) return null;
  if (value.startsWith("nextval(")) return "sequence";
  if (value === "now()") return "now";
  if (value === "''::text") return "empty_text";
  return value;
}

function assertExactMatch(
  label: string,
  actual: readonly unknown[],
  expected: readonly unknown[],
) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const mismatchAt = Array.from(
      { length: Math.max(actual.length, expected.length) },
      (_, index) => index,
    ).find(
      (index) =>
        JSON.stringify(actual[index]) !== JSON.stringify(expected[index]),
    );
    throw new Error(
      [
        `Cannot adopt the legacy database: its ${label} do not exactly match the initial migration.`,
        `Expected: ${JSON.stringify(expected[mismatchAt ?? 0])}`,
        `Found: ${JSON.stringify(actual[mismatchAt ?? 0])}`,
        "Reconcile this database with the committed poll schema before rerunning:",
        "  pnpm --filter @workspace/db run migrate",
        "No migration history was recorded.",
      ].join("\n"),
    );
  }
}

async function assertLegacyBaseline(pool: InstanceType<typeof Pool>) {
  const tableNames = expectedTables.map((table) => table.name);
  const columns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    attnotnull: boolean;
    column_default: string | null;
  }>(
    `SELECT rel.relname AS table_name,
            attr.attname AS column_name,
            format_type(attr.atttypid, attr.atttypmod) AS data_type,
            attr.attnotnull,
            pg_get_expr(def.adbin, def.adrelid) AS column_default
     FROM pg_attribute attr
     JOIN pg_class rel ON rel.oid = attr.attrelid
     JOIN pg_namespace namespace ON namespace.oid = rel.relnamespace
     LEFT JOIN pg_attrdef def
       ON def.adrelid = attr.attrelid AND def.adnum = attr.attnum
     WHERE namespace.nspname = current_schema()
       AND rel.relname = ANY($1::text[])
       AND attr.attnum > 0
       AND NOT attr.attisdropped
     ORDER BY rel.relname, attr.attnum`,
    [tableNames],
  );
  const actualColumns = columns.rows
    .map((column) => [
      column.table_name,
      column.column_name,
      column.data_type,
      column.attnotnull,
      normalizeDefault(column.column_default),
    ])
    .sort((left, right) =>
      `${left[0]}.${left[1]}`.localeCompare(`${right[0]}.${right[1]}`),
    );
  const sortedExpectedColumns = [...expectedLegacyColumns].sort((left, right) =>
    `${left[0]}.${left[1]}`.localeCompare(`${right[0]}.${right[1]}`),
  );
  const sortedExpectedColumnsWithOwner = [
    ...expectedLegacyColumns,
    ownerUserIdColumn,
  ].sort((left, right) =>
    `${left[0]}.${left[1]}`.localeCompare(`${right[0]}.${right[1]}`),
  );
  const matchesLegacy =
    JSON.stringify(actualColumns) === JSON.stringify(sortedExpectedColumns);
  const matchesLegacyWithOwner =
    JSON.stringify(actualColumns) ===
    JSON.stringify(sortedExpectedColumnsWithOwner);
  if (!matchesLegacy && !matchesLegacyWithOwner) {
    assertExactMatch("column definitions", actualColumns, sortedExpectedColumns);
  }

  const constraints = await pool.query<{
    table_name: string;
    conname: string;
    contype: string;
    columns: string[];
    foreign_table: string | null;
    foreign_columns: string[];
    confdeltype: string;
  }>(
    `SELECT rel.relname AS table_name,
            con.conname,
            con.contype,
            ARRAY(
              SELECT attr.attname
              FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
              JOIN pg_attribute attr
                ON attr.attrelid = con.conrelid
               AND attr.attnum = key.attnum
              ORDER BY key.ord
            )::text[] AS columns,
            foreign_rel.relname AS foreign_table,
            (CASE WHEN con.confkey IS NULL THEN ARRAY[]::text[] ELSE ARRAY(
              SELECT attr.attname
              FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
              JOIN pg_attribute attr
                ON attr.attrelid = con.confrelid
               AND attr.attnum = key.attnum
              ORDER BY key.ord
            )::text[] END)::text[] AS foreign_columns,
            con.confdeltype
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace namespace ON namespace.oid = rel.relnamespace
     LEFT JOIN pg_class foreign_rel ON foreign_rel.oid = con.confrelid
     WHERE namespace.nspname = current_schema()
       AND rel.relname = ANY($1::text[])
     ORDER BY rel.relname, con.conname`,
    [tableNames],
  );
  const actualConstraints = constraints.rows.map((constraint) => [
    constraint.table_name,
    constraint.conname,
    constraint.contype,
    constraint.columns,
    constraint.foreign_table,
    constraint.foreign_columns,
    constraint.confdeltype,
  ]);
  assertExactMatch(
    "constraints",
    actualConstraints,
    expectedLegacyConstraints,
  );

  const indexes = await pool.query<{
    table_name: string;
    index_name: string;
    indisunique: boolean;
    columns: string[];
  }>(
    `SELECT rel.relname AS table_name,
            index_rel.relname AS index_name,
            index.indisunique,
            array_agg(attr.attname::text ORDER BY key.ord)::text[] AS columns
     FROM pg_index index
     JOIN pg_class rel ON rel.oid = index.indrelid
     JOIN pg_namespace namespace ON namespace.oid = rel.relnamespace
     JOIN pg_class index_rel ON index_rel.oid = index.indexrelid
     CROSS JOIN LATERAL
       unnest(index.indkey) WITH ORDINALITY AS key(attnum, ord)
     JOIN pg_attribute attr
       ON attr.attrelid = rel.oid AND attr.attnum = key.attnum
     LEFT JOIN pg_constraint con
       ON con.conindid = index.indexrelid
     WHERE namespace.nspname = current_schema()
       AND rel.relname = ANY($1::text[])
       AND con.oid IS NULL
     GROUP BY rel.relname, index_rel.relname, index.indisunique
     ORDER BY rel.relname, index_rel.relname`,
    [tableNames],
  );
  const actualIndexes = indexes.rows.map((index) => [
    index.table_name,
    index.index_name,
    index.indisunique,
    index.columns,
  ]);
  assertExactMatch("indexes", actualIndexes, expectedLegacyIndexes);
  return { ownerUserIdAlreadyPresent: matchesLegacyWithOwner };
}

async function readCommittedMigrations() {
  const journal = JSON.parse(
    await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;
  if (journal.entries.length === 0) {
    throw new Error("No Drizzle migrations are committed.");
  }
  return Promise.all(
    journal.entries.map(async (entry) => {
      const sql = await readFile(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
      );
      return {
        tag: entry.tag,
        createdAt: entry.when,
        hash: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

async function adoptPushCreatedSchema(pool: InstanceType<typeof Pool>) {
  const tableNames = expectedTables.map((table) => table.name);
  const existing = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = ANY($1::text[])`,
    [tableNames],
  );

  if (existing.rowCount === 0) {
    return;
  }

  const migrationTable = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  if (migrationTable.rows[0]?.exists) {
    const history = await pool.query(
      `SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1`,
    );
    if (history.rowCount !== 0) {
      return;
    }
  }

  const { ownerUserIdAlreadyPresent } = await assertLegacyBaseline(pool);
  const committedMigrations = await readCommittedMigrations();
  const migrationsToAdopt = committedMigrations.slice(
    0,
    ownerUserIdAlreadyPresent ? 2 : 1,
  );
  if (migrationsToAdopt.length < (ownerUserIdAlreadyPresent ? 2 : 1)) {
    throw new Error(
      "The database already has owner_user_id, but its committed migration is missing.",
    );
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       )`,
    );
    const latest = await client.query<{ created_at: string }>(
      `SELECT created_at
       FROM drizzle.__drizzle_migrations
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    if (latest.rowCount === 0) {
      for (const migration of migrationsToAdopt) {
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
           VALUES ($1, $2)`,
          [migration.hash, migration.createdAt],
        );
      }
      console.log(
        `Verified the existing poll schema and adopted ${migrationsToAdopt.length} migration baseline${migrationsToAdopt.length === 1 ? "" : "s"}.`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to apply database migrations.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await adoptPushCreatedSchema(pool);
    await migrate(drizzle(pool), { migrationsFolder });
    console.log("Database migrations applied successfully.");
  } finally {
    await pool.end();
  }
}

try {
  await runMigrations();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

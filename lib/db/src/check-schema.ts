import pg from "pg";
import { pathToFileURL } from "node:url";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  pollCandidatesTable,
  pollResponsesTable,
  pollsTable,
} from "./schema/polls.ts";
import { pollCalendarEventsTable } from "./schema/poll-calendar-events.ts";

const { Pool } = pg;

const pollTables = [
  pollsTable,
  pollCandidatesTable,
  pollResponsesTable,
  pollCalendarEventsTable,
] satisfies readonly PgTable[];

export const expectedTables = pollTables.map((table) => {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: Object.values(config.columns).map((column) => column.name),
  };
});

const migrationCommand = "pnpm --filter @workspace/db run migrate";

export async function assertPollSchema(pool: InstanceType<typeof Pool>) {
  const tableNames = expectedTables.map((table) => table.name);
  const result = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
    [tableNames],
  );

  const actualColumns = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const columns = actualColumns.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    actualColumns.set(row.table_name, columns);
  }

  const missing: string[] = [];
  for (const table of expectedTables) {
    const columns = actualColumns.get(table.name);
    if (!columns) {
      missing.push(`${table.name} (table)`);
      continue;
    }

    for (const column of table.columns) {
      if (!columns.has(column)) {
        missing.push(`${table.name}.${column}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      [
        "Database schema check failed. The API schema is newer than the connected database.",
        `Missing poll schema: ${missing.join(", ")}`,
        `Apply the required schema update to this database, then rerun the check:`,
        `  ${migrationCommand}`,
        "This check is read-only and never applies schema changes automatically.",
      ].join("\n"),
    );
  }
}

async function checkSchema() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      `DATABASE_URL is required to check the database schema. Apply the schema update with: ${migrationCommand}`,
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await assertPollSchema(pool);
    console.log(
      `Database schema check passed (${expectedTables.length} poll tables verified).`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkSchema();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
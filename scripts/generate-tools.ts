#!/usr/bin/env tsx
/**
 * scripts/generate-tools.ts
 *
 * Standalone CLI script to scan the database schema and print the
 * generated MCP tool definitions as JSON.  Useful for debugging
 * and auditing what tools will be registered at startup.
 *
 * Usage:
 *   npx tsx scripts/generate-tools.ts
 *   npx tsx scripts/generate-tools.ts --database my_other_db
 *   npx tsx scripts/generate-tools.ts --output tools.json
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { config } from 'dotenv';

config();

// Import after dotenv so env is populated
const { scanSchema, mysqlTypeToJsonSchema } = await import('../src/database/scanner.js');
const { slugify } = await import('../src/utils/helpers.js');
const { pingDatabase, closePool } = await import('../src/database/client.js');

const { values: args } = parseArgs({
  options: {
    database: { type: 'string', short: 'd' },
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  console.log(`
Usage: npx tsx scripts/generate-tools.ts [options]

Options:
  -d, --database <name>   Database to scan (default: DB_NAME from .env)
  -o, --output <file>     Write JSON output to file (default: stdout)
  -h, --help              Show this help message
`);
  process.exit(0);
}

try {
  console.log('🔍 Connecting to database…');
  await pingDatabase();
  console.log('✅ Connected\n');

  const database = args.database ?? process.env.DB_NAME ?? '';
  console.log(`📊 Scanning schema: ${database}`);

  const schema = await scanSchema(database);
  console.log(`✅ Found ${schema.tables.length} tables\n`);

  // Build tool definitions (mirrors generator.ts logic)
  const tools = schema.tables.map((table) => {
    const toolName = `query_${slugify(table.name)}`;
    const properties: Record<string, unknown> = {};

    for (const col of table.columns) {
      properties[col.name] = {
        ...mysqlTypeToJsonSchema(col.type),
        description: col.comment || `Filter by ${col.name} (${col.type})`,
      };
    }

    return {
      name: toolName,
      table: table.name,
      description: table.comment || `Query the \`${table.name}\` table`,
      columnCount: table.columns.length,
      columns: table.columns.map((c) => ({ name: c.name, type: c.type, key: c.key })),
      inputSchema: {
        type: 'object',
        properties: {
          filters: { type: 'object', properties },
          limit: { type: 'integer', default: 50, maximum: 1000 },
          offset: { type: 'integer', default: 0 },
          orderBy: { type: 'string', enum: table.columns.map((c) => c.name) },
          orderDir: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' },
        },
      },
    };
  });

  const output = JSON.stringify({ database, generatedAt: new Date().toISOString(), tools }, null, 2);

  if (args.output) {
    writeFileSync(args.output, output, 'utf-8');
    console.log(`📁 Tool definitions written to: ${args.output}`);
  } else {
    console.log(output);
  }

  console.log(`\n✅ Done — ${tools.length} tools generated`);
} catch (err) {
  console.error('❌ Error:', (err as Error).message);
  process.exit(1);
} finally {
  await closePool();
}

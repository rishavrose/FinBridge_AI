/**
 * Dashboard widget configuration store.
 *
 * Each widget on the Overview dashboard (Recent Transactions, Failed Payouts,
 * Transaction Mix, ...) is backed by a row in `dashboard_widgets`. The row
 * stores which dynamically-generated tool (e.g. query_securenxt_tbl_payouts)
 * to call, what args to pass, an optional secondary aggregate call for the
 * top-level count, and a column map that normalises result columns to the
 * canonical names the UI expects (id, amount, status, created_at, bank_code).
 */

import { executeSelect, executeWrite } from '../database/client.js';
import { toolRegistry } from '../mcp/registry.js';
import { logger } from '../utils/logger.js';
import type { McpToolContext } from '../types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WidgetConfig {
  widget_key: string;
  display_label: string;
  tool_name: string;
  args: Record<string, unknown>;
  count_args: Record<string, unknown> | null;
  column_map: Record<string, string> | null;
  description: string | null;
  enabled: boolean;
  updated_at: string;
}

interface WidgetRow {
  widget_key: string;
  display_label: string;
  tool_name: string;
  args_json: unknown;
  count_args_json: unknown;
  column_map_json: unknown;
  description: string | null;
  enabled: number;
  updated_at: string;
}

export interface WidgetExecuteResult {
  widget_key: string;
  display_label: string;
  tool_name: string;
  rows: Array<Record<string, unknown>>;
  count: number | null;
  raw: unknown;
  error?: string;
}

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    widget_key       VARCHAR(64)  NOT NULL PRIMARY KEY,
    display_label    VARCHAR(128) NOT NULL,
    tool_name        VARCHAR(128) NOT NULL,
    args_json        JSON         NOT NULL,
    count_args_json  JSON         NULL,
    column_map_json  JSON         NULL,
    description      VARCHAR(255) NULL,
    enabled          TINYINT(1)   NOT NULL DEFAULT 1,
    updated_by       VARCHAR(36)  NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    COMMENT='Per-widget dashboard data source mapping'
`;

const DEFAULT_PAYOUTS_TOOL = 'query_securenxt_tbl_payouts';
const DEFAULT_COLUMN_MAP = {
  id: 'id',
  amount: 'amount',
  status: 'status',
  created_at: 'addeddate',
  bank_code: 'bankname',
};

const DEFAULT_WIDGETS: Array<Omit<WidgetConfig, 'updated_at'>> = [
  {
    widget_key: 'recent_transactions',
    display_label: 'Recent Transactions',
    tool_name: DEFAULT_PAYOUTS_TOOL,
    args: { orderBy: 'id', orderDir: 'DESC', limit: 8 },
    count_args: null,
    column_map: DEFAULT_COLUMN_MAP,
    description: 'Latest payouts ordered by id DESC.',
    enabled: true,
  },
  {
    widget_key: 'failed_payouts',
    display_label: 'Failed Payouts',
    tool_name: DEFAULT_PAYOUTS_TOOL,
    args: { filters: { status: 4 }, orderBy: 'id', orderDir: 'DESC', limit: 5 },
    count_args: { filters: { status: 4 }, aggregate: { count: true } },
    column_map: DEFAULT_COLUMN_MAP,
    description: 'Top failed payouts (status=4) plus an exact total via aggregate.',
    enabled: true,
  },
  {
    widget_key: 'transaction_mix',
    display_label: 'Transaction Mix',
    tool_name: DEFAULT_PAYOUTS_TOOL,
    args: { columns: ['status'], orderBy: 'id', orderDir: 'DESC', limit: 100 },
    count_args: null,
    column_map: { status: 'status' },
    description: 'Sample of last 100 rows to compute status mix client-side.',
    enabled: true,
  },
];

export async function ensureDashboardWidgetsTable(): Promise<void> {
  await executeWrite(TABLE_DDL, []);

  // Seed defaults only if the table is empty — never overwrite admin edits.
  const [{ c }] = await executeSelect<{ c: number }>(
    'SELECT COUNT(*) AS c FROM dashboard_widgets',
    [],
  );
  if (c > 0) return;

  for (const w of DEFAULT_WIDGETS) {
    await executeWrite(
      `INSERT IGNORE INTO dashboard_widgets
         (widget_key, display_label, tool_name, args_json, count_args_json, column_map_json, description, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        w.widget_key,
        w.display_label,
        w.tool_name,
        JSON.stringify(w.args),
        w.count_args ? JSON.stringify(w.count_args) : null,
        w.column_map ? JSON.stringify(w.column_map) : null,
        w.description,
        w.enabled ? 1 : 0,
      ],
    );
  }
  logger.info({ count: DEFAULT_WIDGETS.length }, '✅ Seeded default dashboard widgets');
}

// ─── Read ─────────────────────────────────────────────────────────────────────

function rowToConfig(r: WidgetRow): WidgetConfig {
  const parseJson = <T>(v: unknown): T | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return v as T;
    if (typeof v === 'string') {
      try { return JSON.parse(v) as T; } catch { return null; }
    }
    return null;
  };
  return {
    widget_key: r.widget_key,
    display_label: r.display_label,
    tool_name: r.tool_name,
    args: (parseJson<Record<string, unknown>>(r.args_json) ?? {}),
    count_args: parseJson<Record<string, unknown>>(r.count_args_json),
    column_map: parseJson<Record<string, string>>(r.column_map_json),
    description: r.description,
    enabled: r.enabled === 1,
    updated_at: r.updated_at,
  };
}

export async function listWidgets(): Promise<WidgetConfig[]> {
  const rows = await executeSelect<WidgetRow>(
    'SELECT * FROM dashboard_widgets ORDER BY widget_key',
    [],
  );
  return rows.map(rowToConfig);
}

export async function getWidget(widgetKey: string): Promise<WidgetConfig | null> {
  const rows = await executeSelect<WidgetRow>(
    'SELECT * FROM dashboard_widgets WHERE widget_key = ?',
    [widgetKey],
  );
  return rows[0] ? rowToConfig(rows[0]) : null;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export interface UpsertWidgetInput {
  widget_key: string;
  display_label: string;
  tool_name: string;
  args: Record<string, unknown>;
  count_args?: Record<string, unknown> | null;
  column_map?: Record<string, string> | null;
  description?: string | null;
  enabled?: boolean;
  updated_by?: string | null;
}

export async function upsertWidget(input: UpsertWidgetInput): Promise<WidgetConfig> {
  await executeWrite(
    `INSERT INTO dashboard_widgets
       (widget_key, display_label, tool_name, args_json, count_args_json, column_map_json, description, enabled, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_label   = VALUES(display_label),
       tool_name       = VALUES(tool_name),
       args_json       = VALUES(args_json),
       count_args_json = VALUES(count_args_json),
       column_map_json = VALUES(column_map_json),
       description     = VALUES(description),
       enabled         = VALUES(enabled),
       updated_by      = VALUES(updated_by)`,
    [
      input.widget_key,
      input.display_label,
      input.tool_name,
      JSON.stringify(input.args),
      input.count_args ? JSON.stringify(input.count_args) : null,
      input.column_map ? JSON.stringify(input.column_map) : null,
      input.description ?? null,
      input.enabled === false ? 0 : 1,
      input.updated_by ?? null,
    ],
  );
  const updated = await getWidget(input.widget_key);
  if (!updated) throw new Error(`Widget ${input.widget_key} not found after upsert`);
  return updated;
}

export async function deleteWidget(widgetKey: string): Promise<boolean> {
  const result = await executeWrite(
    'DELETE FROM dashboard_widgets WHERE widget_key = ?',
    [widgetKey],
  );
  return (result as { affectedRows?: number }).affectedRows !== 0;
}

// ─── Execute (renders one widget) ─────────────────────────────────────────────

function normaliseRows(
  rows: Array<Record<string, unknown>>,
  columnMap: Record<string, string> | null,
): Array<Record<string, unknown>> {
  if (!columnMap || Object.keys(columnMap).length === 0) return rows;
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [canonical, source] of Object.entries(columnMap)) {
      if (source in row) out[canonical] = row[source];
    }
    return out;
  });
}

export async function executeWidget(
  widgetKey: string,
  ctx: McpToolContext,
): Promise<WidgetExecuteResult> {
  const widget = await getWidget(widgetKey);
  if (!widget) {
    throw Object.assign(new Error(`Widget "${widgetKey}" not found`), {
      statusCode: 404,
      code: 'WIDGET_NOT_FOUND',
    });
  }

  const empty: WidgetExecuteResult = {
    widget_key: widget.widget_key,
    display_label: widget.display_label,
    tool_name: widget.tool_name,
    rows: [],
    count: null,
    raw: null,
  };

  if (!widget.enabled) return empty;

  const toolKnown = toolRegistry.listTools().some((t) => t.name === widget.tool_name);
  if (!toolKnown) {
    return {
      ...empty,
      error: `Tool "${widget.tool_name}" is not registered. Update widget config in Dashboard Settings.`,
    };
  }

  // Primary call — rows
  let rawData: unknown = null;
  try {
    const result = await toolRegistry.executeTool(widget.tool_name, widget.args, ctx);
    rawData = result.data;
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }

  const rowsArr: Array<Record<string, unknown>> = (() => {
    const data = rawData as { rows?: unknown } | null;
    if (data && Array.isArray(data.rows)) return data.rows as Array<Record<string, unknown>>;
    return [];
  })();

  // Secondary call — count via aggregate
  let count: number | null = null;
  if (widget.count_args) {
    try {
      const cResult = await toolRegistry.executeTool(widget.tool_name, widget.count_args, ctx);
      const cData = cResult.data as { result?: { count?: unknown } } | null;
      if (cData && cData.result && typeof cData.result.count !== 'undefined') {
        const raw = cData.result.count;
        count = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isNaN(count)) count = null;
      }
    } catch (err) {
      logger.warn({ err, widgetKey }, 'Widget count_args call failed');
    }
  }

  return {
    widget_key: widget.widget_key,
    display_label: widget.display_label,
    tool_name: widget.tool_name,
    rows: normaliseRows(rowsArr, widget.column_map),
    count,
    raw: rawData,
  };
}

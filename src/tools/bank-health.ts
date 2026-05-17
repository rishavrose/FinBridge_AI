/**
 * Tool: get_bank_health
 *
 * Reports the operational health and uptime metrics for integrated banks/PSPs.
 * Available to all authenticated users (readonly role).
 */

import { z } from 'zod';
import { buildSelectQuery } from '../database/query-builder.js';
import { executeSelect } from '../database/client.js';
import { ValidationError } from '../utils/errors.js';
import type { McpToolDefinition } from '../types/index.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

export const GetBankHealthSchema = z.object({
  bankCode: z.string().max(20).optional(),
  status: z.enum(['operational', 'degraded', 'outage', 'maintenance']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type GetBankHealthInput = z.infer<typeof GetBankHealthSchema>;

// ─── MCP tool definition ──────────────────────────────────────────────────────

export const getBankHealthTool: McpToolDefinition = {
  name: 'get_bank_health',
  description:
    'Retrieve operational health status and uptime metrics for integrated banks and payment service providers. ' +
    'Shows success rates, average response times, and current status.',
  inputSchema: {
    type: 'object',
    properties: {
      bankCode: {
        type: 'string',
        description: 'Filter by specific bank or PSP code (e.g. GTB, ACCESS, PAYSTACK)',
      },
      status: {
        type: 'string',
        enum: ['operational', 'degraded', 'outage', 'maintenance'],
        description: 'Filter by current operational status',
      },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  permissions: ['readonly', 'analyst', 'service', 'admin'],
  cacheTtl: 120, // 2 minutes — health data can be slightly stale
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function getBankHealthHandler(
  rawArgs: Record<string, unknown>,
): Promise<unknown> {
  const parsed = GetBankHealthSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new ValidationError('Invalid arguments', parsed.error.flatten());
  }

  const { bankCode, status, limit } = parsed.data;

  const conditions: Parameters<typeof buildSelectQuery>[0]['conditions'] = [];
  if (bankCode) conditions.push({ column: 'bank_code', operator: '=', value: bankCode });
  if (status) conditions.push({ column: 'status', operator: '=', value: status });

  const { sql, params } = buildSelectQuery({
    table: 'bank_health',
    columns: [
      'bank_code', 'bank_name', 'status',
      'success_rate_24h', 'avg_response_ms',
      'total_requests_24h', 'failed_requests_24h',
      'last_incident_at', 'last_checked_at',
    ],
    conditions,
    orderBy: { column: 'success_rate_24h', direction: 'ASC' },
    limit,
  });

  const rows = await executeSelect(sql, params);

  // Annotate with health label for easy AI interpretation
  const annotated = rows.map((r) => {
    const row = r as Record<string, unknown>;
    const rate = Number(row.success_rate_24h ?? 0);
    return {
      ...row,
      health_label:
        rate >= 99 ? '🟢 Healthy' :
        rate >= 95 ? '🟡 Degraded' :
        rate >= 80 ? '🟠 Impaired' :
        '🔴 Outage',
    };
  });

  return { banks: annotated, count: annotated.length };
}

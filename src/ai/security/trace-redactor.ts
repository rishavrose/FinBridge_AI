/**
 * Tool-call trace redactor.
 *
 * The chat response includes a `toolCallsTrace` sidecar. The amount of
 * detail we expose depends on the caller's visibility tier (Phase 4):
 *
 *   full     → admin           name + args + sql + params  (debug-grade)
 *   business → service         name + args                 (no SQL/params)
 *   redacted → analyst/readonly category + no args         (no real tool name)
 *
 * `category` is a stable business-language label (`payout_query`,
 * `bank_query`, …) that conveys WHAT was queried without revealing the
 * underlying table or tool name.
 */

import type { ToolCallTrace } from '../../openai/converter.js';
import type { Role } from '../../types/index.js';
import {
  getVisibilityTier,
  showsRealToolNames,
  showsSqlAndParams,
  showsToolArgs,
} from './role-policy.js';
import { toolCategory } from './tool-categorizer.js';

/** True iff anything in the trace would be redacted for this role. */
export function shouldRedactTrace(role: Role): boolean {
  return getVisibilityTier(role) !== 'full';
}

export function redactToolCallsTrace(
  trace: ToolCallTrace[],
  role: Role,
): ToolCallTrace[] {
  const tier = getVisibilityTier(role);
  if (tier === 'full') return trace;

  return trace.map((t) => {
    const safe: ToolCallTrace = {
      name: showsRealToolNames(role) ? t.name : toolCategory(t.name),
      args: showsToolArgs(role) ? t.args : {},
    };
    if (showsSqlAndParams(role)) {
      if (t.sql) safe.sql = t.sql;
      if (t.params) safe.params = t.params;
    }
    return safe;
  });
}

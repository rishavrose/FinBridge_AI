/**
 * Tool-call trace redactor.
 *
 * The chat response includes a `toolCallsTrace` array — useful for admins to
 * see which queries the AI ran. But the trace also carries the raw SQL and
 * bound parameters, which we should NEVER leak to non-admin users:
 *   - It exposes the table/column schema (we just spent a lot of effort
 *     forbidding the model from doing that itself).
 *   - It reveals WHO/WHAT was queried (bound params often contain user
 *     IDs, dates, status codes).
 *
 * This module returns a redacted copy for non-admin callers.
 */

import type { ToolCallTrace } from '../../openai/converter.js';
import type { Role } from '../../types/index.js';

/** Roles that get the full unredacted trace. */
const TRACE_FULL_ACCESS_ROLES: Role[] = ['admin'];

export function shouldRedactTrace(role: Role): boolean {
  return !TRACE_FULL_ACCESS_ROLES.includes(role);
}

/**
 * Return a copy of the trace that is safe to send to a user of the given role.
 *
 * For non-admin roles we keep just the tool NAME — that's enough for the UI to
 * render a "I ran 2 queries" badge — and drop the args, sql, and params.
 */
export function redactToolCallsTrace(
  trace: ToolCallTrace[],
  role: Role,
): ToolCallTrace[] {
  if (!shouldRedactTrace(role)) return trace;
  return trace.map((t) => ({ name: t.name, args: {} }));
}

/**
 * Role-Based Access Control (RBAC).
 *
 * Defines which roles may execute which tools and at what rate.
 * The permission matrix is the single source of truth — no scattered if/else checks.
 */

import type { Role } from '../types/index.js';
import { PermissionError } from '../utils/errors.js';

// ─── Role hierarchy ───────────────────────────────────────────────────────────

/**
 * Role power level — higher number = more privilege.
 * Used to check "at least this role" access patterns.
 */
export const ROLE_LEVEL: Record<Role, number> = {
  readonly: 10,
  analyst: 20,
  service: 30,
  admin: 100,
};

export function hasRoleLevel(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

// ─── Tool permission matrix ───────────────────────────────────────────────────

/**
 * Map of tool name → minimum role required to execute.
 * If a tool is not listed here it defaults to `admin` only.
 */
const TOOL_PERMISSIONS: Record<string, Role> = {
  // Fintech tools
  get_recent_transactions: 'analyst',
  get_failed_payouts: 'analyst',
  get_user_balance: 'analyst',
  get_bank_health: 'readonly',
  search_rrn: 'analyst',
  get_settlement_report: 'analyst',

  // Schema tools (admin/service only)
  list_tables: 'service',
  describe_table: 'service',

  // Dynamic tools generated from schema — default to analyst
  '*': 'analyst',
};

function getRequiredRole(toolName: string): Role {
  return TOOL_PERMISSIONS[toolName] ?? TOOL_PERMISSIONS['*'] ?? 'admin';
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Check if a role is permitted to use a tool.
 * Throws PermissionError if not allowed.
 */
export function assertToolPermission(toolName: string, callerRole: Role): void {
  const required = getRequiredRole(toolName);
  if (!hasRoleLevel(callerRole, required)) {
    throw new PermissionError(toolName, callerRole);
  }
}

/**
 * Non-throwing variant — returns true/false.
 */
export function canExecuteTool(toolName: string, callerRole: Role): boolean {
  const required = getRequiredRole(toolName);
  return hasRoleLevel(callerRole, required);
}

/**
 * Filter a list of tool names to only those accessible by the given role.
 */
export function filterAccessibleTools(toolNames: string[], callerRole: Role): string[] {
  return toolNames.filter((name) => canExecuteTool(name, callerRole));
}

// ─── Tool permission registration ─────────────────────────────────────────────

/**
 * Register permissions for dynamically generated tools at runtime.
 */
export function registerToolPermission(toolName: string, minRole: Role): void {
  TOOL_PERMISSIONS[toolName] = minRole;
}

/**
 * Role-based AI visibility policy.
 *
 * The codebase already has a tool-execution permission matrix in
 * `src/auth/rbac.ts` (role → which tools they can invoke). This module
 * adds the orthogonal dimension: how much architectural detail does
 * the user's role get to SEE in the chat response and trace?
 *
 * Three tiers:
 *   - `full`     — admin. Sees real tool names, raw SQL, bound params.
 *   - `business` — service. Sees real tool names + args, NO SQL.
 *   - `redacted` — analyst, readonly. Sees only generic category labels
 *                  (e.g. "payout_query") and never sees args, SQL,
 *                  or params.
 *
 * We deliberately do NOT extend the role taxonomy beyond what JWT auth
 * currently issues — that would force every downstream system to learn
 * new roles. Instead this module maps the existing roles into a
 * visibility tier that all the user-facing layers (response, frontend,
 * logs that reach the user) honour.
 */

import type { Role } from '../../types/index.js';

export type VisibilityTier = 'full' | 'business' | 'redacted';

const ROLE_TO_TIER: Record<Role, VisibilityTier> = {
  admin:    'full',
  service:  'business',
  analyst:  'redacted',
  readonly: 'redacted',
};

export function getVisibilityTier(role: Role): VisibilityTier {
  return ROLE_TO_TIER[role] ?? 'redacted';
}

/** Convenience predicates for clearer call sites. */
export function isFullVisibility(role: Role): boolean {
  return getVisibilityTier(role) === 'full';
}

export function showsRealToolNames(role: Role): boolean {
  // Both full and business tiers keep the real tool name; only redacted
  // swaps in the generic category label.
  return getVisibilityTier(role) !== 'redacted';
}

export function showsSqlAndParams(role: Role): boolean {
  return getVisibilityTier(role) === 'full';
}

export function showsToolArgs(role: Role): boolean {
  // 'business' sees args; 'redacted' does not.
  return getVisibilityTier(role) !== 'redacted';
}

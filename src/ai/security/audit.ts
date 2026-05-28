/**
 * AI Security Audit Logger
 *
 * Writes one row per gated turn to `ai_security_events`. Used for:
 *   - operational review of refusals
 *   - building the per-session risk score in Phase 2
 *   - compliance audit trail
 *
 * Writes are fire-and-forget so the chat path is never blocked.
 *
 * The table is created lazily on first call — same pattern we used for
 * ai_chat_history.sql_queries — so existing deployments self-migrate.
 */

import { v4 as uuidv4 } from 'uuid';
import { executeSelect, executeWrite } from '../../database/client.js';
import { logger } from '../../utils/logger.js';
import type { Classification } from './query-classifier.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecurityEventType =
  | 'classification'   // every turn gets one of these
  | 'refusal'          // we refused before running any tool
  | 'zero_result_block'; // we scrubbed a "would you like X instead?" leak

export interface SecurityEvent {
  userId: string;
  conversationId: string | null;
  eventType: SecurityEventType;
  classification: Classification | null;
  /** Subcategory like 'enumeration' or 'schema_discovery'. */
  category: string | null;
  reasons: string[];
  /** First ~500 chars of the prompt — never the full thing, never the reply. */
  promptExcerpt: string;
}

// ─── One-time migration ───────────────────────────────────────────────────────

let _tableEnsured = false;
async function ensureSecurityTable(): Promise<void> {
  if (_tableEnsured) return;
  _tableEnsured = true;
  try {
    await executeWrite(
      `CREATE TABLE IF NOT EXISTS ai_security_events (
         id              VARCHAR(36)  NOT NULL PRIMARY KEY,
         user_id         VARCHAR(36)  NOT NULL,
         conversation_id VARCHAR(36)  NULL,
         event_type      VARCHAR(32)  NOT NULL,
         classification  VARCHAR(20)  NULL,
         category        VARCHAR(40)  NULL,
         reasons         JSON         NULL,
         prompt_excerpt  VARCHAR(500) NOT NULL,
         created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_ase_user      (user_id, created_at),
         INDEX idx_ase_event     (event_type, created_at),
         INDEX idx_ase_category  (category, created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
         COMMENT='AI security audit log (refusals, classifications, blocks)'`,
    );
  } catch (err) {
    logger.warn({ err }, 'ai_security_events CREATE TABLE failed (may already exist)');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record one security event. Non-blocking — errors are swallowed so the
 * chat response is never delayed by audit IO.
 */
export async function recordSecurityEvent(event: SecurityEvent): Promise<void> {
  ensureSecurityTable().catch(() => {});

  const excerpt = event.promptExcerpt.slice(0, 500);
  const reasonsJson = event.reasons.length > 0 ? JSON.stringify(event.reasons) : null;

  executeWrite(
    `INSERT INTO ai_security_events
       (id, user_id, conversation_id, event_type, classification, category, reasons, prompt_excerpt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      event.userId,
      event.conversationId,
      event.eventType,
      event.classification,
      event.category,
      reasonsJson,
      excerpt,
    ],
  ).catch((err) => logger.warn({ err }, 'ai_security_events write failed'));

  // Mirror to structured logger so the events show up in real-time log feeds
  // even before the table is queried.
  logger.info(
    {
      event: 'ai.security',
      userId: event.userId,
      conversationId: event.conversationId,
      eventType: event.eventType,
      classification: event.classification,
      category: event.category,
      reasons: event.reasons,
    },
    'AI security event',
  );
}

/**
 * Quick read for admin tooling — last N events for a user.
 * Phase 2 will use this to build the rolling risk score.
 */
export async function getRecentSecurityEvents(
  userId: string,
  limit = 20,
): Promise<Array<{
  event_type: string;
  classification: string | null;
  category: string | null;
  created_at: string;
}>> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  try {
    return await executeSelect(
      `SELECT event_type, classification, category, created_at
       FROM ai_security_events
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [userId],
    );
  } catch {
    return [];
  }
}

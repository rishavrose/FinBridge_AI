/**
 * Analytics Service — queries MySQL for all fintech metrics.
 * All results are cached in Redis with short TTLs.
 */

import { executeSelect } from '../database/client.js';
import { executeOnConnection, findConnectionWithTables } from '../database/connection-manager.js';
import { getOrSet } from '../cache/manager.js';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TpsBucket {
  time: string;
  tps: number;
  count: number;
  success: number;
  failed: number;
  successRate: number;
}

export interface PayoutStat {
  status: string;
  count: number;
  totalAmount: number;
}

export interface BankStat {
  bankCode: string;
  bankName: string | null;
  status: string;
  successRate: number;
  avgResponseMs: number;
  totalRequests: number;
  failedRequests: number;
  lastChecked: string | null;
}

export interface FailureReason {
  reason: string;
  count: number;
  pct: number;
}

export interface OverviewMetrics {
  currentTps: number;
  successRate1h: number;
  failedPayoutsToday: number;
  activeIncidents: number;
  totalTransactions24h: number;
  totalPayoutVolume24h: number;
  avgResponseMs: number;
  banksDown: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Map numeric status codes to readable labels
function normalizeStatus(status: string): string {
  const map: Record<string, string> = {
    '1': 'success', '2': 'initiated', '4': 'failed',
    '6': 'processed', '8': 'reversed',
  };
  return map[status] ?? status;
}

// ─── Tenant DB resolver (cached) ─────────────────────────────────────────────
// All analytics endpoints prefer the tenant database (tbl_payouts + tbl_bank_lists).
// Scanning information_schema across every connection is expensive, so we cache
// the resolved connection ID in memory for 60s.

let _tenantConnId: string | null = null;
let _tenantConnExpiry = 0;
async function getTenantPayoutsConnectionId(): Promise<string | null> {
  const now = Date.now();
  if (_tenantConnId && now < _tenantConnExpiry) return _tenantConnId;
  const id = await findConnectionWithTables(['tbl_payouts', 'tbl_bank_lists']);
  _tenantConnId = id;
  _tenantConnExpiry = now + 60_000;
  return id;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** TPS bucketed by minute for the last N minutes */
export async function getTpsTimeSeries(minutes = 60): Promise<TpsBucket[]> {
  const { data } = await getOrSet<TpsBucket[]>(
    `analytics:tps:${minutes}`,
    async () => {
      const tenantId = await getTenantPayoutsConnectionId();
      const rows = tenantId
        ? await executeOnConnection<{
            bucket: string; count: string; success: string; failed: string;
          }>(
            tenantId,
            `SELECT
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:00') AS bucket,
               COUNT(*)                                       AS count,
               SUM(CASE WHEN status IN (1, '1') THEN 1 ELSE 0 END) AS success,
               SUM(CASE WHEN status IN (4, '4') THEN 1 ELSE 0 END) AS failed
             FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)
             GROUP BY bucket
             ORDER BY bucket ASC`,
          )
        : await executeSelect<{
            bucket: string; count: string; success: string; failed: string;
          }>(
            `SELECT
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:00') AS bucket,
               COUNT(*)                                       AS count,
               SUM(CASE WHEN status IN ('1','success','SUCCESS') THEN 1 ELSE 0 END)  AS success,
               SUM(CASE WHEN status IN ('4','failed','FAILED')   THEN 1 ELSE 0 END)  AS failed
             FROM transactions
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
             GROUP BY bucket
             ORDER BY bucket ASC`,
            [minutes],
          );
      return rows.map(r => {
        const cnt = Number(r.count);
        const suc = Number(r.success);
        return {
          time: r.bucket,
          tps: Math.round((cnt / 60) * 100) / 100,
          count: cnt,
          success: suc,
          failed: Number(r.failed),
          successRate: cnt > 0 ? Math.round((suc / cnt) * 10000) / 100 : 0,
        };
      });
    },
    { ttl: 30 },
  );
  return data;
}

/** Current live TPS (payouts in last 60 seconds / 60) */
export async function getCurrentTps(): Promise<number> {
  const { data } = await getOrSet<number>(
    'analytics:tps:live',
    async () => {
      const tenantId = await getTenantPayoutsConnectionId();
      const rows = tenantId
        ? await executeOnConnection<{ cnt: string }>(
            tenantId,
            `SELECT COUNT(*) AS cnt FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)`,
          )
        : await executeSelect<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM transactions
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)`,
            [],
          );
      return Math.round((Number(rows[0]?.cnt ?? 0) / 60) * 100) / 100;
    },
    { ttl: 10 },
  );
  return data;
}

/** Payout status breakdown for the last 24 hours */
export async function getPayoutAnalytics(): Promise<PayoutStat[]> {
  const { data } = await getOrSet<PayoutStat[]>(
    'analytics:payouts:24h',
    async () => {
      const tenantId = await getTenantPayoutsConnectionId();
      const rows = tenantId
        ? await executeOnConnection<{
            status: string; count: string; total_amount: string;
          }>(
            tenantId,
            `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total_amount
             FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             GROUP BY status
             ORDER BY count DESC`,
          )
        : await executeSelect<{
            status: string; count: string; total_amount: string;
          }>(
            `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total_amount
             FROM payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             GROUP BY status
             ORDER BY count DESC`,
            [],
          );
      return rows.map(r => ({
        status: normalizeStatus(String(r.status)),
        count: Number(r.count),
        totalAmount: Number(r.total_amount),
      }));
    },
    { ttl: 30 },
  );
  return data;
}

/** Payout volume bucketed by hour for last 24 h */
export async function getPayoutTimeSeries(): Promise<
  { time: string; success: number; failed: number; pending: number }[]
> {
  const { data } = await getOrSet(
    'analytics:payouts:timeseries',
    async () => {
      const tenantId = await getTenantPayoutsConnectionId();
      const rows = tenantId
        ? await executeOnConnection<{
            bucket: string; success: string; failed: string; pending: string;
          }>(
            tenantId,
            `SELECT
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:00:00') AS bucket,
               SUM(CASE WHEN status IN (1, '1') THEN 1 ELSE 0 END) AS success,
               SUM(CASE WHEN status IN (4, '4') THEN 1 ELSE 0 END) AS failed,
               SUM(CASE WHEN status IN (2, '2', 6, '6') THEN 1 ELSE 0 END) AS pending
             FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             GROUP BY bucket
             ORDER BY bucket ASC`,
          )
        : await executeSelect<{
            bucket: string; success: string; failed: string; pending: string;
          }>(
            `SELECT
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:00:00') AS bucket,
               SUM(CASE WHEN status IN ('success','1')  THEN 1 ELSE 0 END) AS success,
               SUM(CASE WHEN status IN ('failed','4')   THEN 1 ELSE 0 END) AS failed,
               SUM(CASE WHEN status IN ('initiated','2','pending') THEN 1 ELSE 0 END) AS pending
             FROM payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             GROUP BY bucket
             ORDER BY bucket ASC`,
            [],
          );
      return rows.map(r => ({
        time: r.bucket,
        success: Number(r.success),
        failed: Number(r.failed),
        pending: Number(r.pending),
      }));
    },
    { ttl: 60 },
  );
  return data as { time: string; success: number; failed: number; pending: number }[];
}

/**
 * Bank/PSP health derived live from tbl_payouts joined with tbl_bank_lists.
 *
 * - success_rate  : 24h success ratio (status = 1 success, 4 failed)
 * - avg_response_ms: estimated from updated_at - created_at on finalised payouts
 * - status         : 'up' if rate >= 95, 'degraded' if rate >= 80, 'down' otherwise
 *
 * Rows are ordered by lowest success rate first (worst-performing banks surface).
 */
export async function getBankStatsFromPayouts(): Promise<BankStat[]> {
  const { data } = await getOrSet<BankStat[]>(
    'analytics:banks:from-payouts',
    async () => {
      // The payouts data lives in a tenant DB exposed via the dynamic
      // connection manager — NOT in finbridge_db. Locate the right pool.
      const connectionId = await findConnectionWithTables(['tbl_payouts', 'tbl_bank_lists']);
      if (!connectionId) {
        logger.warn('getBankStatsFromPayouts: no connection has tbl_payouts + tbl_bank_lists');
        return [];
      }

      const sql = `
        SELECT
          p.bank_id                                              AS bank_id,
          b.name                                                 AS bank_name,
          COUNT(*)                                               AS total_requests,
          SUM(CASE WHEN p.status IN (1, '1') THEN 1 ELSE 0 END)  AS success_count,
          SUM(CASE WHEN p.status IN (4, '4') THEN 1 ELSE 0 END)  AS failed_count,
          AVG(
            CASE
              WHEN p.status IN (1, '1', 4, '4')
                AND p.updated_at IS NOT NULL
                AND p.created_at IS NOT NULL
              THEN TIMESTAMPDIFF(MICROSECOND, p.created_at, p.updated_at) / 1000
              ELSE NULL
            END
          )                                                      AS avg_response_ms,
          MAX(p.updated_at)                                      AS last_checked
        FROM tbl_payouts p
        LEFT JOIN tbl_bank_lists b ON b.id = p.bank_id
        WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND p.bank_id IS NOT NULL
        GROUP BY p.bank_id, b.name
        ORDER BY (SUM(CASE WHEN p.status IN (1, '1') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) ASC
        LIMIT 50`;

      const rows = await executeOnConnection<{
        bank_id: string | number;
        bank_name: string | null;
        total_requests: string;
        success_count: string;
        failed_count: string;
        avg_response_ms: string | null;
        last_checked: string | null;
      }>(connectionId, sql);

      return rows.map((r) => {
        const total = Number(r.total_requests ?? 0);
        const success = Number(r.success_count ?? 0);
        const failed = Number(r.failed_count ?? 0);
        const rate = total > 0 ? (success / total) * 100 : 0;
        const status = rate >= 95 ? 'up' : rate >= 80 ? 'degraded' : 'down';

        return {
          bankCode: String(r.bank_id),
          bankName: r.bank_name,
          status,
          successRate: Math.round(rate * 10) / 10,
          avgResponseMs: Math.round(Number(r.avg_response_ms ?? 0)),
          totalRequests: total,
          failedRequests: failed,
          lastChecked: r.last_checked,
        };
      });
    },
    { ttl: 30 },
  );
  return data;
}

// ─── Recent payouts (joined with bank list) ───────────────────────────────────

export interface RecentPayoutRow {
  id: string;
  rrn: string | null;
  user_id: string | null;
  amount: number;
  currency: string;
  status: string;
  /** Combined addeddate + addedtime as ISO-ish string for relativeTime() in UI. */
  created_at: string;
  /** Bank label shown in the "Bank" column — uses tbl_bank_lists.name. */
  bank_code: string | null;
}

/**
 * Most recent payouts from tbl_payouts joined with tbl_bank_lists.
 * - bank_code  : tbl_bank_lists.name (bank display name)
 * - created_at : addeddate + ' ' + addedtime  (full timestamp the UI expects)
 */
export async function getRecentPayouts(limit = 8): Promise<RecentPayoutRow[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 50);
  const { data } = await getOrSet<RecentPayoutRow[]>(
    `analytics:recent-payouts:${safeLimit}`,
    async () => {
      const connectionId = await findConnectionWithTables(['tbl_payouts', 'tbl_bank_lists']);
      if (!connectionId) {
        logger.warn('getRecentPayouts: no connection has tbl_payouts + tbl_bank_lists');
        return [];
      }

      // Build the timestamp string in SQL so we don't depend on the driver's
      // DATE-to-Date conversion (which made `new Date(...)` return NaN in the
      // frontend). Output format: "YYYY-MM-DDTHH:MM:SS" — parseable everywhere.
      const sql = `
        SELECT
          p.id        AS id,
          p.utr_rrn   AS rrn,
          p.userid    AS user_id,
          p.amount    AS amount,
          p.status    AS status,
          CONCAT(
            DATE_FORMAT(p.addeddate, '%Y-%m-%d'),
            'T',
            IFNULL(p.addedtime, '00:00:00')
          )           AS created_at,
          b.name      AS bank_name
        FROM tbl_payouts p
        LEFT JOIN tbl_bank_lists b ON b.id = p.bank_id
        ORDER BY p.id DESC
        LIMIT ${safeLimit}`;

      const rows = await executeOnConnection<{
        id: string | number;
        rrn: string | null;
        user_id: string | number | null;
        amount: string | number;
        status: string | number;
        created_at: string | null;
        bank_name: string | null;
      }>(connectionId, sql);

      return rows.map((r) => ({
        id: String(r.id),
        rrn: r.rrn ?? null,
        user_id: r.user_id != null ? String(r.user_id) : null,
        amount: Number(r.amount ?? 0),
        currency: 'INR',
        status: String(r.status ?? ''),
        created_at: r.created_at ?? '',
        bank_code: r.bank_name ?? null,
      }));
    },
    { ttl: 15 },
  );
  return data;
}

/** Bank health snapshot — prefers live tbl_payouts data, falls back to bank_health */
export async function getBankStats(): Promise<BankStat[]> {
  // Prefer live tenant data when a payouts DB is connected.
  const tenantId = await getTenantPayoutsConnectionId();
  if (tenantId) {
    const live = await getBankStatsFromPayouts();
    if (live.length > 0) return live;
  }

  const { data } = await getOrSet<BankStat[]>(
    'analytics:banks',
    async () => {
      const rows = await executeSelect<{
        bank_code: string; bank_name: string | null; status: string;
        success_rate_24h: string; avg_response_ms: string;
        total_requests_24h: string; failed_requests_24h: string;
        last_checked_at: string | null;
      }>(
        `SELECT bank_code, bank_name, status, success_rate_24h, avg_response_ms,
                total_requests_24h, failed_requests_24h, last_checked_at
         FROM bank_health
         ORDER BY success_rate_24h ASC`,
        [],
      );
      return rows.map(r => ({
        bankCode: r.bank_code,
        bankName: r.bank_name,
        status: r.status,
        successRate: Number(r.success_rate_24h ?? 100),
        avgResponseMs: Number(r.avg_response_ms ?? 0),
        totalRequests: Number(r.total_requests_24h ?? 0),
        failedRequests: Number(r.failed_requests_24h ?? 0),
        lastChecked: r.last_checked_at,
      }));
    },
    { ttl: 30 },
  );
  return data;
}

/** Top failure reasons — tenant tbl_payouts.remarks first, falls back to local transactions */
export async function getFailureAnalysis(): Promise<FailureReason[]> {
  const { data } = await getOrSet<FailureReason[]>(
    'analytics:failures:24h',
    async () => {
      const tenantId = await getTenantPayoutsConnectionId();
      const rows = tenantId
        ? await executeOnConnection<{ reason: string; count: string; total: string }>(
            tenantId,
            `SELECT
               COALESCE(NULLIF(TRIM(remarks),''), 'Unknown') AS reason,
               COUNT(*) AS count,
               (SELECT COUNT(*) FROM tbl_payouts
                WHERE status IN (4, '4')
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS total
             FROM tbl_payouts
             WHERE status IN (4, '4')
               AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             GROUP BY reason
             ORDER BY count DESC
             LIMIT 8`,
          )
        : await executeSelect<{ reason: string; count: string; total: string }>(
            `SELECT
               COALESCE(NULLIF(TRIM(response_message),''), 'Unknown') AS reason,
               COUNT(*) AS count,
               (SELECT COUNT(*) FROM transactions
                WHERE status IN ('4','failed')
                AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS total
             FROM transactions
             WHERE status IN ('4','failed')
               AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             GROUP BY reason
             ORDER BY count DESC
             LIMIT 8`,
            [],
          );
      const totalFailed = Number(rows[0]?.total ?? 1) || 1;
      return rows.map(r => ({
        reason: r.reason,
        count: Number(r.count),
        pct: Math.round((Number(r.count) / totalFailed) * 1000) / 10,
      }));
    },
    { ttl: 60 },
  );
  return data;
}

/** High-level overview metrics */
export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const { data } = await getOrSet<OverviewMetrics>(
    'analytics:overview',
    async () => {
      const tenantId = await getTenantPayoutsConnectionId();

      if (tenantId) {
        // ── Tenant DB path: every metric derived from tbl_payouts (+ banks) ──
        const [tpsRows, txRows, payoutRows, bankRows] = await Promise.all([
          executeOnConnection<{ cnt: string }>(
            tenantId,
            `SELECT COUNT(*) AS cnt FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)`,
          ),
          executeOnConnection<{ total: string; success: string; vol: string }>(
            tenantId,
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status IN (1, '1') THEN 1 ELSE 0 END) AS success,
                    COALESCE(SUM(amount), 0) AS vol
             FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
          ),
          executeOnConnection<{ failed: string; vol: string }>(
            tenantId,
            `SELECT
               SUM(CASE WHEN status IN (4, '4') AND created_at >= CURDATE() THEN 1 ELSE 0 END) AS failed,
               COALESCE(SUM(amount), 0) AS vol
             FROM tbl_payouts
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
          ),
          executeOnConnection<{ down: string; total: string; avg_ms: string }>(
            tenantId,
            // Per-bank success rate over last 24h; "down" = rate < 80%
            `SELECT
               SUM(CASE WHEN rate < 80 THEN 1 ELSE 0 END) AS down,
               COUNT(*) AS total,
               AVG(avg_ms) AS avg_ms
             FROM (
               SELECT
                 p.bank_id,
                 (SUM(CASE WHEN p.status IN (1,'1') THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0)) * 100 AS rate,
                 AVG(CASE WHEN p.status IN (1,'1',4,'4')
                   AND p.updated_at IS NOT NULL AND p.created_at IS NOT NULL
                   THEN TIMESTAMPDIFF(MICROSECOND, p.created_at, p.updated_at) / 1000
                   ELSE NULL END) AS avg_ms
               FROM tbl_payouts p
               WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                 AND p.bank_id IS NOT NULL
               GROUP BY p.bank_id
             ) per_bank`,
          ),
        ]);

        const total24h = Number(txRows[0]?.total ?? 0);
        const success24h = Number(txRows[0]?.success ?? 0);
        return {
          currentTps: Math.round((Number(tpsRows[0]?.cnt ?? 0) / 60) * 100) / 100,
          successRate1h: total24h > 0 ? Math.round((success24h / total24h) * 10000) / 100 : 0,
          failedPayoutsToday: Number(payoutRows[0]?.failed ?? 0),
          activeIncidents: 0,
          totalTransactions24h: total24h,
          totalPayoutVolume24h: Number(payoutRows[0]?.vol ?? 0),
          avgResponseMs: Math.round(Number(bankRows[0]?.avg_ms ?? 0)),
          banksDown: Number(bankRows[0]?.down ?? 0),
        };
      }

      // ── Fallback: local seed data ──
      const [tpsRows, txRows, payoutRows, bankRows] = await Promise.all([
        executeSelect<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM transactions
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)`,
          [],
        ),
        executeSelect<{ total: string; success: string; vol: string }>(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('1','success') THEN 1 ELSE 0 END) AS success,
                  COALESCE(SUM(amount), 0) AS vol
           FROM transactions
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
          [],
        ),
        executeSelect<{ failed: string; vol: string }>(
          `SELECT
             SUM(CASE WHEN status IN ('4','failed') AND created_at >= CURDATE() THEN 1 ELSE 0 END) AS failed,
             COALESCE(SUM(amount), 0) AS vol
           FROM payouts
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
          [],
        ),
        executeSelect<{ down: string; avg_ms: string }>(
          `SELECT
             SUM(CASE WHEN status NOT IN ('up','active') THEN 1 ELSE 0 END) AS down,
             AVG(avg_response_ms) AS avg_ms
           FROM bank_health`,
          [],
        ),
      ]);

      const total24h = Number(txRows[0]?.total ?? 0);
      const success24h = Number(txRows[0]?.success ?? 0);
      return {
        currentTps: Math.round((Number(tpsRows[0]?.cnt ?? 0) / 60) * 100) / 100,
        successRate1h: total24h > 0 ? Math.round((success24h / total24h) * 10000) / 100 : 0,
        failedPayoutsToday: Number(payoutRows[0]?.failed ?? 0),
        activeIncidents: 0,
        totalTransactions24h: total24h,
        totalPayoutVolume24h: Number(payoutRows[0]?.vol ?? 0),
        avgResponseMs: Math.round(Number(bankRows[0]?.avg_ms ?? 0)),
        banksDown: Number(bankRows[0]?.down ?? 0),
      };
    },
    { ttl: 15 },
  );
  return data;
}

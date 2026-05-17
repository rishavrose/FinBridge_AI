/**
 * Analytics Service — queries MySQL for all fintech metrics.
 * All results are cached in Redis with short TTLs.
 */

import { executeSelect } from '../database/client.js';
import { getOrSet } from '../cache/manager.js';

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

// ─── Queries ──────────────────────────────────────────────────────────────────

/** TPS bucketed by minute for the last N minutes */
export async function getTpsTimeSeries(minutes = 60): Promise<TpsBucket[]> {
  const { data } = await getOrSet<TpsBucket[]>(
    `analytics:tps:${minutes}`,
    async () => {
      const rows = await executeSelect<{
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

/** Current live TPS (transactions in last 60 seconds / 60) */
export async function getCurrentTps(): Promise<number> {
  const { data } = await getOrSet<number>(
    'analytics:tps:live',
    async () => {
      const rows = await executeSelect<{ cnt: string }>(
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
      const rows = await executeSelect<{
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
        status: normalizeStatus(r.status),
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
      const rows = await executeSelect<{
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

/** Bank health snapshot */
export async function getBankStats(): Promise<BankStat[]> {
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

/** Top failure reasons from transactions */
export async function getFailureAnalysis(): Promise<FailureReason[]> {
  const { data } = await getOrSet<FailureReason[]>(
    'analytics:failures:24h',
    async () => {
      const rows = await executeSelect<{ reason: string; count: string; total: string }>(
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

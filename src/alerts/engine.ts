/**
 * Alert Engine — evaluates rules against live metrics and manages alert state.
 * Alerts are stored in Redis with TTL so they auto-expire when resolved.
 */

import { getRedisClient } from '../cache/client.js';
import { logger } from '../utils/logger.js';
import { getOverviewMetrics, getBankStats } from '../analytics/service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus   = 'active' | 'resolved' | 'acknowledged';

export interface Alert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
  triggeredAt: string;
  resolvedAt?: string;
  acknowledgedBy?: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: 'open' | 'investigating' | 'resolved';
  affectedSystem: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  alerts: string[];
}

// ─── Rule definitions ─────────────────────────────────────────────────────────

interface AlertRule {
  id: string;
  name: string;
  severity: AlertSeverity;
  evaluate: (metrics: Awaited<ReturnType<typeof getOverviewMetrics>>, banks: Awaited<ReturnType<typeof getBankStats>>) => { triggered: boolean; title: string; message: string; value?: number; threshold?: number } | null;
}

const RULES: AlertRule[] = [
  {
    id: 'success_rate_critical',
    name: 'Critical Success Rate Drop',
    severity: 'critical',
    evaluate: (m) => {
      if (m.successRate1h < 85) {
        return {
          triggered: true,
          title: 'Critical: Success Rate Below 85%',
          message: `Transaction success rate has dropped to ${m.successRate1h.toFixed(1)}% — immediate action required.`,
          value: m.successRate1h,
          threshold: 85,
        };
      }
      return null;
    },
  },
  {
    id: 'success_rate_warning',
    name: 'Success Rate Warning',
    severity: 'warning',
    evaluate: (m) => {
      if (m.successRate1h >= 85 && m.successRate1h < 95) {
        return {
          triggered: true,
          title: 'Warning: Success Rate Below 95%',
          message: `Success rate is at ${m.successRate1h.toFixed(1)}% — monitor closely.`,
          value: m.successRate1h,
          threshold: 95,
        };
      }
      return null;
    },
  },
  {
    id: 'bank_down',
    name: 'Bank/PSP Offline',
    severity: 'critical',
    evaluate: (_m, banks) => {
      const down = banks.filter(b => b.status !== 'up' && b.status !== 'active');
      if (down.length > 0) {
        const names = down.map(b => b.bankCode).join(', ');
        return {
          triggered: true,
          title: `Bank Offline: ${names}`,
          message: `${down.length} bank(s)/PSP(s) are reporting non-operational status: ${names}`,
          value: down.length,
          threshold: 0,
        };
      }
      return null;
    },
  },
  {
    id: 'failed_payouts_spike',
    name: 'Failed Payout Spike',
    severity: 'warning',
    evaluate: (m) => {
      if (m.failedPayoutsToday > 50) {
        return {
          triggered: true,
          title: 'High Failed Payout Count',
          message: `${m.failedPayoutsToday} payouts have failed today — review payout routing.`,
          value: m.failedPayoutsToday,
          threshold: 50,
        };
      }
      return null;
    },
  },
  {
    id: 'tps_zero',
    name: 'Transaction Flow Stopped',
    severity: 'critical',
    evaluate: (m) => {
      if (m.totalTransactions24h > 10 && m.currentTps === 0) {
        return {
          triggered: true,
          title: 'Zero TPS Detected',
          message: 'No transactions processed in the last 60 seconds. System may be down.',
          value: 0,
          threshold: 0,
        };
      }
      return null;
    },
  },
  {
    id: 'bank_slow_response',
    name: 'Slow Bank Response Time',
    severity: 'info',
    evaluate: (_m, banks) => {
      const slow = banks.filter(b => b.avgResponseMs > 2000);
      if (slow.length > 0) {
        const names = slow.map(b => b.bankCode).join(', ');
        return {
          triggered: true,
          title: 'Slow Bank Response Detected',
          message: `${slow.length} bank(s) responding >2000ms: ${names}`,
          value: slow.length,
        };
      }
      return null;
    },
  },
];

// ─── Redis keys ───────────────────────────────────────────────────────────────

const KEY_ACTIVE  = 'alerts:active';          // Hash: id → JSON
const KEY_HISTORY = 'alerts:history';          // List: last 100
const KEY_INCIDENTS = 'incidents:all';         // Hash: id → JSON

// ─── Core engine ─────────────────────────────────────────────────────────────

export async function evaluateAlerts(): Promise<Alert[]> {
  const redis = getRedisClient();
  const triggered: Alert[] = [];

  try {
    const [metrics, banks] = await Promise.all([getOverviewMetrics(), getBankStats()]);

    for (const rule of RULES) {
      const result = rule.evaluate(metrics, banks);
      const alertId = `alert:${rule.id}`;

      if (result?.triggered) {
        const existing = await redis.hget(KEY_ACTIVE, alertId);
        if (!existing) {
          const alert: Alert = {
            id: alertId,
            ruleId: rule.id,
            severity: rule.severity,
            status: 'active',
            title: result.title,
            message: result.message,
            metric: rule.name,
            value: result.value,
            threshold: result.threshold,
            triggeredAt: new Date().toISOString(),
          };
          await redis.hset(KEY_ACTIVE, alertId, JSON.stringify(alert));
          await redis.lpush(KEY_HISTORY, JSON.stringify(alert));
          await redis.ltrim(KEY_HISTORY, 0, 99);
          triggered.push(alert);
          logger.warn({ alert }, `Alert triggered: ${rule.id}`);
        }
      } else {
        // Auto-resolve
        const existing = await redis.hget(KEY_ACTIVE, alertId);
        if (existing) {
          const alert: Alert = { ...JSON.parse(existing), status: 'resolved', resolvedAt: new Date().toISOString() };
          await redis.hdel(KEY_ACTIVE, alertId);
          await redis.lpush(KEY_HISTORY, JSON.stringify(alert));
          await redis.ltrim(KEY_HISTORY, 0, 99);
          logger.info({ ruleId: rule.id }, 'Alert auto-resolved');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Alert evaluation failed');
  }

  return triggered;
}

export async function getActiveAlerts(): Promise<Alert[]> {
  const redis = getRedisClient();
  const map = await redis.hgetall(KEY_ACTIVE);
  return Object.values(map ?? {}).map(v => JSON.parse(v) as Alert);
}

export async function getAlertHistory(limit = 50): Promise<Alert[]> {
  const redis = getRedisClient();
  const items = await redis.lrange(KEY_HISTORY, 0, limit - 1);
  return items.map(v => JSON.parse(v) as Alert);
}

export async function acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
  const redis = getRedisClient();
  const raw = await redis.hget(KEY_ACTIVE, alertId);
  if (!raw) return false;
  const alert: Alert = { ...JSON.parse(raw), status: 'acknowledged', acknowledgedBy: userId };
  await redis.hset(KEY_ACTIVE, alertId, JSON.stringify(alert));
  return true;
}

// ─── Incident management ──────────────────────────────────────────────────────

export async function createIncident(data: Omit<Incident, 'id' | 'createdAt' | 'updatedAt'>): Promise<Incident> {
  const redis = getRedisClient();
  const now = new Date().toISOString();
  const incident: Incident = {
    ...data,
    id: `inc_${Date.now()}`,
    createdAt: now,
    updatedAt: now,
  };
  await redis.hset(KEY_INCIDENTS, incident.id, JSON.stringify(incident));
  return incident;
}

export async function listIncidents(): Promise<Incident[]> {
  const redis = getRedisClient();
  const map = await redis.hgetall(KEY_INCIDENTS);
  return Object.values(map ?? {})
    .map(v => JSON.parse(v) as Incident)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null> {
  const redis = getRedisClient();
  const raw = await redis.hget(KEY_INCIDENTS, id);
  if (!raw) return null;
  const updated: Incident = { ...JSON.parse(raw), ...patch, updatedAt: new Date().toISOString() };
  if (patch.status === 'resolved') updated.resolvedAt = updated.updatedAt;
  await redis.hset(KEY_INCIDENTS, id, JSON.stringify(updated));
  return updated;
}

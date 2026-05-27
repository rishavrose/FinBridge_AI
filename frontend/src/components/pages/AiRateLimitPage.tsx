import { useState, useEffect, useCallback } from 'react';
import {
  fetchAiRateConfig,
  updateAiRateConfig,
  fetchAiUserLimits,
  updateAiUserLimits,
  blockAiUser,
  unblockAiUser,
  resetAiUserCounters,
  fetchAiUsageAnalytics,
  listUsers,
} from '../../api/client';
import type { AiRateConfig, AiUserLimits, AiUsageRow } from '../../api/client';

interface Props { token: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(row: { full_name: string | null; username: string }) {
  const name = row.full_name ?? row.username;
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatarColor(username: string) {
  const palette = [
    'from-violet-500 to-purple-600',
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-500 to-amber-600',
    'from-pink-500 to-rose-600',
    'from-cyan-500 to-sky-600',
  ];
  return palette[username.charCodeAt(0) % palette.length];
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}

function pct(count: number, limit: number) {
  if (!limit) return 0;
  return Math.min(100, Math.round((count / limit) * 100));
}

const PLAN_META: Record<string, { label: string; bg: string; text: string; border: string }> = {
  standard:   { label: 'Standard',   bg: 'bg-gray-100',    text: 'text-gray-600',    border: 'border-gray-200'   },
  premium:    { label: 'Premium',    bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200'  },
  enterprise: { label: 'Enterprise', bg: 'bg-purple-50',   text: 'text-purple-700',  border: 'border-purple-200' },
};

// ─── Global Config Panel ──────────────────────────────────────────────────────

interface GlobalConfigPanelProps {
  token: string;
  onSaved: () => void;
}

function GlobalConfigPanel({ token, onSaved }: GlobalConfigPanelProps) {
  const [cfg, setCfg]         = useState<AiRateConfig | null>(null);
  const [hourly, setHourly]   = useState('');
  const [daily, setDaily]     = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    fetchAiRateConfig(token)
      .then(c => {
        setCfg(c);
        setHourly(String(c.hourlyLimit));
        setDaily(String(c.dailyLimit));
        setEnabled(c.aiEnabled);
      })
      .catch(e => setError(e.message));
  }, [token]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseInt(hourly, 10);
    const d = parseInt(daily, 10);
    if (!h || h < 1 || !d || d < 1) { setError('Limits must be positive integers.'); return; }
    setSaving(true); setError(null);
    try {
      await updateAiRateConfig({ aiEnabled: enabled, hourlyLimit: h, dailyLimit: d }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) {
    return (
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 animate-pulse">
        <div className="h-4 w-40 bg-gray-100 rounded mb-4" />
        <div className="h-10 w-full bg-gray-50 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#F0F0F0] flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h2 className="font-bold text-[#1a1a2e] text-sm">Global AI Configuration</h2>
          <p className="text-xs text-gray-400">Default limits for all users · changes propagate within 60 seconds</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
        {/* Kill switch */}
        <div className="flex items-center justify-between p-4 rounded-xl border border-[#EBEBEB] bg-gray-50">
          <div>
            <div className="text-sm font-semibold text-[#1a1a2e]">AI Chat Enabled</div>
            <div className="text-xs text-gray-400 mt-0.5">Turn off to disable AI for all users globally</div>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              enabled ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {/* Limits row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Hourly Limit</label>
            <div className="relative">
              <input
                type="number" min={1} value={hourly} onChange={e => setHourly(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                           focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">req/hr</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Daily Limit</label>
            <div className="relative">
              <input
                type="number" min={1} value={daily} onChange={e => setDaily(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                           focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">req/day</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 rounded-xl border border-red-100 text-sm text-red-600">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        <button
          type="submit" disabled={saving}
          className="w-full py-2.5 px-4 bg-brand hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Global Config'}
        </button>
      </form>
    </div>
  );
}

// ─── User Limits Modal ────────────────────────────────────────────────────────

interface UserLimitsModalProps {
  userId: string;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}

function UserLimitsModal({ userId, token, onClose, onSaved }: UserLimitsModalProps) {
  const [limits, setLimits]         = useState<AiUserLimits | null>(null);
  const [isBlocked, setIsBlocked]   = useState(false);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [hourly, setHourly]         = useState('');
  const [daily, setDaily]           = useState('');
  const [plan, setPlan]             = useState('standard');
  const [blockReason, setBlockReason] = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    fetchAiUserLimits(userId, token)
      .then(l => {
        setLimits(l);
        setIsBlocked(l.isBlocked);
        setIsUnlimited(l.isUnlimited);
        setHourly(l.hourlyLimit != null ? String(l.hourlyLimit) : '');
        setDaily(l.dailyLimit != null ? String(l.dailyLimit) : '');
        setPlan(l.planType ?? 'standard');
        setBlockReason(l.blockReason ?? '');
      })
      .catch(e => setError(e.message));
  }, [userId, token]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await updateAiUserLimits(userId, {
        isBlocked,
        isUnlimited,
        hourlyLimit: hourly ? parseInt(hourly, 10) : null,
        dailyLimit:  daily  ? parseInt(daily,  10) : null,
        planType:    plan,
        blockReason: isBlocked ? (blockReason || 'Suspended by admin.') : null,
      }, token);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-[#EBEBEB] w-full sm:max-w-md max-h-[92vh] overflow-y-auto">

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
          <div>
            <h2 className="font-bold text-[#1a1a2e] text-base">Edit User Limits</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-[220px]">{userId}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!limits ? (
          <div className="px-6 py-10 flex justify-center">
            <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="px-6 py-5 space-y-5">

            {/* Blocked toggle */}
            <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
              isBlocked ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-[#EBEBEB]'
            }`}>
              <div>
                <div className="text-sm font-semibold text-[#1a1a2e]">Block User</div>
                <div className="text-xs text-gray-400 mt-0.5">Prevents this user from making AI requests</div>
              </div>
              <button type="button" onClick={() => setIsBlocked(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  isBlocked ? 'bg-red-500' : 'bg-gray-300'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  isBlocked ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {isBlocked && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Block Reason</label>
                <input type="text" value={blockReason} onChange={e => setBlockReason(e.target.value)}
                  placeholder="Reason shown to user…"
                  className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                             focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all" />
              </div>
            )}

            {/* Unlimited toggle */}
            <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
              isUnlimited ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-[#EBEBEB]'
            }`}>
              <div>
                <div className="text-sm font-semibold text-[#1a1a2e]">Unlimited Plan</div>
                <div className="text-xs text-gray-400 mt-0.5">Bypasses all rate limits (premium/enterprise)</div>
              </div>
              <button type="button" onClick={() => setIsUnlimited(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  isUnlimited ? 'bg-amber-500' : 'bg-gray-300'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  isUnlimited ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {/* Plan type */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan Type</label>
              <div className="grid grid-cols-3 gap-2">
                {(['standard', 'premium', 'enterprise'] as const).map(p => {
                  const m = PLAN_META[p];
                  return (
                    <button key={p} type="button" onClick={() => setPlan(p)}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                        plan === p
                          ? `${m.bg} ${m.text} ${m.border} ring-2 ring-offset-1 ring-current`
                          : 'bg-gray-50 text-gray-500 border-[#EBEBEB] hover:bg-gray-100'
                      }`}>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom limits */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Custom Limits <span className="normal-case font-normal">(leave blank to use global)</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-gray-400">Hourly</label>
                  <div className="relative">
                    <input type="number" min={1} value={hourly} onChange={e => setHourly(e.target.value)}
                      placeholder="Global"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                                 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all pr-12" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">/hr</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-gray-400">Daily</label>
                  <div className="relative">
                    <input type="number" min={1} value={daily} onChange={e => setDaily(e.target.value)}
                      placeholder="Global"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                                 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all pr-12" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">/day</span>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 rounded-xl border border-red-100 text-sm text-red-600">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition-all">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2.5 px-4 bg-brand hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Block Confirm Modal ──────────────────────────────────────────────────────

interface BlockModalProps {
  userId: string;
  token: string;
  onClose: () => void;
  onDone: () => void;
}

function BlockModal({ userId, token, onClose, onDone }: BlockModalProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await blockAiUser(userId, reason || 'AI access suspended by administrator.', token);
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#EBEBEB] w-full max-w-sm">
        <div className="px-6 pt-6 pb-2 text-center">
          <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="font-bold text-[#1a1a2e] text-base">Block User?</h3>
          <p className="text-xs text-gray-400 mt-1 font-mono break-all">{userId}</p>
        </div>
        <form onSubmit={handleBlock} className="px-6 pb-6 pt-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason <span className="normal-case font-normal text-gray-400">(optional)</span></label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Reason shown to user…"
              className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                         focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 focus:bg-white transition-all" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition-all">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all">
              {saving ? 'Blocking…' : 'Block User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Usage Row card ───────────────────────────────────────────────────────────

interface UsageRowProps {
  row: AiUsageRow;
  globalCfg: AiRateConfig | null;
  token: string;
  onAction: () => void;
}

function UsageRowCard({ row, globalCfg, token, onAction }: UsageRowProps) {
  const [limitsOpen, setLimitsOpen]   = useState(false);
  const [blockOpen, setBlockOpen]     = useState(false);
  const [resetting, setResetting]     = useState(false);
  const [actionMsg, setActionMsg]     = useState<string | null>(null);

  const isBlocked   = row.is_blocked   === 1;
  const isUnlimited = row.is_unlimited === 1;

  // Per-user custom limit overrides the global default (null = inherit global).
  const hourlyLimit = row.hourly_limit ?? globalCfg?.hourlyLimit ?? 100;
  const dailyLimit  = row.daily_limit  ?? globalCfg?.dailyLimit  ?? 1000;

  const hourlyPct = isUnlimited ? 0 : pct(row.hourlyCount, hourlyLimit);
  const dailyPct  = isUnlimited ? 0 : pct(row.dailyCount,  dailyLimit);

  const handleUnblock = async () => {
    try {
      await unblockAiUser(row.user_id, token);
      showMsg('Unblocked');
      onAction();
    } catch (e) { showMsg((e as Error).message); }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetAiUserCounters(row.user_id, token);
      showMsg('Counters reset');
      onAction();
    } catch (e) { showMsg((e as Error).message); }
    finally { setResetting(false); }
  };

  const showMsg = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 2500);
  };

  const planMeta = PLAN_META[row.plan_type] ?? PLAN_META.standard;

  return (
    <>
      {limitsOpen && (
        <UserLimitsModal
          userId={row.user_id}
          token={token}
          onClose={() => setLimitsOpen(false)}
          onSaved={onAction}
        />
      )}
      {blockOpen && (
        <BlockModal
          userId={row.user_id}
          token={token}
          onClose={() => setBlockOpen(false)}
          onDone={onAction}
        />
      )}

      <div className={`bg-white rounded-2xl border shadow-sm transition-all ${
        isBlocked ? 'border-red-200 bg-red-50/30' : 'border-[#EBEBEB]'
      }`}>
        <div className="px-5 py-4">
          {/* Top row */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              {/* Avatar + name */}
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${avatarColor(row.username)} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white text-xs font-bold">{initials(row)}</span>
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[#1a1a2e] text-sm truncate">
                    {row.full_name ?? row.username}
                  </div>
                  <div className="text-xs text-gray-400 font-mono truncate">@{row.username}</div>
                </div>
              </div>
              {/* Badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {isBlocked && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 border border-red-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    BLOCKED
                  </span>
                )}
                {isUnlimited && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                    ∞ UNLIMITED
                  </span>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${planMeta.bg} ${planMeta.text} ${planMeta.border}`}>
                  {planMeta.label}
                </span>
                <span className="text-[10px] text-gray-300">·</span>
                <span className="text-[11px] text-gray-400">
                  Last active: {fmtDate(row.last_request_at)}
                </span>
                <span className="text-[10px] text-gray-300">·</span>
                <span className="text-[11px] text-gray-400">
                  {row.total_requests.toLocaleString()} total requests
                </span>
              </div>
            </div>

            {/* Action msg flash */}
            {actionMsg && (
              <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg flex-shrink-0">{actionMsg}</span>
            )}
          </div>

          {/* Usage bars */}
          {!isUnlimited && !isBlocked && (
            <div className="space-y-2 mb-4">
              <div>
                <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                  <span>Hourly</span>
                  <span className={hourlyPct > 80 ? 'text-red-500 font-semibold' : ''}>{row.hourlyCount} / {hourlyLimit}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      hourlyPct > 80 ? 'bg-red-400' : hourlyPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${hourlyPct}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                  <span>Daily</span>
                  <span className={dailyPct > 80 ? 'text-red-500 font-semibold' : ''}>{row.dailyCount} / {dailyLimit}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      dailyPct > 80 ? 'bg-red-400' : dailyPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${dailyPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setLimitsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Limits
            </button>

            {isBlocked ? (
              <button onClick={handleUnblock}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-semibold rounded-lg transition-all">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                Unblock
              </button>
            ) : (
              <button onClick={() => setBlockOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg transition-all">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Block
              </button>
            )}

            <button onClick={handleReset} disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-600 text-xs font-semibold rounded-lg transition-all">
              <svg className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset Counters
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Lookup Panel ─────────────────────────────────────────────────────────────

interface LookupPanelProps {
  token: string;
  globalCfg: AiRateConfig | null;
  onAction: () => void;
}

function LookupPanel({ token, globalCfg, onAction }: LookupPanelProps) {
  const [userId, setUserId]   = useState('');
  const [row, setRow]         = useState<AiUsageRow | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) return;
    setLoading(true); setError(null); setRow(null);
    try {
      // Resolve username → UUID if needed
      let resolvedId = userId.trim();
      const isUuid = /^[0-9a-f-]{36}$/.test(resolvedId);
      const { users } = await listUsers(token);
      if (!isUuid) {
        const match = users.find(u => u.username.toLowerCase() === resolvedId.toLowerCase());
        if (!match) { setError(`User "${resolvedId}" not found`); return; }
        resolvedId = match.id;
      }

      const limits = await fetchAiUserLimits(resolvedId, token);
      const user = users.find(u => u.id === resolvedId);
      setRow({
        user_id:         resolvedId,
        username:        user?.username ?? resolvedId,
        full_name:       user?.full_name ?? null,
        total_requests:  0,
        last_request_at: null,
        hourlyCount:     0,
        dailyCount:      0,
        plan_type:       limits.planType,
        is_blocked:      limits.isBlocked   ? 1 : 0,
        is_unlimited:    limits.isUnlimited ? 1 : 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] shadow-sm">
      <div className="px-6 py-4 border-b border-[#F0F0F0] flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div>
          <h2 className="font-bold text-[#1a1a2e] text-sm">Look Up User</h2>
          <p className="text-xs text-gray-400">Search by username or user ID to view and manage limits</p>
        </div>
      </div>
      <div className="px-6 py-5 space-y-4">
        <form onSubmit={handleLookup} className="flex gap-2">
          <input
            type="text" value={userId} onChange={e => setUserId(e.target.value)}
            placeholder="user-uuid or username…"
            className="flex-1 px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                       focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all font-mono"
          />
          <button type="submit" disabled={loading}
            className="px-4 py-2.5 bg-brand hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all">
            {loading ? '…' : 'Look Up'}
          </button>
        </form>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        {row && (
          <UsageRowCard
            row={row}
            globalCfg={globalCfg}
            token={token}
            onAction={() => { onAction(); setRow(null); setUserId(''); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AiRateLimitPage({ token }: Props) {
  const [usage, setUsage]       = useState<AiUsageRow[]>([]);
  const [globalCfg, setGlobalCfg] = useState<AiRateConfig | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [usageError, setUsageError]     = useState<string | null>(null);
  const [tab, setTab]           = useState<'usage' | 'lookup'>('usage');
  const [refresh, setRefresh]   = useState(0);

  const reload = useCallback(() => setRefresh(r => r + 1), []);

  useEffect(() => {
    fetchAiRateConfig(token).then(setGlobalCfg).catch(() => {});
  }, [token, refresh]);

  useEffect(() => {
    setLoadingUsage(true);
    fetchAiUsageAnalytics(token, 50)
      .then(res => setUsage(res.rows))
      .catch(e => setUsageError(e.message))
      .finally(() => setLoadingUsage(false));
  }, [token, refresh]);

  const blockedCount   = usage.filter(r => r.is_blocked   === 1).length;
  const unlimitedCount = usage.filter(r => r.is_unlimited === 1).length;
  const totalRequests  = usage.reduce((s, r) => s + r.total_requests, 0);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-[#1a1a2e]">AI Rate Limiting</h1>
        <p className="text-sm text-gray-400 mt-0.5">Control how many AI requests users can make · set limits, block users, grant unlimited access</p>
      </div>

      {/* Summary stat pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'AI Status',
            value: globalCfg == null ? '…' : (globalCfg.aiEnabled ? 'Online' : 'Disabled'),
            sub: globalCfg == null ? '' : `${globalCfg.hourlyLimit}/hr · ${globalCfg.dailyLimit}/day`,
            color: globalCfg?.aiEnabled === false ? 'text-red-600' : 'text-emerald-600',
            dot:   globalCfg?.aiEnabled === false ? 'bg-red-400' : 'bg-emerald-400',
          },
          {
            label: 'Total Users Tracked',
            value: usage.length,
            sub: 'with usage history',
            color: 'text-blue-600', dot: 'bg-blue-400',
          },
          {
            label: 'Blocked',
            value: blockedCount,
            sub: 'users suspended',
            color: blockedCount > 0 ? 'text-red-600' : 'text-gray-500',
            dot:   blockedCount > 0 ? 'bg-red-400' : 'bg-gray-300',
          },
          {
            label: 'Total Lifetime Requests',
            value: totalRequests.toLocaleString(),
            sub: `${unlimitedCount} unlimited users`,
            color: 'text-purple-600', dot: 'bg-purple-400',
          },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-2xl border border-[#EBEBEB] shadow-sm px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stat.dot}`} />
              <span className="text-xs text-gray-400">{stat.label}</span>
            </div>
            <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Global config */}
      <GlobalConfigPanel token={token} onSaved={reload} />

      {/* Tabs: Usage list vs Lookup */}
      <div>
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit mb-4">
          {(['usage', 'lookup'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'usage' ? `Usage Analytics (${usage.length})` : 'Look Up User'}
            </button>
          ))}
        </div>

        {tab === 'lookup' && (
          <LookupPanel token={token} globalCfg={globalCfg} onAction={reload} />
        )}

        {tab === 'usage' && (
          <div className="space-y-3">
            {loadingUsage ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-2xl border border-[#EBEBEB] p-5 animate-pulse">
                    <div className="flex justify-between mb-3">
                      <div className="h-4 w-48 bg-gray-100 rounded" />
                      <div className="h-4 w-20 bg-gray-100 rounded" />
                    </div>
                    <div className="h-2 w-full bg-gray-100 rounded-full mb-2" />
                    <div className="h-2 w-3/4 bg-gray-100 rounded-full" />
                  </div>
                ))}
              </div>
            ) : usageError ? (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-sm text-red-600">{usageError}</div>
            ) : usage.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#EBEBEB] px-6 py-12 text-center">
                <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-sm text-gray-400">No AI usage data yet</p>
                <p className="text-xs text-gray-300 mt-1">Users will appear here once they start using AI chat</p>
              </div>
            ) : (
              usage.map(row => (
                <UsageRowCard
                  key={row.user_id}
                  row={row}
                  globalCfg={globalCfg}
                  token={token}
                  onAction={reload}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

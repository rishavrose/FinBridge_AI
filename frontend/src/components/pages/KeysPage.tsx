import { useState, useEffect, useCallback } from 'react';
import { listApiKeys, createApiKey, revokeApiKey } from '../../api/client';
import type { ApiKeyRecord, Role } from '../../types';

interface KeysPageProps {
  token: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin:    'text-purple-600 bg-purple-50 border-purple-200',
  service:  'text-blue-600 bg-blue-50 border-blue-200',
  analyst:  'text-emerald-600 bg-emerald-50 border-emerald-200',
  readonly: 'text-gray-500 bg-gray-100 border-gray-200',
};

const ROLES: Role[] = ['readonly', 'analyst', 'service', 'admin'];

export function KeysPage({ token }: KeysPageProps) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('analyst');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState<string | null>(null);

  // Revoke state
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listApiKeys(token);
      setKeys(res.apiKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadKeys(); }, [loadKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    setNewRawKey(null);
    try {
      const days = expiresInDays ? Number(expiresInDays) : undefined;
      const res = await createApiKey(name.trim(), role, days, token);
      setNewRawKey(res.rawKey);
      setNewKeyName(res.name);
      setName('');
      setExpiresInDays('');
      await loadKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await revokeApiKey(id, token);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setRevoking(null);
    }
  };

  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-bold text-[#404040]">Key Management</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase tracking-wide">
              Admin only
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1">Create and revoke API keys for service-to-service access</p>
        </div>
        <button
          onClick={loadKeys}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-[#EBEBEB] rounded-lg text-sm text-gray-500 hover:text-brand hover:border-brand/30 shadow-sm disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex gap-3">
        <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-amber-700">
          Raw API keys are shown <strong>only once</strong> at creation time. Keys are stored as SHA-256 hashes — if a key is lost, revoke it and create a new one.
        </p>
      </div>

      {/* Newly created key — show raw key once */}
      {newRawKey && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <span className="text-sm font-semibold text-emerald-700">API key created: <em>{newKeyName}</em> — copy it now!</span>
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-4 py-2.5 text-sm font-mono text-emerald-800 break-all">
              {newRawKey}
            </code>
            <button
              onClick={() => { void navigator.clipboard.writeText(newRawKey); }}
              className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex-shrink-0"
            >
              Copy
            </button>
          </div>
          <button onClick={() => { setNewRawKey(null); setNewKeyName(null); }} className="text-xs text-emerald-600 hover:underline">
            I've saved this key — dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <div className="bg-white border border-[#EBEBEB] rounded-xl p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-[#404040] mb-4">Create New API Key</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Name */}
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-[#404040] mb-1.5">Key Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. payment-service"
                required
                className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2.5 text-sm
                           placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            {/* Role */}
            <div>
              <label className="block text-xs font-medium text-[#404040] mb-1.5">Role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as Role)}
                className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Expires */}
            <div>
              <label className="block text-xs font-medium text-[#404040] mb-1.5">
                Expires in (days) <span className="text-gray-400 font-normal">— leave blank for no expiry</span>
              </label>
              <input
                type="number"
                value={expiresInDays}
                onChange={e => setExpiresInDays(e.target.value)}
                placeholder="e.g. 90"
                min={1}
                className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2.5 text-sm
                           placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>
          </div>

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">
              {createError}
            </div>
          )}

          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-400
                       text-white rounded-lg text-sm font-semibold transition-colors shadow-sm shadow-brand/20"
          >
            {creating ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Key
              </>
            )}
          </button>
        </form>
      </div>

      {/* Keys list */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Existing Keys {!loading && `(${keys.length})`}
        </h2>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-600 mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="bg-white border border-[#EBEBEB] rounded-xl py-12 text-center text-gray-400 text-sm shadow-sm">
            Loading keys…
          </div>
        )}

        {!loading && keys.length === 0 && (
          <div className="bg-white border border-[#EBEBEB] rounded-xl py-12 text-center shadow-sm">
            <svg className="w-10 h-10 mx-auto mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <p className="text-sm text-gray-400">No API keys yet — create one above</p>
          </div>
        )}

        {!loading && keys.length > 0 && (
          <div className="bg-white border border-[#EBEBEB] rounded-xl overflow-x-auto shadow-sm">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-[#EBEBEB] bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Name</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Role</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Created</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Expires</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-400 font-semibold">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b border-[#EBEBEB] last:border-0 hover:bg-brand-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-[#404040]">{k.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${ROLE_COLORS[k.role] ?? ROLE_COLORS.readonly}`}>
                        {k.role}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{fmt(k.createdAt)}</td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">
                      {k.expiresAt ? (
                        <span className={new Date(k.expiresAt) < new Date() ? 'text-red-500' : ''}>
                          {fmt(k.expiresAt)}
                        </span>
                      ) : 'Never'}
                    </td>
                    <td className="px-5 py-3.5">
                      {k.active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {k.active && (
                        <button
                          onClick={() => void handleRevoke(k.id)}
                          disabled={revoking === k.id}
                          className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg border border-transparent hover:border-red-200 transition-all disabled:opacity-50"
                        >
                          {revoking === k.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { listUsers, createUser, updateUser, deleteUser } from '../../api/client';
import type { AppUser } from '../../api/client';

interface Props { token: string }

const ROLES = ['readonly', 'analyst', 'service', 'admin'] as const;
type RoleType = typeof ROLES[number];

const ROLE_META: Record<RoleType, { label: string; desc: string; bg: string; text: string; border: string; dot: string }> = {
  admin:    { label: 'Admin',    desc: 'Full access + settings', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  service:  { label: 'Service',  desc: 'Tools + schema ops',     bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500'   },
  analyst:  { label: 'Analyst',  desc: 'All query tools',        bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  readonly: { label: 'Readonly', desc: 'View only',              bg: 'bg-gray-100',  text: 'text-gray-600',   border: 'border-gray-200',   dot: 'bg-gray-400'   },
};

function initials(user: AppUser) {
  const name = user.full_name ?? user.username;
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatarColor(username: string) {
  const colors = [
    'from-violet-500 to-purple-600',
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-500 to-amber-600',
    'from-pink-500 to-rose-600',
    'from-cyan-500 to-sky-600',
  ];
  const idx = username.charCodeAt(0) % colors.length;
  return colors[idx];
}

function fmtDate(s: string) {
  try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return s; }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string;
  onClose: () => void;
  onSubmit: (d: { username: string; password: string; fullName: string; role: RoleType }) => Promise<void>;
  initial?: Partial<{ username: string; fullName: string; role: RoleType }>;
  editMode?: boolean;
  submitting: boolean;
  error: string | null;
}

function UserModal({ title, onClose, onSubmit, initial, editMode, submitting, error }: ModalProps) {
  const [username, setUsername] = useState(initial?.username ?? '');
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [role, setRole] = useState<RoleType>(initial?.role ?? 'analyst');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({ username, password, fullName, role });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-[#EBEBEB] w-full sm:max-w-md max-h-[92vh] overflow-y-auto">

        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
          <div>
            <h2 className="font-bold text-[#1a1a2e] text-base">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{editMode ? 'Update user details below' : 'Fill in the details to create a new account'}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">

          {/* Username + Full name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Username *</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="john.doe" disabled={editMode} required={!editMode}
                className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                           placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white
                           disabled:opacity-50 disabled:cursor-not-allowed transition-all" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Full Name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                           placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all" />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Password {editMode && <span className="text-gray-400 normal-case font-normal">(leave blank to keep)</span>}
            </label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder={editMode ? 'Leave blank to keep current' : 'Minimum 6 characters'}
                required={!editMode} minLength={(!editMode || password) ? 6 : undefined}
                className="w-full pr-10 px-3 py-2.5 bg-gray-50 border border-[#E8E8E8] rounded-xl text-sm text-[#1a1a2e]
                           placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white transition-all" />
              <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {showPass
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                  }
                </svg>
              </button>
            </div>
          </div>

          {/* Role picker */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Role *</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map(r => {
                const m = ROLE_META[r];
                const active = role === r;
                return (
                  <button key={r} type="button" onClick={() => setRole(r)}
                    className={`relative flex items-start gap-2.5 p-3 rounded-xl border-2 text-left transition-all ${
                      active ? `${m.bg} ${m.border}` : 'border-[#EBEBEB] hover:border-gray-200 bg-white'
                    }`}>
                    <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${active ? m.dot : 'bg-gray-300'}`} />
                    <div>
                      <div className={`text-xs font-bold ${active ? m.text : 'text-[#404040]'}`}>{m.label}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{m.desc}</div>
                    </div>
                    {active && (
                      <span className="absolute top-2 right-2">
                        <svg className={`w-3.5 h-3.5 ${m.text}`} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2.5 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[#E8E8E8] text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-brand-600 disabled:opacity-50
                         text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm shadow-brand/20">
              {submitting
                ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</>
                : editMode ? 'Save Changes' : 'Create User'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({ user, onCancel, onConfirm, loading }: {
  user: AppUser; onCancel: () => void; onConfirm: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#EBEBEB] w-full max-w-sm p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-[#1a1a2e]">Delete user?</h3>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-medium text-[#404040]">@{user.username}</span> will be permanently removed and cannot be recovered.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-[#E8E8E8] text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2">
            {loading ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : null}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function UsersPage({ token }: Props) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await listUsers(token); setUsers(res.users); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // Stats
  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active === 1).length,
    admins: users.filter(u => u.role === 'admin').length,
    analysts: users.filter(u => u.role === 'analyst').length,
  };

  const handleCreate = async (data: { username: string; password: string; fullName: string; role: RoleType }) => {
    setSubmitting(true); setModalError(null);
    try {
      await createUser({ username: data.username, password: data.password, fullName: data.fullName || undefined, role: data.role }, token);
      setShowCreate(false);
      showToast('User created successfully');
      void load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to create user');
    } finally { setSubmitting(false); }
  };

  const handleEdit = async (data: { username: string; password: string; fullName: string; role: RoleType }) => {
    if (!editUser) return;
    setSubmitting(true); setModalError(null);
    try {
      await updateUser(editUser.id, { fullName: data.fullName || undefined, role: data.role, password: data.password || undefined }, token);
      setEditUser(null);
      showToast('User updated successfully');
      void load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to update user');
    } finally { setSubmitting(false); }
  };

  const handleToggleActive = async (user: AppUser) => {
    try {
      await updateUser(user.id, { isActive: user.is_active === 0 }, token);
      showToast(user.is_active === 1 ? 'User deactivated' : 'User activated');
      void load();
    } catch (err) { showToast(err instanceof Error ? err.message : 'Update failed', 'error'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteUser(deleteTarget.id, token);
      setDeleteTarget(null);
      showToast('User deleted');
      void load();
    } catch (err) {
      setDeleteTarget(null);
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally { setDeleting(false); }
  };

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-5xl mx-auto">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium
          ${toast.type === 'success' ? 'bg-[#1a1a2e] text-white' : 'bg-red-500 text-white'}`}>
          {toast.type === 'success'
            ? <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          }
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1a1a2e]">User Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">Create and manage platform users</p>
        </div>
        <button onClick={() => { setShowCreate(true); setModalError(null); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand hover:bg-brand-600 text-white text-sm font-semibold rounded-xl
                     shadow-sm shadow-brand/20 transition-all active:scale-95">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Users', value: stats.total, icon: '👥', color: 'bg-brand-50 border-brand/15 text-brand' },
          { label: 'Active',      value: stats.active, icon: '✅', color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
          { label: 'Admins',      value: stats.admins, icon: '🛡️', color: 'bg-purple-50 border-purple-100 text-purple-700' },
          { label: 'Analysts',    value: stats.analysts, icon: '📊', color: 'bg-amber-50 border-amber-100 text-amber-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border p-4 flex items-center gap-3 ${s.color}`}>
            <span className="text-2xl">{s.icon}</span>
            <div>
              <div className="text-xl font-bold leading-none">{s.value}</div>
              <div className="text-[11px] font-medium mt-0.5 opacity-70">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#EBEBEB] shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-100 rounded-full w-32" />
                  <div className="h-2.5 bg-gray-100 rounded-full w-20" />
                </div>
                <div className="h-5 w-16 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-[#EBEBEB] flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-400">No users yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add User" to create the first one</p>
          </div>
        ) : (
          <div>
            {/* Column header */}
            <div className="hidden sm:grid grid-cols-[auto_1fr_120px_90px_110px_100px] items-center gap-4 px-5 py-3 bg-gray-50/80 border-b border-[#EBEBEB]">
              <div className="w-10" />
              {['Name / Username', 'Role', 'Status', 'Created', 'Actions'].map(h => (
                <span key={h} className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</span>
              ))}
            </div>

            {users.map((user, i) => {
              const m = ROLE_META[user.role as RoleType] ?? ROLE_META.readonly;
              const active = user.is_active === 1;
              return (
                <div key={user.id}
                  className={`flex sm:grid sm:grid-cols-[auto_1fr_120px_90px_110px_100px] items-center gap-4 px-5 py-4
                    ${i !== users.length - 1 ? 'border-b border-[#F5F5F5]' : ''}
                    ${!active ? 'opacity-55' : ''}
                    hover:bg-gray-50/50 transition-colors`}>

                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarColor(user.username)}
                                  flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm`}>
                    {initials(user)}
                  </div>

                  {/* Name */}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-[#1a1a2e] truncate">
                      {user.full_name ?? user.username}
                    </div>
                    <div className="text-xs text-gray-400">@{user.username}</div>
                  </div>

                  {/* Role badge */}
                  <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${m.bg} ${m.text} ${m.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
                    {m.label}
                  </span>

                  {/* Status */}
                  <span className={`hidden sm:flex items-center gap-1.5 text-xs font-medium ${active ? 'text-emerald-600' : 'text-gray-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    {active ? 'Active' : 'Inactive'}
                  </span>

                  {/* Created */}
                  <span className="hidden sm:block text-xs text-gray-400">{fmtDate(user.created_at)}</span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 ml-auto sm:ml-0">
                    <button onClick={() => { setEditUser(user); setModalError(null); }}
                      title="Edit"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-brand hover:bg-brand-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>

                    <button onClick={() => handleToggleActive(user)}
                      title={active ? 'Deactivate' : 'Activate'}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                        active ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'
                      }`}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {active
                          ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        }
                      </svg>
                    </button>

                    <button onClick={() => setDeleteTarget(user)}
                      title="Delete"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <UserModal title="Create New User" onClose={() => setShowCreate(false)}
          onSubmit={handleCreate} submitting={submitting} error={modalError} />
      )}
      {editUser && (
        <UserModal title={`Edit @${editUser.username}`} editMode
          initial={{ username: editUser.username, fullName: editUser.full_name ?? '', role: editUser.role as RoleType }}
          onClose={() => setEditUser(null)} onSubmit={handleEdit} submitting={submitting} error={modalError} />
      )}
      {deleteTarget && (
        <DeleteConfirm user={deleteTarget} onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete} loading={deleting} />
      )}
    </div>
  );
}

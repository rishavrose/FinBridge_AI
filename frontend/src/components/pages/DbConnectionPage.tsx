import { useState, useEffect } from 'react';
import {
  testDbConnection,
  connectDatabase,
  listDbConnections,
  removeDbConnection,
  refreshDbConnectionTools,
  getDbConnectionSchema,
  type DbConnectPayload,
  type DbTestResult,
  type DbConnectResult,
  type DbConnectionRecord,
} from '../../api/client';

interface DbConnectionPageProps {
  token: string;
}

const DEFAULT_FORM: DbConnectPayload = {
  host: '',
  port: 3306,
  database: '',
  username: '',
  password: '',
  ssl: false,
  name: '',
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-[#404040] uppercase tracking-wide mb-3">
      {children}
    </h2>
  );
}

export function DbConnectionPage({ token }: DbConnectionPageProps) {
  const [form, setForm] = useState<DbConnectPayload>(DEFAULT_FORM);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<DbTestResult | null>(null);
  const [connectResult, setConnectResult] = useState<DbConnectResult | null>(null);
  const [connections, setConnections] = useState<DbConnectionRecord[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<{ id: string; tools: string[]; tables: string[] } | null>(null);

  // ── Table picker modal state ──────────────────────────────────────────────
  const [pickerMode, setPickerMode] = useState<'connect' | 'refresh' | null>(null);
  const [pickerRefreshId, setPickerRefreshId] = useState<string | null>(null);
  const [pickerTables, setPickerTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const loadConnections = async () => {
    setLoadingConnections(true);
    try {
      const res = await listDbConnections(token);
      setConnections(res.connections);
    } catch {
      // non-fatal — user might not be admin
    } finally {
      setLoadingConnections(false);
    }
  };

  useEffect(() => { void loadConnections(); }, [token]);

  const handleChange = (field: keyof DbConnectPayload, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
    setConnectResult(null);
    setError(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testDbConnection(form, token);
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  // ── Open table picker before connecting ──────────────────────────────────
  const handleOpenConnectPicker = () => {
    const tables = testResult?.tables ?? [];
    if (tables.length === 0) {
      void handleConnect([]);
      return;
    }
    setPickerTables(tables);
    setSelectedTables(new Set(tables));
    setPickerMode('connect');
  };

  const handleConnect = async (tables: string[]) => {
    setConnecting(true);
    setConnectResult(null);
    setError(null);
    setPickerMode(null);
    try {
      const result = await connectDatabase(
        { ...form, selectedTables: tables.length > 0 ? tables : undefined },
        token,
      );
      setConnectResult(result);
      setForm(DEFAULT_FORM);
      setTestResult(null);
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  // ── Open table picker for refresh ────────────────────────────────────────
  const handleOpenRefreshPicker = async (id: string) => {
    setLoadingSchema(true);
    setRefreshResult(null);
    setError(null);
    try {
      const schema = await getDbConnectionSchema(id, token);
      const tableNames = schema.tables.map((t) => t.name);
      const conn = connections.find((c) => c.id === id);
      const preSelected = conn?.selectedTables ?? tableNames;
      setPickerTables(tableNames);
      setSelectedTables(new Set(preSelected));
      setPickerRefreshId(id);
      setPickerMode('refresh');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schema');
    } finally {
      setLoadingSchema(false);
    }
  };

  const handleRefresh = async (id: string, tables: string[]) => {
    setRefreshingId(id);
    setRefreshResult(null);
    setPickerMode(null);
    try {
      const result = await refreshDbConnectionTools(
        id,
        token,
        tables.length > 0 ? tables : undefined,
      );
      setRefreshResult({ id, tools: result.toolsGenerated, tables: result.tablesDiscovered });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await removeDbConnection(id, token);
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemovingId(null);
    }
  };

  // ── Table picker helpers ──────────────────────────────────────────────────
  const toggleTable = (name: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedTables((prev) =>
      prev.size === pickerTables.length ? new Set() : new Set(pickerTables),
    );
  };

  const confirmPicker = () => {
    const tables = [...selectedTables];
    if (pickerMode === 'connect') {
      void handleConnect(tables);
    } else if (pickerMode === 'refresh' && pickerRefreshId) {
      void handleRefresh(pickerRefreshId, tables);
    }
  };

  const cancelPicker = () => {
    setPickerMode(null);
    setPickerRefreshId(null);
  };

  const isFormValid =
    form.host.trim() && form.database.trim() && form.username.trim() && form.password.trim();

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── Table Picker Modal ── */}
      {pickerMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EBEBEB]">
              <h3 className="font-semibold text-[#404040] text-base">Select Tables to Generate Tools</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {pickerTables.length} table{pickerTables.length !== 1 ? 's' : ''} found.
                Choose which to expose as MCP query tools.
              </p>
            </div>

            <div className="px-5 pt-4 pb-2">
              {/* Select all toggle */}
              <label className="flex items-center gap-3 mb-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedTables.size === pickerTables.length && pickerTables.length > 0}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                />
                <span className="text-sm font-medium text-gray-600 group-hover:text-gray-800">
                  {selectedTables.size === pickerTables.length ? 'Deselect All' : 'Select All'}
                  <span className="ml-2 text-gray-400 font-normal">
                    ({selectedTables.size}/{pickerTables.length} selected)
                  </span>
                </span>
              </label>

              {/* Table list */}
              <div className="border border-[#EBEBEB] rounded-lg max-h-60 overflow-y-auto divide-y divide-[#F5F5F5]">
                {pickerTables.map((table) => (
                  <label
                    key={table}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-blue-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTables.has(table)}
                      onChange={() => toggleTable(table)}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer flex-shrink-0"
                    />
                    <span className="text-sm text-[#404040] font-mono">{table}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 flex items-center gap-3 justify-end bg-gray-50/50 border-t border-[#EBEBEB]">
              <button
                onClick={cancelPicker}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmPicker}
                disabled={selectedTables.size === 0 || connecting || refreshingId !== null}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-blue-200"
              >
                {(connecting || refreshingId !== null) ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Processing…
                  </span>
                ) : (
                  <>
                    {pickerMode === 'connect' ? 'Generate Tools' : 'Refresh Tools'} for{' '}
                    <strong>{selectedTables.size}</strong> table{selectedTables.size !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="px-4 md:px-8 py-4 md:py-5 border-b border-[#EBEBEB] flex-shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#404040]">Database Connections</h1>
            <p className="text-gray-400 text-xs mt-0.5">
              Connect external MySQL databases — credentials are AES-256-GCM encrypted
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-4xl">
        {/* ── Connection Form ── */}
        <div className="bg-white border border-[#EBEBEB] rounded-xl p-6 shadow-sm">
          <SectionHeading>Add New Connection</SectionHeading>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Connection Name */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Connection Label <span className="text-gray-300">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Paysprint UAT"
                value={form.name ?? ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#EBEBEB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>

            {/* Host */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                DB Host <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="hostname or IP"
                value={form.host}
                onChange={(e) => handleChange('host', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#EBEBEB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>

            {/* Port */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Port <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                placeholder="3306"
                value={form.port}
                onChange={(e) => handleChange('port', parseInt(e.target.value, 10) || 3306)}
                className="w-full px-3 py-2 text-sm border border-[#EBEBEB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>

            {/* Database */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Database Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="my_database"
                value={form.database}
                onChange={(e) => handleChange('database', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#EBEBEB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Username <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="readonly_user"
                value={form.username}
                onChange={(e) => handleChange('username', e.target.value)}
                autoComplete="off"
                className="w-full px-3 py-2 text-sm border border-[#EBEBEB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>

            {/* Password */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Password <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 pr-10 text-sm border border-[#EBEBEB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* SSL Toggle */}
            <div className="sm:col-span-2 flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.ssl}
                onClick={() => handleChange('ssl', !form.ssl)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  form.ssl ? 'bg-blue-500' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    form.ssl ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm text-gray-600">
                SSL / TLS Encryption
                {form.ssl && <span className="ml-2 text-xs text-blue-500">enabled</span>}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <button
              onClick={handleTest}
              disabled={!isFormValid || testing}
              className="px-4 py-2 rounded-lg border border-[#EBEBEB] text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Testing…
                </span>
              ) : 'Test Connection'}
            </button>

            <button
              onClick={handleOpenConnectPicker}
              disabled={!isFormValid || connecting || testResult?.success === false}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-blue-200"
            >
              {connecting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Connecting…
                </span>
              ) : 'Connect & Generate Tools'}
            </button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
              testResult.success
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {testResult.success ? (
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Connection successful
                  </div>
                  <div className="text-xs text-emerald-600 space-x-4">
                    <span>Latency: <strong>{testResult.latencyMs}ms</strong></span>
                    {testResult.serverVersion && <span>Server: <strong>{testResult.serverVersion}</strong></span>}
                    {testResult.tablesFound !== undefined && <span>Tables: <strong>{testResult.tablesFound}</strong></span>}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>{testResult.error ?? 'Connection failed'}</span>
                </div>
              )}
            </div>
          )}

          {/* Connect Result */}
          {connectResult && (
            <div className="mt-4 rounded-lg border bg-blue-50 border-blue-200 px-4 py-4 text-sm">
              <div className="font-semibold text-blue-700 flex items-center gap-2 mb-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Database connected — tools generated!
              </div>
              <div className="text-xs text-blue-600 space-y-1">
                <div>Connection ID: <code className="font-mono bg-blue-100 px-1 py-0.5 rounded">{connectResult.connectionId}</code></div>
                <div>Database: <strong>{connectResult.database}</strong> on <strong>{connectResult.host}:{connectResult.port}</strong></div>
                {connectResult.connectionTest.serverVersion && (
                  <div>MySQL: <strong>{connectResult.connectionTest.serverVersion}</strong></div>
                )}
              </div>
              {connectResult.toolSummary && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-blue-700 mb-1">
                    {connectResult.toolSummary.toolsGenerated.length} tools generated from {connectResult.toolSummary.tablesDiscovered.length} tables:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {connectResult.toolSummary.toolsGenerated.map((t) => (
                      <Badge key={t} label={t} color="bg-blue-100 text-blue-700" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-lg border bg-red-50 border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* ── Stored Connections ── */}
        <div>
          <SectionHeading>Stored Connections</SectionHeading>

          {loadingConnections ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Loading connections…
            </div>
          ) : connections.length === 0 ? (
            <div className="bg-white border border-dashed border-[#EBEBEB] rounded-xl p-8 text-center text-gray-400">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              <p className="text-sm">No connections yet. Add one above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((conn) => (
                <div key={conn.id} className="bg-white border border-[#EBEBEB] rounded-xl px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[#404040] text-sm truncate">{conn.name}</span>
                        {conn.isMain && (
                          <Badge label="Main DB" color="bg-amber-100 text-amber-700" />
                        )}
                        {conn.ssl && <Badge label="SSL" color="bg-emerald-100 text-emerald-700" />}
                      </div>
                      <div className="mt-1 text-xs text-gray-400 space-x-3">
                        <span><strong className="text-gray-500">{conn.database}</strong> @ {conn.host}:{conn.port}</span>
                        <span>Added {new Date(conn.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="mt-1">
                        <code className="text-xs text-gray-300 font-mono">{conn.id}</code>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => void handleOpenRefreshPicker(conn.id)}
                        disabled={refreshingId === conn.id || loadingSchema}
                        title="Re-generate MCP tools"
                        className="px-3 py-1.5 text-xs rounded-lg border border-[#EBEBEB] text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      >
                        {refreshingId === conn.id || loadingSchema ? (
                          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        ) : 'Refresh Tools'}
                      </button>
                      <button
                        onClick={() => handleRemove(conn.id)}
                        disabled={removingId === conn.id || conn.isMain}
                        title={conn.isMain ? 'Main application database — cannot be removed' : 'Remove connection'}
                        className="px-3 py-1.5 text-xs rounded-lg border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {removingId === conn.id ? 'Removing…' : conn.isMain ? (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            Protected
                          </span>
                        ) : 'Remove'}
                      </button>
                    </div>
                  </div>

                  {/* Refresh result inline */}
                  {refreshResult?.id === conn.id && (
                    <div className="mt-3 pt-3 border-t border-[#EBEBEB]">
                      <div className="text-xs text-emerald-600 font-medium mb-1">
                        ✓ {refreshResult.tools.length} tool{refreshResult.tools.length !== 1 ? 's' : ''} refreshed
                        across {refreshResult.tables.length} table{refreshResult.tables.length !== 1 ? 's' : ''}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {refreshResult.tools.map((t) => (
                          <Badge key={t} label={t} color="bg-emerald-50 text-emerald-600" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Security Notice ── */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-xs text-amber-700 space-y-1">
          <div className="font-semibold text-amber-800">Security</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Credentials are encrypted with AES-256-GCM before storage</li>
            <li>Only <strong>readonly</strong> SELECT queries are permitted via generated tools</li>
            <li>No raw SQL is exposed — all access is through parameterised MCP tools</li>
            <li>Connections are stored in Redis with a 30-day TTL</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

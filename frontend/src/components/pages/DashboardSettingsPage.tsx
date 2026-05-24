import { useState, useEffect, useMemo } from 'react';
import {
  listDashboardWidgets,
  saveDashboardWidget,
  fetchDashboardWidgetData,
  fetchTools,
  type DashboardWidgetConfig,
  type DashboardWidgetData,
} from '../../api/client';
import type { ToolDefinition } from '../../types';

interface Props {
  token: string;
}

interface EditState {
  display_label: string;
  tool_name: string;
  args_text: string;
  count_args_text: string;
  column_map_text: string;
  description: string;
  enabled: boolean;
}

function widgetToEdit(w: DashboardWidgetConfig): EditState {
  return {
    display_label: w.display_label,
    tool_name: w.tool_name,
    args_text: JSON.stringify(w.args, null, 2),
    count_args_text: w.count_args ? JSON.stringify(w.count_args, null, 2) : '',
    column_map_text: w.column_map ? JSON.stringify(w.column_map, null, 2) : '',
    description: w.description ?? '',
    enabled: w.enabled,
  };
}

function parseJsonField(text: string, label: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Invalid JSON in "${label}": ${(err as Error).message}`);
  }
}

export function DashboardSettingsPage({ token }: Props) {
  const [widgets, setWidgets] = useState<DashboardWidgetConfig[]>([]);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DashboardWidgetData | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const queryTools = useMemo(
    () => tools.filter((t) => t.name.startsWith('query_')).sort((a, b) => a.name.localeCompare(b.name)),
    [tools],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, t] = await Promise.all([
        listDashboardWidgets(token),
        fetchTools(token),
      ]);
      setWidgets(w.widgets);
      setTools(t.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const startEdit = (widget: DashboardWidgetConfig) => {
    setEditingKey(widget.widget_key);
    setEditState(widgetToEdit(widget));
    setEditError(null);
    setPreview(null);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditState(null);
    setEditError(null);
    setPreview(null);
  };

  const save = async () => {
    if (!editingKey || !editState) return;
    setSaving(true);
    setEditError(null);
    try {
      const args = parseJsonField(editState.args_text, 'args');
      if (!args || typeof args !== 'object') throw new Error('"args" must be a JSON object');
      const count_args = parseJsonField(editState.count_args_text, 'count_args');
      const column_map = parseJsonField(editState.column_map_text, 'column_map');

      const updated = await saveDashboardWidget(
        editingKey,
        {
          display_label: editState.display_label,
          tool_name: editState.tool_name,
          args: args as Record<string, unknown>,
          count_args: count_args as Record<string, unknown> | null,
          column_map: column_map as Record<string, string> | null,
          description: editState.description || null,
          enabled: editState.enabled,
        },
        token,
      );
      setWidgets((prev) => prev.map((w) => (w.widget_key === updated.widget_key ? updated : w)));
      cancelEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async (key: string) => {
    setPreviewing(true);
    setPreview(null);
    try {
      const data = await fetchDashboardWidgetData(key, token);
      setPreview(data);
    } catch (err) {
      setPreview({
        widget_key: key,
        display_label: '',
        tool_name: '',
        rows: [],
        count: null,
        raw: null,
        error: err instanceof Error ? err.message : 'Preview failed',
      });
    } finally {
      setPreviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full bg-[#FAFAFA] flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading widgets…</div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAFA]">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a] tracking-tight">Dashboard Sources</h1>
            <p className="text-gray-400 text-sm mt-1">
              Map each dashboard widget to a dynamic query tool. Changes apply on the next dashboard refresh.
            </p>
          </div>
          <button
            onClick={load}
            className="px-4 py-2 bg-white border border-[#E0E0E0] rounded-xl text-sm font-medium text-gray-500 hover:border-brand/30 hover:bg-brand-50 shadow-sm"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-red-700">{error}</p>
          </div>
        )}

        {/* Widget list */}
        <div className="space-y-3">
          {widgets.length === 0 && !loading && (
            <div className="bg-white border border-[#EBEBEB] rounded-2xl p-8 text-center text-sm text-gray-400">
              No widgets configured yet. Restart the server to seed defaults.
            </div>
          )}

          {widgets.map((w) => (
            <div
              key={w.widget_key}
              className="bg-white border border-[#EBEBEB] rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-[#1a1a1a]">{w.display_label}</h2>
                    <span className="text-[10px] font-mono text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded">
                      {w.widget_key}
                    </span>
                    {!w.enabled && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">
                        DISABLED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Tool: <span className="font-mono text-gray-500">{w.tool_name}</span>
                  </p>
                  {w.description && <p className="text-xs text-gray-400 mt-1">{w.description}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => void runPreview(w.widget_key)}
                    disabled={previewing}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    {previewing && preview === null ? 'Loading…' : 'Preview'}
                  </button>
                  <button
                    onClick={() => startEdit(w)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand/90"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* Editor panel */}
              {editingKey === w.widget_key && editState && (
                <div className="px-6 py-5 bg-[#FAFAFA] space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Display label
                      </label>
                      <input
                        type="text"
                        value={editState.display_label}
                        onChange={(e) => setEditState({ ...editState, display_label: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Tool
                      </label>
                      <select
                        value={editState.tool_name}
                        onChange={(e) => setEditState({ ...editState, tool_name: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand bg-white"
                      >
                        {queryTools.length === 0 && (
                          <option value={editState.tool_name}>{editState.tool_name}</option>
                        )}
                        {queryTools.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                        {!queryTools.some((t) => t.name === editState.tool_name) && editState.tool_name && (
                          <option value={editState.tool_name}>
                            {editState.tool_name} (not registered)
                          </option>
                        )}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      Description (optional)
                    </label>
                    <input
                      type="text"
                      value={editState.description}
                      onChange={(e) => setEditState({ ...editState, description: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      args (JSON) — passed to the tool to fetch rows
                    </label>
                    <textarea
                      rows={6}
                      value={editState.args_text}
                      onChange={(e) => setEditState({ ...editState, args_text: e.target.value })}
                      spellCheck={false}
                      className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:border-brand"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      Example: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{'{"filters":{"status":4},"orderBy":"id","orderDir":"DESC","limit":5}'}</code>
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      count_args (JSON, optional) — secondary call for an exact aggregate count
                    </label>
                    <textarea
                      rows={4}
                      value={editState.count_args_text}
                      onChange={(e) => setEditState({ ...editState, count_args_text: e.target.value })}
                      spellCheck={false}
                      placeholder='{"filters":{"status":4},"aggregate":{"count":true}}'
                      className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:border-brand"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      column_map (JSON, optional) — rename result columns to canonical UI keys
                    </label>
                    <textarea
                      rows={4}
                      value={editState.column_map_text}
                      onChange={(e) => setEditState({ ...editState, column_map_text: e.target.value })}
                      spellCheck={false}
                      placeholder='{"id":"id","amount":"amount","status":"status","created_at":"addeddate","bank_code":"bankname"}'
                      className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:border-brand"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      Canonical UI keys: <code>id</code>, <code>amount</code>, <code>status</code>, <code>created_at</code>, <code>bank_code</code>. Values are the DB column names in the selected tool's table.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={editState.enabled}
                        onChange={(e) => setEditState({ ...editState, enabled: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                      Enabled
                    </label>
                  </div>

                  {editError && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      {editError}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => void save()}
                      disabled={saving}
                      className="px-4 py-2 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand/90 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={saving}
                      className="px-4 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Preview panel */}
              {preview && preview.widget_key === w.widget_key && (
                <div className="px-6 py-5 bg-[#FAFAFA] border-t border-[#F0F0F0]">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Preview</h3>
                    <button
                      onClick={() => setPreview(null)}
                      className="text-[11px] text-gray-400 hover:text-gray-600"
                    >
                      Close
                    </button>
                  </div>
                  {preview.error ? (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      {preview.error}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-gray-400">
                          Rows: <span className="font-bold text-[#1a1a1a]">{preview.rows.length}</span>
                        </span>
                        {preview.count !== null && (
                          <span className="text-gray-400">
                            Aggregate count: <span className="font-bold text-[#1a1a1a]">{preview.count}</span>
                          </span>
                        )}
                      </div>
                      <pre className="text-[11px] font-mono bg-white border border-gray-100 rounded-lg p-3 overflow-x-auto max-h-64">
                        {JSON.stringify(preview.rows.slice(0, 3), null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

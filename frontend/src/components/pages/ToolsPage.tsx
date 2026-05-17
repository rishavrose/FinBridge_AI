import { useState, useEffect } from 'react';
import { fetchTools, executeTool, deleteTool } from '../../api/client';
import type { ToolDefinition, ToolExecuteResult } from '../../types';

interface ToolsPageProps {
  token: string;
}

function ArgInput({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: { type: string; description?: string; enum?: string[] };
  value: string;
  onChange: (v: string) => void;
}) {
  if (schema.enum) {
    return (
      <div>
        <label className="block text-xs font-medium text-[#404040] mb-1">{name}</label>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">— any —</option>
          {schema.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        {schema.description && <p className="text-[11px] text-gray-400 mt-1">{schema.description}</p>}
      </div>
    );
  }
  return (
    <div>
      <label className="block text-xs font-medium text-[#404040] mb-1">{name}</label>
      <input
        type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={schema.description ?? schema.type}
        className="w-full bg-gray-50 border border-[#EBEBEB] text-[#404040] rounded-lg px-3 py-2 text-sm
                   placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      {schema.description && <p className="text-[11px] text-gray-400 mt-1">{schema.description}</p>}
    </div>
  );
}

const ROLE_COLOR: Record<string, string> = {
  admin:    'text-purple-600 bg-purple-50 border-purple-200',
  service:  'text-blue-600 bg-blue-50 border-blue-200',
  analyst:  'text-emerald-600 bg-emerald-50 border-emerald-200',
  readonly: 'text-gray-500 bg-gray-100 border-gray-200',
};

export function ToolsPage({ token }: ToolsPageProps) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ToolDefinition | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolExecuteResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showToolList, setShowToolList] = useState(false);

  const loadTools = (silent = false) => {
    if (!silent) setLoading(true);
    fetchTools(token)
      .then(res => setTools(res.tools))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTools(); }, [token]);

  const selectTool = (tool: ToolDefinition) => {
    setSelected(tool);
    setShowToolList(false);
    setArgs({});
    setResult(null);
    setExecError(null);
  };

  const run = async () => {
    if (!selected) return;
    setExecuting(true);
    setResult(null);
    setExecError(null);

    const typedArgs: Record<string, unknown> = {};
    const props = selected.inputSchema.properties ?? {};
    for (const [k, v] of Object.entries(args)) {
      if (v === '') continue;
      const prop = props[k];
      if (prop?.type === 'number' || prop?.type === 'integer') {
        typedArgs[k] = Number(v);
      } else {
        typedArgs[k] = v;
      }
    }

    try {
      const res = await executeTool(selected.name, typedArgs, token);
      setResult(res);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setExecuting(false);
    }
  };

  const filteredTools = tools.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase()),
  );

  const clearResult = () => {
    setResult(null);
    setExecError(null);
    setArgs({});
  };

  const handleDeleteTool = async () => {
    if (!selected || !window.confirm(`Delete tool "${selected.name}"?`)) return;

    try {
      await deleteTool(selected.name, token);
      setTools(tools.filter(t => t.name !== selected.name));
      setSelected(null);
      setResult(null);
      setExecError(null);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="flex h-full relative">
      {/* Mobile overlay backdrop */}
      {showToolList && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setShowToolList(false)}
        />
      )}

      {/* Tool list sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-30
        w-72 flex-shrink-0 border-r border-[#EBEBEB] bg-white flex flex-col
        transition-transform duration-200 ease-in-out
        ${showToolList ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="px-5 py-5 border-b border-[#EBEBEB]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-[#404040]">Tool Runner</h1>
              <p className="text-gray-400 text-xs mt-1">{tools.length} tool{tools.length !== 1 ? 's' : ''} available</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadTools(true)}
                title="Refresh tool list"
                className="p-1.5 rounded-lg text-gray-400 hover:text-brand hover:bg-gray-50 transition-colors"
                aria-label="Refresh tools"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => setShowToolList(false)}
                className="md:hidden p-1 rounded-lg text-gray-400 hover:text-brand"
                aria-label="Close tools"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="mt-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tools…"
              className="w-full bg-gray-50 border border-[#EBEBEB] text-sm text-[#404040] rounded-lg px-3 py-2
                         placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">Loading tools…</div>
          )}
          {!loading && filteredTools.length === 0 && (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">No tools found</div>
          )}
          {filteredTools.map(tool => (
            <button
              key={tool.name}
              onClick={() => selectTool(tool)}
              className={`w-full text-left px-5 py-4 border-b border-[#EBEBEB] transition-colors ${
                selected?.name === tool.name
                  ? 'bg-brand-50 border-l-2 border-l-brand'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className={`text-sm font-mono font-semibold truncate ${selected?.name === tool.name ? 'text-brand' : 'text-[#404040]'}`}>
                {tool.name}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{tool.description}</div>
              <div className="flex gap-1 mt-2">
                {tool.permissions.slice(0, 1).map(p => (
                  <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded border ${ROLE_COLOR[p] ?? ROLE_COLOR.readonly}`}>
                    {p}+
                  </span>
                ))}
                {tool.cacheTtl ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border text-gray-400 border-gray-200">
                    cache {tool.cacheTtl}s
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-[#EBEBEB] text-xs text-gray-400">
          {tools.length} tools registered
        </div>
      </aside>

      {/* Tool detail + runner */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-center text-gray-400">
            <div>
              <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-sm hidden md:block">Select a tool from the left panel</p>
              <p className="text-sm md:hidden">Choose a tool to get started</p>
              <button
                onClick={() => setShowToolList(true)}
                className="md:hidden mt-4 px-5 py-2.5 bg-brand text-white rounded-xl text-sm font-medium shadow-sm shadow-brand/20"
              >
                Browse Tools
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 md:p-8 space-y-6 max-w-3xl">
            {/* Mobile back button */}
            <button
              onClick={() => setShowToolList(true)}
              className="md:hidden flex items-center gap-1.5 text-sm text-brand font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              All Tools
            </button>
            {/* Tool header */}
            <div>
              <h2 className="text-xl font-bold text-[#404040] font-mono">{selected.name}</h2>
              <p className="text-gray-500 mt-2 text-sm leading-relaxed">{selected.description}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="text-xs text-gray-400">Requires:</span>
                {selected.permissions.map(p => (
                  <span key={p} className={`text-xs px-2 py-0.5 rounded border ${ROLE_COLOR[p] ?? ROLE_COLOR.readonly}`}>{p}</span>
                ))}
                {selected.tags?.map(tag => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded border text-gray-400 border-gray-200">{tag}</span>
                ))}
              </div>
            </div>

            {/* Args form */}
            {Object.keys(selected.inputSchema.properties ?? {}).length > 0 && (
              <div className="bg-white border border-[#EBEBEB] rounded-xl p-6 space-y-4 shadow-sm">
                <h3 className="text-sm font-semibold text-[#404040]">Parameters</h3>
                {Object.entries(selected.inputSchema.properties ?? {}).map(([name, prop]) => (
                  <ArgInput
                    key={name}
                    name={name}
                    schema={prop}
                    value={args[name] ?? ''}
                    onChange={v => setArgs(prev => ({ ...prev, [name]: v }))}
                  />
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={run}
                disabled={executing}
                className="flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-400
                           text-white rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-brand/20"
              >
                {executing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Executing…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Execute Tool
                  </>
                )}
              </button>

              {result && (
                <button
                  onClick={clearResult}
                  className="flex items-center gap-2 px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700
                             rounded-xl text-sm font-semibold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear Result
                </button>
              )}

              {selected && (
                <button
                  onClick={handleDeleteTool}
                  className="flex items-center gap-2 px-6 py-3 bg-red-100 hover:bg-red-200 text-red-700
                             rounded-xl text-sm font-semibold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Tool
                </button>
              )}
            </div>

            {/* Error */}
            {execError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-600">
                {execError}
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span>Executed in <span className="text-[#404040] font-semibold">{result.executionMs}ms</span></span>
                  {result.cached && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-600">
                      ⚡ cached result
                    </span>
                  )}
                  {result.rowCount != null && (
                    <span><span className="text-[#404040] font-semibold">{result.rowCount}</span> rows</span>
                  )}
                </div>
                <div className="bg-white border border-[#EBEBEB] rounded-xl overflow-hidden shadow-sm">
                  <div className="px-4 py-2 border-b border-[#EBEBEB] bg-gray-50 flex items-center">
                    <span className="text-xs text-gray-400 font-mono">JSON response</span>
                  </div>
                  <pre className="px-5 py-4 text-xs text-emerald-700 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

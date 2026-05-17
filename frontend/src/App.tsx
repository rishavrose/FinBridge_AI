import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { DashboardPage } from './components/pages/DashboardPage';
import { ChatPage } from './components/pages/ChatPage';
import { ToolsPage } from './components/pages/ToolsPage';
import { McpPage } from './components/pages/McpPage';
import { KeysPage } from './components/pages/KeysPage';
import { DbConnectionPage } from './components/pages/DbConnectionPage';
import { AiMemoryPage } from './components/pages/AiMemoryPage';
import { AnalyticsDashboard } from './components/pages/AnalyticsDashboard';
import { UsersPage } from './components/pages/UsersPage';
import { AiRateLimitPage } from './components/pages/AiRateLimitPage';

type Page = 'dashboard' | 'chat' | 'tools' | 'mcp' | 'keys' | 'db' | 'ai-memory' | 'analytics' | 'users' | 'ai-rate-limit';

export default function App() {
  const { token, claims, loading, error, login, logout } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  if (!token || !claims) {
    return (
      <Login
        onLogin={login}
        loading={loading}
        error={error}
      />
    );
  }

  return (
    <Layout
      claims={claims}
      activePage={page}
      onNavigate={setPage}
      onLogout={logout}
    >
      {page === 'dashboard' && <DashboardPage token={token} />}
      {page === 'chat'      && <ChatPage token={token} />}
      {page === 'tools'     && <ToolsPage token={token} />}
      {page === 'mcp'       && <McpPage token={token} />}
      {page === 'db'        && claims.role === 'admin' && <DbConnectionPage token={token} />}
      {page === 'db'        && claims.role !== 'admin' && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium">Admin access required</p>
            <p className="text-xs mt-1">Database Connections is only available to admin role users.</p>
          </div>
        </div>
      )}
      {page === 'keys'      && claims.role === 'admin' && <KeysPage token={token} />}
      {page === 'keys'      && claims.role !== 'admin' && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium">Admin access required</p>
            <p className="text-xs mt-1">Key Management is only available to admin role users.</p>
          </div>
        </div>
      )}
      {page === 'ai-memory' && claims.role === 'admin' && <AiMemoryPage token={token} />}
      {page === 'ai-memory' && claims.role !== 'admin' && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium">Admin access required</p>
            <p className="text-xs mt-1">AI Memory Dashboard is only available to admin role users.</p>
          </div>
        </div>
      )}
      {page === 'ai-rate-limit' && claims.role === 'admin' && <AiRateLimitPage token={token} />}
      {page === 'ai-rate-limit' && claims.role !== 'admin' && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium">Admin access required</p>
            <p className="text-xs mt-1">AI Rate Limiting is only available to admin role users.</p>
          </div>
        </div>
      )}
      {page === 'analytics' && <AnalyticsDashboard token={token} />}
      {page === 'users'     && claims.role === 'admin' && <UsersPage token={token} />}
      {page === 'users'     && claims.role !== 'admin' && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium">Admin access required</p>
          </div>
        </div>
      )}
    </Layout>
  );
}

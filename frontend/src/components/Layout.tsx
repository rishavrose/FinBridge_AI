import { useState } from 'react';
import type { JwtClaims } from '../types';

type Page = 'dashboard' | 'chat' | 'tools' | 'mcp' | 'keys' | 'db' | 'ai-memory' | 'analytics' | 'users' | 'ai-rate-limit' | 'dashboard-settings';

interface LayoutProps {
  claims: JwtClaims;
  activePage: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

interface NavItem {
  id: Page;
  label: string;
  adminOnly?: boolean;
  badge?: number;
  icon: React.ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const ROLE_COLORS: Record<string, string> = {
  admin:    'bg-purple-100 text-purple-700 border-purple-200',
  service:  'bg-blue-100 text-blue-700 border-blue-200',
  analyst:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  readonly: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function Layout({ claims, activePage, onNavigate, onLogout, children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNavigate = (page: Page) => {
    onNavigate(page);
    setSidebarOpen(false);
  };

  const NAV_SECTIONS: NavSection[] = [
    {
      title: 'MAIN',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          ),
        },
        {
          id: 'chat',
          label: 'AI Chat',
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          ),
        },
        {
          id: 'tools',
          label: 'MCP Tools',
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ),
        },
        {
          id: 'analytics',
          label: 'Analytics',
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          ),
        },
        {
          id: 'ai-rate-limit' as Page,
          label: 'Alerts',
          badge: 0,
          adminOnly: true,
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          ),
        },
      ],
    },
    {
      title: 'ADMIN',
      items: [
        {
          id: 'db',
          label: 'Database',
          adminOnly: true,
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
            </svg>
          ),
        },
        {
          id: 'mcp',
          label: 'MCP Console',
          adminOnly: true,
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ),
        },
        {
          id: 'users',
          label: 'User Management',
          adminOnly: true,
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          ),
        },
        {
          id: 'ai-memory',
          label: 'Audit Logs',
          adminOnly: true,
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          ),
        },
        {
          id: 'dashboard-settings',
          label: 'System Settings',
          adminOnly: true,
          icon: (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ),
        },
      ],
    },
  ];

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[#EBEBEB] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center flex-shrink-0 shadow-md shadow-brand/30">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-[#1a1a2e]">FinBridge AI</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Operations Intelligence</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto md:hidden text-gray-400 hover:text-gray-600 p-1 rounded-lg"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New Chat button */}
        <button
          onClick={() => { handleNavigate('chat'); }}
          className="mt-4 w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl
                     bg-brand text-white text-sm font-semibold
                     hover:bg-brand/90 transition-all shadow-sm shadow-brand/20"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-1">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(
            item => !item.adminOnly || claims.role === 'admin',
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title} className="mb-2">
              <p className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {section.title}
              </p>
              {visibleItems.map((item, idx) => {
                const isNavActive = activePage === item.id;

                return (
                  <button
                    key={`${section.title}-${idx}`}
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all mb-0.5
                      ${isNavActive && section.title === 'MAIN'
                        ? 'bg-brand/8 text-brand font-semibold'
                        : 'text-gray-500 hover:text-[#1a1a2e] hover:bg-gray-50'
                      }`}
                  >
                    <span className={`flex-shrink-0 w-[18px] h-[18px] ${isNavActive && section.title === 'MAIN' ? 'text-brand' : ''}`}>
                      {item.icon}
                    </span>
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 ? (
                      <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
                        {item.badge}
                      </span>
                    ) : isNavActive && section.title === 'MAIN' ? (
                      <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User / Logout */}
      <div className="px-3 pt-2 pb-2 border-t border-[#EBEBEB] flex-shrink-0">
        <div className="px-3 py-2 mb-1">
          <div className="text-sm font-semibold text-[#1a1a2e] truncate">{claims.name ?? claims.sub}</div>
          <div className="text-[11px] text-gray-400 font-mono truncate mt-0.5">{claims.sub.slice(0, 8)}…</div>
          <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ROLE_COLORS[claims.role] ?? ROLE_COLORS.readonly}`}>
            {claims.role}
          </span>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-400 hover:text-brand hover:bg-brand/5 transition-all"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>

      {/* All Systems Operational footer */}
      <div className="px-5 py-3 border-t border-[#EBEBEB] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-[#1a1a2e]">All Systems Operational</p>
            <p className="text-[10px] text-gray-400">Last updated 2 sec ago</p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-30
          w-[220px] flex-shrink-0 bg-white border-r border-[#EBEBEB] flex flex-col
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 bg-brand border-b border-brand/20 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-white font-bold text-sm">FinBridge AI</span>
          <span className="ml-auto text-white/70 text-xs capitalize">{activePage}</span>
        </div>

        <main className="flex-1 overflow-y-auto bg-[#F7F8FA]">
          {children}
        </main>
      </div>
    </div>
  );
}

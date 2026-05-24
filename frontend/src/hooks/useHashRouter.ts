import { useState, useEffect, useCallback } from 'react';

export type Page =
  | 'dashboard'
  | 'chat'
  | 'tools'
  | 'mcp'
  | 'keys'
  | 'db'
  | 'ai-memory'
  | 'analytics'
  | 'users'
  | 'ai-rate-limit'
  | 'dashboard-settings';

const VALID_PAGES = new Set<Page>([
  'dashboard', 'chat', 'tools', 'mcp', 'keys',
  'db', 'ai-memory', 'analytics', 'users', 'ai-rate-limit',
  'dashboard-settings',
]);

function getPageFromHash(): Page {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return VALID_PAGES.has(raw as Page) ? (raw as Page) : 'dashboard';
}

export function useHashRouter() {
  const [page, setPageState] = useState<Page>(getPageFromHash);

  useEffect(() => {
    const onHashChange = () => setPageState(getPageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setPage = useCallback((newPage: Page) => {
    window.location.hash = `/${newPage}`;
  }, []);

  return { page, setPage };
}

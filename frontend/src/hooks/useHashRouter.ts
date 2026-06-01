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

const LAST_PAGE_KEY = 'finbridge_last_page';

function getPageFromHash(): Page {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (VALID_PAGES.has(raw as Page)) return raw as Page;

  // Feature 3: if no hash, restore the last active page from localStorage
  // so a page refresh returns to where the user was (especially chat).
  const stored = localStorage.getItem(LAST_PAGE_KEY) as Page | null;
  if (stored && VALID_PAGES.has(stored)) {
    // Restore the hash without triggering a reload
    window.location.replace(`#/${stored}`);
    return stored;
  }

  return 'dashboard';
}

export function useHashRouter() {
  const [page, setPageState] = useState<Page>(getPageFromHash);

  useEffect(() => {
    const onHashChange = () => {
      const newPage = getPageFromHash();
      setPageState(newPage);
      localStorage.setItem(LAST_PAGE_KEY, newPage);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const setPage = useCallback((newPage: Page) => {
    localStorage.setItem(LAST_PAGE_KEY, newPage);
    window.location.hash = `/${newPage}`;
  }, []);

  return { page, setPage };
}

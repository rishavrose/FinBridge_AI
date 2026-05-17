import { useState, useCallback } from 'react';
import type { JwtClaims } from '../types';
import { loginWithPassword } from '../api/client';

const TOKEN_KEY = 'finbridge_jwt';

function parseJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload)) as JwtClaims;
  } catch {
    return null;
  }
}

function isExpired(claims: JwtClaims): boolean {
  return Date.now() / 1000 > claims.exp;
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    const claims = parseJwt(stored);
    if (!claims || isExpired(claims)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return stored;
  });

  const [claims, setClaims] = useState<JwtClaims | null>(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    const c = parseJwt(stored);
    if (!c || isExpired(c)) return null;
    return c;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await loginWithPassword(username, password);
      const parsed = parseJwt(res.token);
      localStorage.setItem(TOKEN_KEY, res.token);
      setToken(res.token);
      setClaims(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setClaims(null);
  }, []);

  return { token, claims, loading, error, login, logout };
}

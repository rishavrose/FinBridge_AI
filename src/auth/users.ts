/**
 * User management — DB-backed user store with bcrypt password hashing.
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { executeSelect, executeWrite } from '../database/client.js';
import type { Role } from '../types/index.js';

const BCRYPT_ROUNDS = 12;

export interface AppUser {
  id: string;
  username: string;
  full_name: string | null;
  role: Role;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AppUserRow extends AppUser {
  password_hash: string;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function findUserByUsername(username: string): Promise<AppUserRow | null> {
  const rows = await executeSelect<AppUserRow>(
    'SELECT * FROM app_users WHERE username = ? AND is_active = 1',
    [username],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const rows = await executeSelect<AppUser>(
    'SELECT id, username, full_name, role, is_active, created_by, created_at, updated_at FROM app_users WHERE id = ?',
    [id],
  );
  return rows[0] ?? null;
}

export async function listUsers(): Promise<AppUser[]> {
  return executeSelect<AppUser>(
    'SELECT id, username, full_name, role, is_active, created_by, created_at, updated_at FROM app_users ORDER BY created_at DESC',
    [],
  );
}

export async function countAdmins(): Promise<number> {
  const rows = await executeSelect<{ c: number }>(
    "SELECT COUNT(*) as c FROM app_users WHERE role = 'admin' AND is_active = 1",
    [],
  );
  return rows[0]?.c ?? 0;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createUser(params: {
  username: string;
  password: string;
  fullName?: string;
  role: Role;
  createdBy?: string;
}): Promise<AppUser> {
  const id = uuidv4();
  const hash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
  await executeWrite(
    'INSERT INTO app_users (id, username, password_hash, full_name, role, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [id, params.username, hash, params.fullName ?? null, params.role, params.createdBy ?? null],
  );
  const user = await findUserById(id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function updateUser(id: string, params: {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
  password?: string;
}): Promise<AppUser | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (params.fullName !== undefined) { sets.push('full_name = ?'); values.push(params.fullName); }
  if (params.role !== undefined)     { sets.push('role = ?');      values.push(params.role); }
  if (params.isActive !== undefined) { sets.push('is_active = ?'); values.push(params.isActive ? 1 : 0); }
  if (params.password) {
    const hash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
    sets.push('password_hash = ?');
    values.push(hash);
  }

  if (sets.length === 0) return findUserById(id);

  values.push(id);
  await executeWrite(
    `UPDATE app_users SET ${sets.join(', ')} WHERE id = ?`,
    values,
  );
  return findUserById(id);
}

export async function deleteUser(id: string): Promise<boolean> {
  const result = await executeWrite('DELETE FROM app_users WHERE id = ?', [id]);
  return (result as { affectedRows?: number }).affectedRows === 1;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function verifyPassword(username: string, password: string): Promise<AppUser | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Ensure at least one admin exists. Called at server startup.
 * Creates admin/admin123 if the table is empty.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  const count = await countAdmins();
  if (count > 0) return;

  await createUser({
    username: 'admin',
    password: 'admin123',
    fullName: 'Administrator',
    role: 'admin',
  });
}

import type { FastifyInstance } from 'fastify';
import { signJwt } from '../../auth/jwt.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../../auth/api-key.js';
import {
  verifyPassword, createUser, listUsers,
  updateUser, deleteUser, countAdmins,
} from '../../auth/users.js';
import { authenticateRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import type { Role } from '../../types/index.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /auth/login — DB-backed login ────────────────────────────────────
  fastify.post<{ Body: { username: string; password: string } }>('/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with username and password',
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;
    const user = await verifyPassword(username, password);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid username or password' });
    }
    const token = signJwt({ sub: user.id, role: user.role, name: user.full_name ?? user.username });
    return reply.send({ token, expiresIn: process.env['JWT_EXPIRES_IN'] ?? '24h', user: { id: user.id, username: user.username, role: user.role, fullName: user.full_name } });
  });

  // ── Keep legacy bootstrap endpoint for API/internal use ──────────────────
  fastify.post<{ Body: { userId: string; role: Role; name?: string; secret: string } }>('/auth/token', {
    schema: { tags: ['Auth'], summary: 'Issue JWT via bootstrap secret (internal/API use)' },
  }, async (request, reply) => {
    const { userId, role, name, secret } = request.body;
    if (secret !== process.env['BOOTSTRAP_SECRET']) {
      return reply.status(401).send({ error: 'Invalid bootstrap secret' });
    }
    const token = signJwt({ sub: userId, role, name });
    return reply.send({ token, expiresIn: process.env['JWT_EXPIRES_IN'] ?? '24h' });
  });

  // ── User management (admin only) ──────────────────────────────────────────

  fastify.get('/users', {
    schema: { tags: ['Auth'], summary: 'List all users (admin)', security: [{ bearerAuth: [] }] },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (_req, reply) => {
    const users = await listUsers();
    return reply.send({ users });
  });

  fastify.post<{
    Body: { username: string; password: string; fullName?: string; role: Role };
  }>('/users', {
    schema: {
      tags: ['Auth'],
      summary: 'Create a new user (admin)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['username', 'password', 'role'],
        properties: {
          username: { type: 'string', minLength: 2 },
          password: { type: 'string', minLength: 6 },
          fullName: { type: 'string' },
          role: { type: 'string', enum: ['readonly', 'analyst', 'service', 'admin'] },
        },
      },
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    try {
      const user = await createUser({
        username: request.body.username,
        password: request.body.password,
        fullName: request.body.fullName,
        role: request.body.role,
        createdBy: (request as any).user?.id,
      });
      return reply.status(201).send({ user });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('Duplicate') || msg.includes('UNIQUE')) {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
  });

  fastify.patch<{
    Params: { id: string };
    Body: { fullName?: string; role?: Role; isActive?: boolean; password?: string };
  }>('/users/:id', {
    schema: {
      tags: ['Auth'],
      summary: 'Update a user (admin)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          role: { type: 'string', enum: ['readonly', 'analyst', 'service', 'admin'] },
          isActive: { type: 'boolean' },
          password: { type: 'string', minLength: 6 },
        },
      },
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    // Prevent deactivating the last admin
    if (request.body.isActive === false || request.body.role) {
      const target = await import('../../auth/users.js').then(m => m.findUserById(request.params.id));
      if (target?.role === 'admin' && request.body.isActive === false) {
        const adminCount = await countAdmins();
        if (adminCount <= 1) return reply.status(400).send({ error: 'Cannot deactivate the last admin' });
      }
    }
    const updated = await updateUser(request.params.id, request.body);
    if (!updated) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ user: updated });
  });

  fastify.delete<{ Params: { id: string } }>('/users/:id', {
    schema: {
      tags: ['Auth'],
      summary: 'Delete a user (admin)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const adminCount = await countAdmins();
    const target = await import('../../auth/users.js').then(m => m.findUserById(request.params.id));
    if (target?.role === 'admin' && adminCount <= 1) {
      return reply.status(400).send({ error: 'Cannot delete the last admin' });
    }
    const deleted = await deleteUser(request.params.id);
    if (!deleted) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ deleted: true });
  });

  // ── API key management (admin only) ──────────────────────────────────────
  fastify.post<{ Body: { name: string; role: Role; expiresInDays?: number } }>('/auth/api-keys', {
    schema: { tags: ['Auth'], summary: 'Create an API key (admin)', security: [{ bearerAuth: [] }] },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const { name, role, expiresInDays } = request.body;
    const { rawKey, record } = createApiKey(name, role, expiresInDays);
    return reply.status(201).send({ message: 'API key created. Store the rawKey — it will not be shown again.', rawKey, id: record.id, name: record.name, role: record.role, expiresAt: record.expiresAt });
  });

  fastify.get('/auth/api-keys', {
    schema: { tags: ['Auth'], summary: 'List API keys (admin)', security: [{ bearerAuth: [] }] },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async () => ({ apiKeys: listApiKeys() }));

  fastify.delete<{ Params: { id: string } }>('/auth/api-keys/:id', {
    schema: { tags: ['Auth'], summary: 'Revoke an API key (admin)', security: [{ bearerAuth: [] }] },
    preHandler: [authenticateRequest, requireRole('admin')],
  }, async (request, reply) => {
    const revoked = revokeApiKey(request.params.id);
    if (!revoked) return reply.status(404).send({ error: 'API key not found' });
    return reply.send({ message: 'API key revoked' });
  });
}

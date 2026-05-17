/**
 * Authentication middleware for Fastify.
 *
 * Supports two authentication strategies:
 *  1. Bearer JWT token  — Authorization: Bearer <jwt>
 *  2. API key           — X-API-Key: <rawKey>  OR  Authorization: ApiKey <rawKey>
 *
 * On success, attaches `request.user` with the caller's identity.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from '../auth/jwt.js';
import { validateApiKey } from '../auth/api-key.js';
import { AuthenticationError } from '../utils/errors.js';
import { auditAuthEvent } from '../audit/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type { Role } from '../types/index.js';

// ─── Fastify type augmentation ─────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      role: Role;
      name?: string;
    };
    requestId: string;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Attach a request ID for tracing
  (request as FastifyRequest & { requestId: string }).requestId =
    (request.headers['x-request-id'] as string) ?? uuidv4();

  const authHeader = request.headers.authorization;
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

  try {
    if (authHeader?.startsWith('Bearer ')) {
      // ── JWT path ──
      const token = authHeader.slice(7);
      const payload = verifyJwt(token);

      request.user = {
        id: payload.sub,
        role: payload.role,
        name: payload.name,
      };

      auditAuthEvent('auth.login', {
        actorId: payload.sub,
        actorRole: payload.role,
        requestId: request.requestId,
        ip: request.ip,
      });
      return;
    }

    if (authHeader?.startsWith('ApiKey ') || apiKeyHeader) {
      // ── API key path ──
      const rawKey = apiKeyHeader ?? (authHeader?.slice(7) ?? '');
      const record = await validateApiKey(rawKey);

      request.user = {
        id: record.id,
        role: record.role,
        name: record.name,
      };

      auditAuthEvent('auth.login', {
        actorId: record.id,
        actorRole: record.role,
        requestId: request.requestId,
        ip: request.ip,
      });
      return;
    }

    throw new AuthenticationError('No credentials provided. Use Bearer JWT or X-API-Key header.');
  } catch (err) {
    auditAuthEvent('auth.fail', {
      requestId: request.requestId,
      ip: request.ip,
    }, { reason: (err as Error).message });

    const status = err instanceof AuthenticationError ? 401 : 500;
    return reply.status(status).send({
      error: 'Authentication failed',
      message: (err as Error).message,
      code: 'AUTH_FAILED',
    });
  }
}

// ─── Optional auth (for public + protected routes on same path) ───────────────

export async function optionalAuthentication(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await authenticateRequest(request, _reply);
  } catch {
    // Non-authenticated requests get readonly access
    request.user = { id: 'anonymous', role: 'readonly' };
  }
}

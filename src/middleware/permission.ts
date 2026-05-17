/**
 * Permission middleware — checks that the authenticated user has the
 * required role before allowing a request to proceed.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { canExecuteTool } from '../auth/rbac.js';
import type { Role } from '../types/index.js';

/**
 * Factory that creates a route-level permission hook.
 * Usage:  fastify.addHook('preHandler', requireRole('admin'))
 */
export function requireRole(minRole: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: 'Unauthenticated' });
    }

    // Reuse the same role hierarchy used by RBAC
    const roleLevels: Record<Role, number> = {
      readonly: 1,
      analyst: 2,
      service: 3,
      admin: 4,
    };

    if (roleLevels[user.role] < roleLevels[minRole]) {
      return reply.status(403).send({
        error: 'Insufficient permissions',
        required: minRole,
        actual: user.role,
      });
    }
  };
}

/**
 * Hook that checks whether the user may execute a specific tool.
 * Reads the tool name from request.params.name.
 */
export async function checkToolPermission(
  request: FastifyRequest<{ Params: { name: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { name } = request.params;
  const user = request.user;

  if (!user) return reply.status(401).send({ error: 'Unauthenticated' });

  if (!canExecuteTool(name, user.role)) {
    return reply.status(403).send({
      error: 'Tool access denied',
      tool: name,
      role: user.role,
    });
  }
}

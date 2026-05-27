/**
 * Health check route.
 * Verifies database, Redis, and queue connectivity.
 */

import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../../database/client.js';
import { pingRedis } from '../../cache/client.js';
import { toolRegistry } from '../../mcp/registry.js';
import { env } from '../../config/env.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Liveness probe (always 200 if process is alive) ──
  fastify.get('/health/live', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness probe',
      response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
    },
  }, async () => ({ status: 'ok' }));

  // ── Readiness probe (checks all dependencies) ──
  fastify.get('/health/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness probe — checks DB, Redis, and queue connectivity',
    },
  }, async (_req, reply) => {
    const checks: Record<string, { status: 'ok' | 'error'; message?: string }> = {};
    let allOk = true;

    // Database
    try {
      await pingDatabase();
      checks.database = { status: 'ok' };
    } catch (err) {
      checks.database = { status: 'error', message: (err as Error).message };
      allOk = false;
    }

    // Redis
    try {
      await pingRedis();
      checks.redis = { status: 'ok' };
    } catch (err) {
      checks.redis = { status: 'error', message: (err as Error).message };
      allOk = false;
    }

    // MCP tools
    checks.tools = {
      status: 'ok',
      message: `${toolRegistry.getToolCount()} tools registered`,
    };

    const statusCode = allOk ? 200 : 503;
    return reply.status(statusCode).send({
      status: allOk ? 'ready' : 'not_ready',
      service: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // ── Info endpoint ──
  fastify.get('/health/info', {
    schema: { tags: ['Health'], summary: 'Service info' },
  }, async () => {
    const provider = env.AI_PROVIDER;
    const model = provider === 'nvidia' ? env.NVIDIA_MODEL : env.OPENAI_MODEL;
    const keyConfigured = provider === 'nvidia' ? !!env.NVIDIA_API_KEY : !!env.OPENAI_API_KEY;

    return {
      name: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
      environment: env.NODE_ENV,
      toolCount: toolRegistry.getToolCount(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      ai: {
        provider,
        model,
        keyConfigured,
      },
    };
  });
}

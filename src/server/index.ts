/**
 * Main Fastify application server.
 *
 * Startup sequence:
 *  1. Load and validate environment
 *  2. Register plugins (CORS, rate-limit, Swagger)
 *  3. Connect to MySQL and Redis
 *  4. Register static MCP tools
 *  5. Generate dynamic tools from DB schema
 *  6. Register all HTTP routes
 *  7. Start listening
 *  8. Wire graceful shutdown handlers
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { isAppError } from '../utils/errors.js';
import { pingDatabase, closePool } from '../database/client.js';
import { pingRedis, closeRedis, getRedisClient } from '../cache/client.js';
import { registerStaticTools } from '../tools/index.js';
import { ensureDefaultAdmin } from '../auth/users.js';
import { startWorkers, closeQueues } from '../queue/client.js';
import { startAnalyticsWorkers, stopAnalyticsWorkers } from '../workers/analytics.js';
import { initSocketIO } from '../realtime/socket.js';
import { listStoredConnections, generateToolsForConnection } from '../database/connection-manager.js';
import { toolRegistry } from '../mcp/registry.js';
import { ensureQdrantCollection } from '../ai/vector/client.js';
import { startAiLearningWorker, closeAiWorkers } from '../ai/workers/index.js';

// Routes
import { healthRoutes } from './routes/health.js';
import { mcpRoutes } from './routes/mcp.js';
import { toolRoutes } from './routes/tools.js';
import { authRoutes } from './routes/auth.js';
import { chatHistoryRoutes } from './routes/chat.js';
import { dbRoutes } from './routes/db.js';
import { aiChatRoutes } from './routes/ai-chat.js';
import { analyticsRoutes } from './routes/analytics.js';
import { alertRoutes } from './routes/alerts.js';
import { aiRateLimitRoutes } from './routes/ai-rate-limit.js';
import { dashboardWidgetRoutes } from './routes/dashboard-widgets.js';
import { ensureDashboardWidgetsTable } from '../dashboard/widgets.js';

// ─── Build server ─────────────────────────────────────────────────────────────

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.LOG_PRETTY
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    ajv: {
      customOptions: {
        strict: false,
        allErrors: true,
        coerceTypes: 'array',
      },
    },
  });

  // ── CORS ───────────────────────────────────────────────────────────────────
  const allowedOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map((o: string) => o.trim())
    : true;

  await fastify.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
    credentials: true,
  });

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  await fastify.register(rateLimit, {
    redis: getRedisClient(),
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string) ?? req.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Max ${env.RATE_LIMIT_MAX} requests per ${env.RATE_LIMIT_WINDOW_MS / 1000}s`,
    }),
  });

  // ── Swagger / OpenAPI docs ──────────────────────────────────────────────────
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'FinBridge MCP Server API',
        description: 'Production-grade MCP server platform for AI-powered database interactions',
        version: env.MCP_SERVER_VERSION,
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          apiKeyHeader: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
        },
      },
      tags: [
        { name: 'Health', description: 'Liveness and readiness probes' },
        { name: 'Auth', description: 'Authentication and API key management' },
        { name: 'Tools', description: 'MCP tool listing and execution' },
        { name: 'MCP', description: 'Model Context Protocol SSE endpoints' },
        { name: 'AI', description: 'OpenAI function-calling chat interface' },
        { name: 'Database', description: 'Dynamic database connection management' },
        { name: 'Admin', description: 'Admin controls for AI rate limiting and usage management' },
        { name: 'Dashboard', description: 'Per-widget data-source configuration for the Overview dashboard' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: true },
    staticCSP: true,
  });

  // ── Global error handler ───────────────────────────────────────────────────
  fastify.setErrorHandler((err, _req, reply) => {
    if (isAppError(err)) {
      return reply.status(err.statusCode).send({
        error: err.message,
        code: err.code,
      });
    }

    // Fastify validation errors
    if (err.statusCode === 400) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.message,
      });
    }

    logger.error({ err }, 'Unhandled server error');
    return reply.status(500).send({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await fastify.register(healthRoutes);
  await fastify.register(mcpRoutes);
  await fastify.register(toolRoutes);
  await fastify.register(authRoutes);
  await fastify.register(chatHistoryRoutes);
  await fastify.register(dbRoutes);
  await fastify.register(aiChatRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(alertRoutes);
  await fastify.register(aiRateLimitRoutes);
  await fastify.register(dashboardWidgetRoutes);

  return fastify;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  logger.info('🚀 Starting FinBridge MCP Server…');

  // 1. Validate DB connectivity
  await pingDatabase();
  logger.info('✅ MySQL connected');

  // 2. Validate Redis connectivity
  await pingRedis();
  logger.info('✅ Redis connected');

  // 3. Seed default admin if no users exist
  await ensureDefaultAdmin();
  logger.info('✅ User store ready');

  // 3b. Ensure dashboard widget config table exists + seed defaults
  try {
    await ensureDashboardWidgetsTable();
  } catch (err) {
    logger.warn({ err }, '⚠️  Dashboard widget table init failed — dashboard may show empty widgets');
  }

  // 4. Register static domain tools
  registerStaticTools();

  // 4. Restore dynamic tools from stored connections (respects selectedTables per connection)
  try {
    const connections = await listStoredConnections();
    let totalTools = 0;
    for (const conn of connections) {
      try {
        const summary = await generateToolsForConnection(conn.id);
        totalTools += summary.toolsGenerated.length;
        logger.info({ connectionId: conn.id, database: conn.database, tools: summary.toolsGenerated }, 'Tools restored for connection');
      } catch (connErr) {
        logger.warn({ err: connErr, connectionId: conn.id }, 'Failed to restore tools for connection');
      }
    }
    logger.info({ totalTools }, `✅ Dynamic tools restored (${totalTools} tools across ${connections.length} connections)`);
  } catch (err) {
    logger.warn({ err }, '⚠️  Dynamic tool restoration failed — static tools still available');
  }

  logger.info({ total: toolRegistry.getToolCount() }, `🛠  Total tools registered`);

  // 5. Start BullMQ workers
  startWorkers(async (job) => {
    const ctx = {
      caller: { id: job.callerId, role: job.callerRole as any, name: undefined },
      requestId: job.requestId,
      timestamp: new Date(),
    };
    return toolRegistry.executeTool(job.toolName, job.args, ctx);
  });
  logger.info('✅ BullMQ workers started');

  // 5a. Start AI learning worker
  startAiLearningWorker();
  logger.info('✅ AI learning worker started');

  // 5b. Bootstrap Qdrant collection (non-blocking — errors logged and swallowed)
  ensureQdrantCollection()
    .then(() => logger.info('✅ Qdrant collection ready'))
    .catch((err) => logger.warn({ err }, '⚠️  Qdrant init failed — AI memory disabled'));

  // 6. Build and start Fastify
  const server = await buildServer();

  try {
    await server.listen({ port: env.PORT, host: env.HOST });
    initSocketIO(server.server);
    await startAnalyticsWorkers();
    logger.info(`✅ Server listening on http://${env.HOST}:${env.PORT}`);
    logger.info(`📖 API docs available at http://${env.HOST}:${env.PORT}/docs`);
    logger.info(`🤖 MCP SSE endpoint: http://${env.HOST}:${env.PORT}/mcp/sse`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated…');
    try {
      await server.close();
      await stopAnalyticsWorkers();
      await closeQueues();
      await closeAiWorkers();
      await closePool();
      await closeRedis();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });
}

main();

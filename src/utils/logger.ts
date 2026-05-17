/**
 * Structured logger using Pino.
 * In development, outputs pretty-printed logs.
 * In production, outputs JSON for log aggregators (Datadog, CloudWatch, etc.).
 */

import pino from 'pino';
import { env } from '../config/env.js';

const transport =
  env.LOG_PRETTY
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : undefined;

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: {
      service: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
      env: env.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  },
  transport,
);

export type Logger = typeof logger;

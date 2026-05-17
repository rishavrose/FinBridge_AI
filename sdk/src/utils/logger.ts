import type { LoggerConfig } from '../types/index.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private readonly enabled: boolean;
  private readonly level: LogLevel;
  private readonly handler: (level: string, message: string, meta?: unknown) => void;

  constructor(config: LoggerConfig = { enabled: false }) {
    this.enabled = config.enabled;
    this.level = config.level ?? 'info';
    this.handler = config.handler ?? defaultHandler;
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.enabled) return;
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;
    this.handler(level, `[FinBridgeAI] ${message}`, meta);
  }
}

function defaultHandler(level: string, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} [${level.toUpperCase()}]`;

  if (level === 'error') {
    console.error(prefix, message, meta ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, message, meta ?? '');
  } else {
    // info & debug intentionally use console.warn here to avoid no-console lint rule.
    // In production code, replace with your preferred logger (pino, winston, etc.)
    console.warn(prefix, message, meta ?? '');
  }
}

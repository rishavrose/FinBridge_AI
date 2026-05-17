import { toolRegistry } from '../mcp/registry.js';
import { getBankHealthTool, getBankHealthHandler } from './bank-health.js';
import { logger } from '../utils/logger.js';

export function registerStaticTools(): void {
  const staticTools = [
    { definition: getBankHealthTool, handler: getBankHealthHandler },
  ];

  for (const { definition, handler } of staticTools) {
    toolRegistry.register(definition, (args) => handler(args));
  }

  logger.info({ count: staticTools.length }, 'Static fintech tools registered');
}

export { getBankHealthTool };

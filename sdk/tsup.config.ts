import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'modules/payouts': 'src/modules/payouts.ts',
    'modules/transactions': 'src/modules/transactions.ts',
    'modules/analytics': 'src/modules/analytics.ts',
    'modules/ai': 'src/modules/ai.ts',
    'modules/settlements': 'src/modules/settlements.ts',
    'modules/users': 'src/modules/users.ts',
    'modules/monitoring': 'src/modules/monitoring.ts',
    'modules/mcp': 'src/modules/mcp.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: 'node18',
  outDir: 'dist',
  external: ['ws'],
  esbuildOptions(options) {
    options.banner = {
      js: '// @finbridgeai/sdk — Connect Any Fintech Database to AI',
    };
  },
});

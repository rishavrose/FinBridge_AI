// Build script for the FinBridge chat widget.
//
//   node build.mjs           → one-off minified production bundle  (dist/finbridge-widget.js)
//   node build.mjs --watch   → rebuild on every source change
//   node build.mjs --serve   → rebuild + serve the demo at http://localhost:5500/demo/
//
// The output is a single self-contained IIFE with zero runtime dependencies,
// so consumers only ever load one <script> tag.

import * as esbuild from 'esbuild';

const serve = process.argv.includes('--serve');
const watch = serve || process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'FinBridgeChatWidget',
  outfile: 'dist/finbridge-widget.js',
  target: ['es2018'],
  minify: !watch,
  sourcemap: watch,
  legalComments: 'none',
  banner: {
    js: '/* FinBridge Chat Widget — plug-and-play AI chat. https://github.com/your-org/finbridge */',
  },
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { host, hosts, port } = await ctx.serve({ servedir: '.', port: 5500 });
  const raw = (hosts && hosts[0]) || host || 'localhost';
  const display = raw === '0.0.0.0' || raw === '127.0.0.1' ? 'localhost' : raw;
  console.log(`\n  ▸ Demo running:  http://${display}:${port}/demo/`);
  console.log('  ▸ Rebuilding on change. Ctrl-C to stop.\n');
} else if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('  ▸ Watching src/ — rebuilding on change. Ctrl-C to stop.');
} else {
  await esbuild.build(options);
  console.log('  ▸ Built dist/finbridge-widget.js');
}

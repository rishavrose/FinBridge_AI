import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/AIchat/',
  server: {
    port: 5173,
    proxy: {
      '/auth':      'http://localhost:3000',
      '/mcp':       'http://localhost:3000',
      '/tools':     'http://localhost:3000',
      '/ai':        'http://localhost:3000',
      '/chat':      'http://localhost:3000',
      '/health':    'http://localhost:3000',
      '/db':        'http://localhost:3000',
      '/users':     'http://localhost:3000',
      '/analytics': 'http://localhost:3000',
      '/alerts':    'http://localhost:3000',
      '/incidents': 'http://localhost:3000',
      '/admin':     'http://localhost:3000',
    },
  },
});

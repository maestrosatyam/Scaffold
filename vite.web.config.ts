import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Simulator + coach web app (src/web). `npm run dev:web` proxies MCP and API calls to the local
// server; in production the server serves dist/web with an SPA fallback for /coach etc.
export default defineConfig({
  root: 'src/web',
  base: '/',
  plugins: [preact()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { '/mcp': 'http://127.0.0.1:8787', '/api': 'http://127.0.0.1:8787', '/healthz': 'http://127.0.0.1:8787' },
  },
  preview: {
    port: 4173,
    proxy: { '/mcp': 'http://127.0.0.1:8787', '/api': 'http://127.0.0.1:8787' },
  },
});

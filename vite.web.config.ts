import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Simulator + coach web app. `npm run dev:web` proxies MCP and API calls to the local server.
export default defineConfig({
  root: 'src/web',
  base: '/',
  plugins: [preact()],
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: { '/mcp': 'http://127.0.0.1:8787', '/api': 'http://127.0.0.1:8787', '/healthz': 'http://127.0.0.1:8787' },
  },
});

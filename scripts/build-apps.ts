// Builds each MCP App view (src/apps/*.html) into ONE self-contained HTML file in dist/apps/,
// as MCP Apps hosts render ui:// resources in a sandboxed iframe with no network access.
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const entries = ['step-card', 'independence-report', 'suggestions', 'progress'];
for (const [i, name] of entries.entries()) {
  await build({
    configFile: false,
    root: resolve(root, 'src/apps'),
    logLevel: 'warn',
    plugins: [viteSingleFile()],
    build: {
      outDir: resolve(root, 'dist/apps'),
      emptyOutDir: i === 0,
      rollupOptions: { input: resolve(root, `src/apps/${name}.html`) },
    },
  });
  console.log(`built dist/apps/${name}.html`);
}

// Builds each MCP App view (src/apps/*.html) into ONE self-contained HTML file in dist/apps/,
// as MCP Apps hosts render ui:// resources in a sandboxed iframe with no network access.
//
//   node scripts/build-apps.ts          -> dist/apps/{step-card,independence-report,suggestions,progress}.html
//   node scripts/build-apps.ts --dev    -> also dist/apps-dev/dev-harness.html (fake host + fixtures)
//
// Fonts: tokens.css imports the full @fontsource CSS (latin + latin-ext, woff2 + woff). Inlined
// as data: URLs that would roughly triple the font payload, so for the device cards the two
// imports are aliased to a latin-only, woff2-only subset (src/apps/shared/font-{400,700}.css).
import { build, type InlineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const dev = process.argv.includes('--dev');
const views = ['step-card', 'independence-report', 'suggestions', 'progress'];

const config = (name: string, outDir: string, emptyOutDir: boolean): InlineConfig => ({
  configFile: false,
  root: resolve(root, 'src/apps'),
  logLevel: 'warn',
  plugins: [viteSingleFile()],
  resolve: {
    alias: [
      {
        find: /^@fontsource\/atkinson-hyperlegible\/(400|700)\.css$/,
        replacement: resolve(root, 'src/apps/shared/font-$1.css'),
      },
    ],
  },
  build: {
    outDir,
    emptyOutDir,
    target: 'es2022',
    reportCompressedSize: false,
    rollupOptions: { input: resolve(root, `src/apps/${name}.html`) },
  },
});

const kb = (file: string) => `${(statSync(file).size / 1024).toFixed(1)} KB`;
for (const [i, name] of views.entries()) {
  await build(config(name, resolve(root, 'dist/apps'), i === 0));
  console.log(`built dist/apps/${name}.html  ${kb(resolve(root, `dist/apps/${name}.html`))}`);
}
if (dev) {
  await build(config('dev-harness', resolve(root, 'dist/apps-dev'), true));
  console.log(`built dist/apps-dev/dev-harness.html  ${kb(resolve(root, 'dist/apps-dev/dev-harness.html'))}`);
}

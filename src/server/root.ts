import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo/package root: the nearest ancestor of this file that has a package.json (works from src/ and dist/). */
export function packageRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('package.json not found above ' + fromUrl);
    dir = up;
  }
  return dir;
}

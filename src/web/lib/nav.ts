// Minimal client-side routing (pushState). Server SPA fallback covers /coach, /time-machine, /device.
import { Store } from './store.ts';

export const locationStore = new Store<{ path: string; search: string }>({ path: location.pathname, search: location.search });

window.addEventListener('popstate', () => locationStore.set({ path: location.pathname, search: location.search }));

export function navigate(href: string): void {
  const url = new URL(href, location.origin);
  if (url.pathname + url.search === location.pathname + location.search) return;
  history.pushState(null, '', url.pathname + url.search);
  locationStore.set({ path: url.pathname, search: url.search });
}

/** onClick handler for in-app links (keeps the session and MCP clients alive). */
export function linkClick(e: MouseEvent): void {
  const a = (e.currentTarget as HTMLAnchorElement | null) ?? null;
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href') ?? '/');
}

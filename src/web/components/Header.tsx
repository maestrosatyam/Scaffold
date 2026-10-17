import { useEffect, useState } from 'preact/hooks';
import { linkClick } from '../lib/nav.ts';
import { clockStore, resetDemo } from '../lib/session.ts';
import { useStore } from '../lib/store.ts';
import { InfoIcon, LogoMark } from './icons.tsx';

const NAV = [
  { href: '/', label: 'Simulator', match: (p: string, s: string) => p === '/' && !s.includes('layout=split') },
  { href: '/coach', label: 'Coach', match: (p: string) => p.startsWith('/coach') },
  { href: '/time-machine', label: 'Time machine', match: (p: string) => p.startsWith('/time-machine') },
  { href: '/?layout=split', label: 'Director view', match: (p: string, s: string) => p === '/' && s.includes('layout=split') },
];

/** The demo clock (server time for this sandbox), ticking locally between syncs. */
export function useDemoNow(): { now: Date; timeZone: string; mode: string } | null {
  const clock = useStore(clockStore);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!clock) return null;
  return { now: new Date(Date.now() + clock.offsetMs), timeZone: clock.timeZone, mode: clock.mode };
}

export function fmtTime(d: Date, timeZone: string, opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }): string {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(d);
}

export function Header({ path, search, theme = 'dark' }: { path: string; search: string; theme?: 'dark' | 'light' }) {
  const clock = useDemoNow();
  const [resetting, setResetting] = useState(false);
  return (
    <header class="header" data-theme={theme}>
      <a class="brand" href="/" onClick={linkClick} aria-label="Scaffold home">
        <LogoMark />
        <span class="brand-text">
          <span class="brand-name">Scaffold</span>
          <span class="brand-tag">The routine coach designed to be needed less</span>
        </span>
      </a>
      <nav class="nav" aria-label="Views">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} onClick={linkClick} aria-current={n.match(path, search) ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
      <div class="header-right">
        <span class="sim-badge" title="This web page simulates an Alexa+ device screen. It is a real MCP client of the Scaffold server, but it is not Amazon software and uses no Amazon services.">
          <InfoIcon /> Simulated Alexa+ surface — not Amazon software
        </span>
        <div class="clock" aria-live="off" title={clock?.mode === 'demo' ? 'Demo clock: this sandbox starts at 7:24 AM local time and runs in real time' : 'Server time'}>
          <span class="clock-time">{clock ? fmtTime(clock.now, clock.timeZone) : '--:--'}</span>
          <span class="clock-sub">{clock ? `${fmtTime(clock.now, clock.timeZone, { weekday: 'short', month: 'short', day: 'numeric' })} · ${clock.mode === 'demo' ? 'demo clock' : 'server time'}` : 'connecting'}</span>
        </div>
        <button
          class="btn-ghost"
          disabled={resetting}
          onClick={() => {
            setResetting(true);
            void resetDemo().catch(() => setResetting(false));
          }}
          title="Create a fresh private sandbox with the same 21 days of synthetic history"
        >
          {resetting ? 'Resetting…' : 'Reset demo'}
        </button>
      </div>
    </header>
  );
}

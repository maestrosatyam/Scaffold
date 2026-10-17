import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles/app.css';
import { Header } from './components/Header.tsx';
import { callFromView, dialogues, lastResult, lastTurn, ROOMS, roomStore, say, screens, setRoom, turns, type Room, type Source, type Turn } from './lib/assistant.ts';
import { trace } from './lib/mcp.ts';
import { locationStore, navigate } from './lib/nav.ts';
import { applyRecordMode, recordModeFrom } from './lib/present.ts';
import { eventsStore, resetDemo, sessionStore, startSession } from './lib/session.ts';
import { useStore } from './lib/store.ts';
import { setMuted, setSpeaker, type Speaker } from './lib/voice.ts';
import { CoachPage } from './pages/Coach.tsx';
import { Simulator } from './pages/Simulator.tsx';
import { TimeMachine } from './pages/TimeMachine.tsx';

// ------------------------------------------------------------------ automation hook (Playwright / recording)

interface ScaffoldApi {
  ready: boolean;
  whenReady(): Promise<void>;
  say(text: string, opts?: { room?: Room; source?: Source }): Promise<Turn>;
  tap(tool: string, args: Record<string, unknown>, opts?: { room?: Room }): Promise<unknown>;
  lastResult: unknown;
  lastTurn: Turn | null;
  room: Room;
  setRoom(room: Room): void;
  navigate(path: string): void;
  setSpeaker(fn: Speaker | null): void;
  onSpeak: ((text: string, meta: unknown) => void) | null;
  mute(on?: boolean): void;
  dialogue(): unknown;
  screens(): unknown;
  turns(): Turn[];
  trace(): unknown[];
  events(): unknown[];
  protocolVersion(): string | undefined;
  reset(): Promise<void>;
}

const api: ScaffoldApi = {
  ready: false,
  whenReady: () => startSession().then(() => undefined),
  say: (text, opts) => say(text, opts?.source ?? 'typed', opts?.room ?? roomStore.get()),
  tap: (tool, args, opts) => callFromView(opts?.room ?? roomStore.get(), tool, args),
  get lastResult() {
    return lastResult;
  },
  get lastTurn() {
    return lastTurn;
  },
  get room() {
    return roomStore.get();
  },
  setRoom: (r) => setRoom(ROOMS.includes(r) ? r : 'bedroom'),
  navigate,
  setSpeaker,
  onSpeak: null,
  mute: (on = true) => setMuted(on),
  dialogue: () => dialogues.get(),
  screens: () => screens.get(),
  turns: () => turns.get(),
  trace: () => trace.get(),
  events: () => eventsStore.get(),
  protocolVersion: () => {
    const s = sessionStore.get();
    return s.status === 'ready' ? s.session.learner.protocolVersion : undefined;
  },
  reset: () => resetDemo(),
};
(window as unknown as { scaffold: ScaffoldApi }).scaffold = api;

// ?record=1: presentation mode for the demo video (set once; survives in-app navigation).
applyRecordMode(document.documentElement, recordModeFrom(location.search));

// ------------------------------------------------------------------ app shell

function App() {
  const loc = useStore(locationStore);
  const s = useStore(sessionStore);
  const coach = loc.path.startsWith('/coach');
  const params = new URLSearchParams(loc.search);
  const layout = loc.path.startsWith('/device') || params.get('layout') === 'kiosk' ? 'kiosk' : params.get('layout') === 'split' ? 'split' : 'default';

  useEffect(() => {
    void startSession()
      .then(() => {
        api.ready = true;
        document.documentElement.dataset.ready = 'true';
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('theme-light', coach);
    document.title = coach ? 'Scaffold — Coach view' : loc.path.startsWith('/time-machine') ? 'Scaffold — Time machine' : 'Scaffold — Simulated Alexa+ surface';
  }, [coach, loc.path]);

  let body;
  if (s.status === 'loading')
    body = (
      <div class="boot">
        <div class="boot-card" role="status">
          <span class="spinner" />
          {s.step}…
        </div>
      </div>
    );
  else if (s.status === 'error')
    body = (
      <div class="boot">
        <div class="boot-card err" role="alert">
          <strong>Could not reach the Scaffold MCP server.</strong>
          <code>{s.error}</code>
          <span>Start it with: SCAFFOLD_STORE=memory PORT=8787 node src/server/main.ts</span>
          <button class="btn-ghost" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  else if (coach) body = <CoachPage session={s.session} />;
  else if (loc.path.startsWith('/time-machine')) body = <TimeMachine session={s.session} />;
  else body = <Simulator session={s.session} layout={layout} />;

  return (
    <>
      <Header path={loc.path} search={loc.search} theme={coach ? 'light' : 'dark'} />
      <main class="page" id="main">
        {body}
      </main>
    </>
  );
}

render(<App />, document.getElementById('app')!);

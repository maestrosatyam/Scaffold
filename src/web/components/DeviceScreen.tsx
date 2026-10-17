// What one room's device shows: an ambient idle screen, the MCP App view for the latest tool
// result (one persistent iframe per ui:// view, cross-faded), and a notice sheet for replies that
// have no view (fallbacks, errors, decide_suggestion).
import { useEffect } from 'preact/hooks';
import { callFromView, dismissNotice, ROOM_LABEL, say, screens, type Room } from '../lib/assistant.ts';
import { AppHost } from '../lib/apphost.tsx';
import type { ScaffoldMcp } from '../lib/mcp.ts';
import { useStore } from '../lib/store.ts';
import { SCREEN_H, SCREEN_W } from './DeviceFrame.tsx';
import { fmtTime, useDemoNow } from './Header.tsx';
import { LogoMark, MicIcon } from './icons.tsx';

const VIEW_TITLE: Record<string, string> = {
  'ui://scaffold/step-card.html': 'Step card',
  'ui://scaffold/suggestions.html': 'Coach suggestions',
  'ui://scaffold/progress.html': 'My progress',
  'ui://scaffold/independence-report.html': 'Independence report',
};

function Idle({ room }: { room: Room }) {
  const clock = useDemoNow();
  const time = clock ? fmtTime(clock.now, clock.timeZone) : '';
  const [hm, ampm] = time.split(' ');
  return (
    <div class="idle">
      <div class="idle-room">{ROOM_LABEL[room]}</div>
      <div class="idle-time">
        {hm || '--:--'}
        {ampm && <small>{ampm}</small>}
      </div>
      <div class="idle-date">{clock ? fmtTime(clock.now, clock.timeZone, { weekday: 'long', month: 'long', day: 'numeric' }) : ''}</div>
      <div class="idle-hint">
        <span class="mic-glyph">
          <MicIcon size={20} />
        </span>
        {room === 'kitchen' ? 'Try “where was I?”' : 'Try “start my morning”'}
      </div>
      <div class="idle-brand">
        <LogoMark size={20} /> Scaffold
      </div>
    </div>
  );
}

export function DeviceScreen({ room, mcp, timeZone }: { room: Room; mcp: ScaffoldMcp; timeZone?: string }) {
  const screen = useStore(screens)[room];
  const notice = screen.notice;

  // Notices over a card fade away on their own; over the idle screen they stay until the next turn.
  useEffect(() => {
    if (!notice || !screen.uri) return;
    const t = setTimeout(() => dismissNotice(room), 9000);
    return () => clearTimeout(t);
  }, [notice?.seq, screen.uri]);

  return (
    <>
      <div class="screen-layer" data-active={String(!screen.uri)}>
        <Idle room={room} />
      </div>
      {Object.entries(screen.apps).map(([uri, app]) => (
        <div key={uri} class="screen-layer" data-active={String(screen.uri === uri)}>
          <AppHost
            mcp={mcp}
            uri={uri}
            title={VIEW_TITLE[uri] ?? uri}
            toolName={app.toolName}
            toolArgs={app.args}
            result={app.result}
            resultSeq={app.seq}
            theme="dark"
            width={SCREEN_W}
            height={SCREEN_H}
            surface="device"
            timeZone={timeZone}
            onCallTool={(name, args) => callFromView(room, name, args)}
            onMessage={(text) => void say(text, 'card', room)}
          />
        </div>
      ))}
      {notice && (
        <div class="notice" data-tone={notice.tone} role="status" key={notice.seq}>
          <button class="notice-close" aria-label="Dismiss" onClick={() => dismissNotice(room)}>
            ×
          </button>
          <div class="notice-speech">{notice.speech}</div>
          {notice.options.length > 0 && (
            <div class="notice-options">
              {notice.options.slice(0, 5).map((o) => (
                <button key={o} onClick={() => void say(o, 'chip', room)}>
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

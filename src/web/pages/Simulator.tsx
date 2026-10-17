// The simulated Alexa+ surface: a room device showing the MCP App for the latest tool result,
// live captions, voice/typed input, and the "Under the hood" panel. layout=split adds the coach
// phone (director view for the demo video); kiosk shows just the device (/device).
import { useState } from 'preact/hooks';
import { DeviceFrame, VoiceWave } from '../components/DeviceFrame.tsx';
import { DeviceScreen } from '../components/DeviceScreen.tsx';
import { BedIcon, KitchenIcon } from '../components/icons.tsx';
import { UnderTheHood } from '../components/UnderTheHood.tsx';
import { Captions, VoiceBar } from '../components/Voice.tsx';
import { ROOM_LABEL, ROOMS, roomStore, setRoom } from '../lib/assistant.ts';
import type { Session } from '../lib/session.ts';
import { useStore } from '../lib/store.ts';
import { voiceState } from '../lib/voice.ts';
import { CoachApp } from './Coach.tsx';

export type Layout = 'default' | 'split' | 'kiosk';

export function Simulator({ session, layout }: { session: Session; layout: Layout }) {
  const room = useStore(roomStore);
  const v = useStore(voiceState);
  const [collapsed, setCollapsed] = useState(() => {
    const q = new URLSearchParams(location.search).get('hood');
    if (q !== null) return q === '0';
    // The director view needs room for device + coach phone; start with the trace folded on narrower screens.
    return layout === 'split' && window.innerWidth < 1700;
  });
  const voice = v.listening ? 'listening' : v.speaking ? 'speaking' : 'idle';
  const status = v.listening ? 'Listening…' : v.speaking ? 'Speaking' : `${ROOM_LABEL[room]} display`;

  return (
    <div class={`sim ${layout} ${collapsed ? 'hood-collapsed' : ''}`}>
      <section class="stage" aria-label="Simulated device">
        <div class="stage-top">
          <div class="stage-title">
            <strong>Sam’s home</strong>
            <span>Two room displays on one account · each keeps its own conversation</span>
          </div>
          <div class="segmented" role="group" aria-label="Which device Sam is using">
            {ROOMS.map((r) => (
              <button key={r} aria-pressed={room === r} onClick={() => setRoom(r)} data-room={r}>
                <span class="dot" aria-hidden="true" />
                {r === 'bedroom' ? <BedIcon /> : <KitchenIcon />}
                {ROOM_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        <div class="device-area">
          <DeviceFrame
            voice={voice}
            maxScale={layout === 'split' ? 1.1 : 1.2}
            label={`${ROOM_LABEL[room]} device screen`}
            chin={
              <>
                <VoiceWave />
                <span>{status}</span>
              </>
            }
          >
            {ROOMS.map((r) => (
              <div key={r} class="screen-layer" data-active={String(r === room)} data-room-screen={r}>
                <DeviceScreen room={r} mcp={session.learner} timeZone={session.sandbox.timeZone} />
              </div>
            ))}
          </DeviceFrame>
        </div>
        <Captions room={room} />
        <VoiceBar room={room} />
      </section>
      {layout === 'split' && (
        <div class="split-coach">
          <div class="phone">
            <CoachApp session={session} />
          </div>
        </div>
      )}
      {layout !== 'kiosk' && <UnderTheHood session={session} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />}
    </div>
  );
}

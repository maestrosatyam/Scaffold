// Live captions (what the person said, and the assistant's verbatim speech) + the input bar:
// mic (Web Speech API when available), typed input, and context-aware suggestion chips.
import { useMemo, useRef, useState } from 'preact/hooks';
import { busy, dialogues, say, turns, type Room, type Turn } from '../lib/assistant.ts';
import { optionsFor } from '../lib/router.ts';
import { useStore } from '../lib/store.ts';
import { listen, recognitionSupported, setMuted, voiceState } from '../lib/voice.ts';
import { MicIcon, MuteIcon, SendIcon, SpeakerIcon } from './icons.tsx';

const SOURCE_LABEL: Record<Turn['source'], string> = { voice: 'voice', typed: 'typed', chip: 'tap', card: 'on screen', api: 'script' };

function describeSilence(t: Turn): string {
  const step = (t.result?.structuredContent as { step?: { title?: string } } | undefined)?.step;
  return step?.title ? `Silent on purpose — Sam does “${step.title}” on their own now.` : 'Silent on purpose — this step is learned.';
}

export function Captions({ room }: { room: Room }) {
  const all = useStore(turns);
  const v = useStore(voiceState);
  const last = useMemo(() => [...all].reverse().find((t) => t.room === room), [all, room]);
  const userLine = v.listening ? (
    <div class="cap-text interim">{v.interim || 'Listening…'}</div>
  ) : last?.user ? (
    <div class="cap-text user" key={`u${last.id}`}>
      “{last.user}”<span class="src">{SOURCE_LABEL[last.source]}</span>
    </div>
  ) : last?.source === 'card' ? (
    <div class="cap-text user" key={`u${last.id}`}>
      Tapped the screen<span class="src">{last.tool}</span>
    </div>
  ) : (
    <div class="cap-text cap-empty">Say or type something to begin.</div>
  );
  let botLine;
  if (!last) botLine = <div class="cap-text cap-empty">Scaffold’s exact words appear here.</div>;
  else if (last.pending) botLine = <div class="cap-text interim">…</div>;
  else if (last.silent) botLine = <div class="cap-text silent" key={`b${last.id}`}>{describeSilence(last)}</div>;
  else botLine = <div class="cap-text" key={`b${last.id}`}>{last.speech}</div>;
  return (
    <section class="captions" aria-label="Live captions" aria-live="polite">
      <div class="cap-label">You (Sam)</div>
      {userLine}
      <div class="cap-label assistant">Scaffold</div>
      {botLine}
    </section>
  );
}

const HINGLISH = new Set(['ho gaya', 'madad', 'phir se bolo', 'main kahan tha']);

export function VoiceBar({ room }: { room: Room }) {
  const d = useStore(dialogues)[room];
  const v = useStore(voiceState);
  const isBusy = useStore(busy);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canListen = useMemo(() => recognitionSupported(), []);
  const chips = useMemo(() => {
    const base = optionsFor(d);
    if (d.awaiting || d.proposalId) return base;
    if (d.runId) return [...base.slice(0, 4), 'all done', 'ho gaya'];
    if (!d.proposalId && room === 'kitchen') return ['where was I?', 'main kahan tha', ...base.filter((x) => x !== 'where was I?').slice(0, 3)];
    return base;
  }, [d, room]);

  const submit = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    void say(t, 'typed', room);
  };

  return (
    <div class="voicebar">
      <div class="voice-row">
        {canListen && (
          <button
            class="mic"
            aria-pressed={v.listening}
            aria-label={v.listening ? 'Stop listening' : 'Speak to the device'}
            title="Speak (uses your browser's speech recognition)"
            onClick={() => {
              setNote('');
              if (v.listening) return;
              listen((t) => void say(t, 'voice', room), (m) => setNote(m));
            }}
          >
            <MicIcon size={24} />
          </button>
        )}
        <form class="say-form" onSubmit={submit}>
          <label class="sr-only" for={`say-${room}`}>
            What Sam says
          </label>
          <input
            id={`say-${room}`}
            ref={inputRef}
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            placeholder={canListen ? 'Speak, or type what Sam says…' : 'Type what Sam says…'}
            autocomplete="off"
            spellcheck={false}
          />
          <button type="submit" disabled={!text.trim() || isBusy}>
            Say <SendIcon />
          </button>
        </form>
        <button class="icon-btn" aria-pressed={v.muted} aria-label={v.muted ? 'Unmute assistant voice' : 'Mute assistant voice'} title={v.muted ? 'Voice off (captions only)' : `Voice on${v.voiceName ? ` · ${v.voiceName}` : ''}`} onClick={() => setMuted(!v.muted)}>
          {v.muted ? <MuteIcon /> : <SpeakerIcon />}
        </button>
      </div>
      <div class="chips" role="group" aria-label="Things Sam can say">
        <span class="chips-label">Try</span>
        {chips.map((c) => (
          <button key={c} class={`chip ${HINGLISH.has(c) ? 'hinglish' : ''}`} onClick={() => void say(c, 'chip', room)} title={HINGLISH.has(c) ? 'Hinglish synonym' : undefined}>
            {c}
          </button>
        ))}
        {note && <span class="voice-note">{note}</span>}
      </div>
    </div>
  );
}

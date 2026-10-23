// Voice I/O for the simulated device: Web Speech API recognition (when the browser has it) and
// speechSynthesis for the assistant's verbatim speech. The speaker is pluggable so the video
// pipeline can substitute pre-rendered neural TTS (window.scaffold.setSpeaker).

import { Store } from './store.ts';

export interface SpeakMeta {
  room: string;
  turnId: number;
  tool?: string;
}
export type Speaker = (text: string, meta: SpeakMeta) => Promise<void> | void;
export type SpeakObserver = (text: string, meta: SpeakMeta) => void;

export const voiceState = new Store<{ speaking: boolean; muted: boolean; voiceName: string | null; listening: boolean; interim: string }>({
  speaking: false,
  muted: readMuted(),
  voiceName: null,
  listening: false,
  interim: '',
});

function readMuted(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('mute');
    if (q !== null) return q !== '0';
    return localStorage.getItem('scaffold.muted') === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem('scaffold.muted', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  voiceState.set((s) => ({ ...s, muted, speaking: muted ? false : s.speaking }));
}

let customSpeaker: Speaker | null = null;
const observers = new Set<SpeakObserver>();

export function setSpeaker(fn: Speaker | null): void {
  customSpeaker = fn;
}

export function onSpeak(fn: SpeakObserver): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

// ------------------------------------------------------------------ speech synthesis

const PREFERRED = [/natural/i, /neural/i, /online/i, /^google (us|uk) english/i, /samantha/i, /aria/i, /jenny/i, /daniel/i, /karen/i];

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!voices.length) return null;
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name) && /en[-_](US|GB|IN|AU)/i.test(x.lang)) ?? voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices.find((v) => /en[-_]US/i.test(v.lang)) ?? voices[0]!;
}

if (typeof speechSynthesis !== 'undefined') {
  const update = () => voiceState.set((s) => ({ ...s, voiceName: pickVoice()?.name ?? null }));
  update();
  speechSynthesis.addEventListener?.('voiceschanged', update);
}

const estimateMs = (text: string) => 600 + text.split(/\s+/).length * 380;

let speakSeq = 0;

/** Speak the assistant's verbatim text. Resolves when playback ends (or a safe timeout passes). */
export async function speak(text: string, meta: SpeakMeta): Promise<void> {
  if (!text.trim()) return;
  const my = ++speakSeq;
  for (const o of observers) {
    try {
      o(text, meta);
    } catch {
      /* observer errors never break the turn */
    }
  }
  const scaffold = (window as unknown as { scaffold?: { onSpeak?: SpeakObserver } }).scaffold;
  try {
    scaffold?.onSpeak?.(text, meta);
  } catch {
    /* ignore */
  }
  const finish = () => {
    if (my === speakSeq) voiceState.set((s) => ({ ...s, speaking: false }));
  };
  if (customSpeaker) {
    voiceState.set((s) => ({ ...s, speaking: true }));
    try {
      await customSpeaker(text, meta);
    } finally {
      finish();
    }
    return;
  }
  if (voiceState.get().muted || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  voiceState.set((s) => ({ ...s, speaking: true }));
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = 0.96;
    u.pitch = 1;
    const timer = setTimeout(resolve, estimateMs(text) * 1.6 + 1500);
    const end = () => {
      clearTimeout(timer);
      resolve();
    };
    u.onend = end;
    u.onerror = end;
    speechSynthesis.speak(u);
  });
  finish();
}

export function stopSpeaking(): void {
  speakSeq++;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  voiceState.set((s) => ({ ...s, speaking: false }));
}

// ------------------------------------------------------------------ speech recognition

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const recognitionSupported = (): boolean => typeof window !== 'undefined' && recognitionCtor() !== null;

/**
 * What to tell the person when recognition fails, or null to stay quiet. Chromium-based browsers send
 * the audio to the vendor's online speech service; builds without it (plain Chromium, many Linux
 * packages) fail every attempt with "network".
 */
export function recognitionErrorMessage(code: string): string | null {
  switch (code) {
    case 'aborted':
    case 'no-speech':
      return null;
    case 'not-allowed':
      return 'Microphone permission was denied.';
    case 'network':
    case 'service-not-allowed':
      return "This browser can't reach a speech service (plain Chromium builds have none). Use Chrome, Edge or Safari for the mic, or type instead.";
    case 'audio-capture':
      return 'No microphone was found. Type instead.';
    default:
      return `Speech recognition error: ${code}. Type instead.`;
  }
}

let active: InstanceType<RecognitionCtor> | null = null;

/** Listen for one utterance. Calls onFinal with the transcript; returns a stop function. */
export function listen(onFinal: (text: string) => void, onError?: (msg: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onError?.('Speech recognition is not available in this browser. Type instead.');
    return () => undefined;
  }
  active?.abort();
  stopSpeaking();
  const rec = new Ctor();
  active = rec;
  rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let final = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    voiceState.set((s) => ({ ...s, interim: (final + ' ' + interim).trim() }));
  };
  rec.onerror = (e) => {
    const msg = recognitionErrorMessage(e.error);
    if (msg) onError?.(msg);
  };
  rec.onend = () => {
    if (active === rec) active = null;
    voiceState.set((s) => ({ ...s, listening: false, interim: '' }));
    if (final.trim()) onFinal(final.trim());
  };
  voiceState.set((s) => ({ ...s, listening: true, interim: '' }));
  try {
    rec.start();
  } catch (err) {
    voiceState.set((s) => ({ ...s, listening: false }));
    onError?.(String(err));
  }
  return () => rec.stop();
}

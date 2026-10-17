// The simulated assistant: utterance -> router -> MCP tools/call -> speech + MCP App on screen.
// One dialogue context per room device (Bedroom, Kitchen). The two devices share one learner
// account (one MCP client), exactly like two smart displays in the same home: the kitchen device
// knows nothing about the bedroom's run until the person asks "where was I?".

import type { CallToolResult } from '@modelcontextprotocol/client';
import { speechOf } from './mcp.ts';
import { initialDialogue, nextState, optionsFor, route, type DialogueState, type IntentKind } from './router.ts';
import { eventsStore, nudgeEvents, startSession } from './session.ts';
import { Store } from './store.ts';
import { speak } from './voice.ts';

export const ROOMS = ['bedroom', 'kitchen'] as const;
export type Room = (typeof ROOMS)[number];
export const ROOM_LABEL: Record<Room, string> = { bedroom: 'Bedroom', kitchen: 'Kitchen' };

export type Source = 'voice' | 'typed' | 'chip' | 'card' | 'api';

export interface Screen {
  /** ui:// resource currently in the foreground (null = idle ambient screen). */
  uri: string | null;
  /** Latest tool result per ui:// resource, so each view keeps its own state when hidden. */
  apps: Record<string, { toolName: string; args: Record<string, unknown>; result: CallToolResult; seq: number }>;
  /** Short assistant message shown over the screen (fallbacks, errors, tools without a view). */
  notice: { speech: string; options: string[]; seq: number; tone: 'info' | 'error' } | null;
}

export interface Turn {
  id: number;
  room: Room;
  at: number;
  user: string | null;
  source: Source;
  intent: IntentKind | null;
  tool?: string;
  args?: Record<string, unknown>;
  result?: CallToolResult;
  speech: string;
  /** True when the server deliberately returned no speech (step done on the person's own). */
  silent: boolean;
  error?: string;
  pending: boolean;
  ms?: number;
}

const emptyScreen = (): Screen => ({ uri: null, apps: {}, notice: null });

export const roomStore = new Store<Room>(initialRoom());
export const dialogues = new Store<Record<Room, DialogueState>>({ bedroom: initialDialogue('bedroom'), kitchen: initialDialogue('kitchen') });
export const screens = new Store<Record<Room, Screen>>({ bedroom: emptyScreen(), kitchen: emptyScreen() });
export const turns = new Store<Turn[]>([]);
export const busy = new Store<boolean>(false);

function initialRoom(): Room {
  try {
    const r = new URLSearchParams(location.search).get('room');
    return r === 'kitchen' ? 'kitchen' : 'bedroom';
  } catch {
    return 'bedroom';
  }
}

let turnSeq = 0;
let screenSeq = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Serialise turns so dialogue state always chains from the previous result. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

function pushTurn(t: Turn): void {
  turns.set((ts) => [...ts.slice(-80), t]);
}

function patchTurn(id: number, patch: Partial<Turn>): Turn {
  let out!: Turn;
  turns.set((ts) =>
    ts.map((t) => {
      if (t.id !== id) return t;
      out = { ...t, ...patch };
      return out;
    }),
  );
  return out;
}

function setScreen(room: Room, fn: (s: Screen) => Screen): void {
  screens.set((all) => ({ ...all, [room]: fn(all[room]) }));
}

export function showNotice(room: Room, speech: string, options: string[], tone: 'info' | 'error' = 'info'): void {
  setScreen(room, (s) => ({ ...s, notice: { speech, options, seq: ++screenSeq, tone } }));
}

export function dismissNotice(room: Room): void {
  setScreen(room, (s) => ({ ...s, notice: null }));
}

async function runTool(room: Room, turnId: number, tool: string, args: Record<string, unknown>, origin: 'assistant' | 'view'): Promise<CallToolResult> {
  const { learner } = await startSession();
  const t0 = performance.now();
  let result: CallToolResult;
  try {
    result = await learner.callTool(tool, args, origin);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { isError: true, content: [{ type: 'text', text: `Something went wrong: ${msg}` }] };
  }
  const ms = Math.round(performance.now() - t0);
  dialogues.set((d) => ({ ...d, [room]: nextState(d[room], tool, result) }));
  const uri = learner.uiUriFor(tool);
  const speech = speechOf(result);
  const sc = result.structuredContent as { speech?: string } | undefined;
  const silent = !result.isError && typeof sc?.speech === 'string' && sc.speech === '';
  if (uri && !result.isError) {
    setScreen(room, (s) => ({ uri, apps: { ...s.apps, [uri]: { toolName: tool, args, result, seq: ++screenSeq } }, notice: null }));
  } else {
    const data = (result.structuredContent ?? {}) as { decision?: string; routine_name?: string; routines?: { name: string }[] };
    let opts = optionsFor(dialogues.get()[room]);
    if (!result.isError && tool === 'decide_suggestion') {
      // The decision is made: retire the suggestion card and offer the obvious next step.
      setScreen(room, (s) => ({ ...s, uri: null }));
      opts = data.decision === 'approved' && data.routine_name ? [`start ${data.routine_name.toLowerCase()}`, ...opts.filter((o) => !o.startsWith('start'))].slice(0, 3) : opts.slice(0, 3);
    } else if (!result.isError && tool === 'list_routines' && data.routines?.length) {
      opts = data.routines.map((r) => `start ${r.name.toLowerCase().replace(/ routine$/, '')}`).slice(0, 5);
    }
    // Domain refusals ("You don't have a routine going") are gentle guidance, not errors.
    showNotice(room, speech, opts.slice(0, 4), result.isError && speech.startsWith('Something went wrong') ? 'error' : 'info');
  }
  const turn = patchTurn(turnId, { tool, args, result, speech, silent, pending: false, ms });
  lastResult = result;
  lastTurn = turn;
  nudgeEvents();
  void speak(speech, { room, turnId, tool });
  return result;
}

export let lastResult: CallToolResult | null = null;
export let lastTurn: Turn | null = null;

/** Handle one utterance from the person on `room`'s device. Resolves after the result is on screen. */
export function say(text: string, source: Source = 'typed', room: Room = roomStore.get()): Promise<Turn> {
  return enqueue(async () => {
    busy.set(true);
    try {
      await startSession();
      const id = ++turnSeq;
      const plan = route(text, dialogues.get()[room]);
      pushTurn({ id, room, at: Date.now(), user: text, source, intent: plan.intent.kind, speech: '', silent: false, pending: true });
      if (plan.type === 'reply') {
        dialogues.set((d) => ({ ...d, [room]: { ...d[room], awaiting: plan.awaiting ?? null } }));
        showNotice(room, plan.speech, plan.options);
        const turn = patchTurn(id, { speech: plan.speech, pending: false });
        lastTurn = turn;
        void speak(plan.speech, { room, turnId: id });
        return turn;
      }
      await runTool(room, id, plan.tool, plan.args, 'assistant');
      return lastTurn!;
    } finally {
      busy.set(false);
    }
  });
}

/** A tools/call proxied from an MCP App view (e.g. the card's Done button) — a real MCP call. */
export function callFromView(room: Room, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return enqueue(async () => {
    busy.set(true);
    try {
      const id = ++turnSeq;
      pushTurn({ id, room, at: Date.now(), user: null, source: 'card', intent: null, tool, args, speech: '', silent: false, pending: true });
      return await runTool(room, id, tool, args, 'view');
    } finally {
      busy.set(false);
    }
  });
}

// A run can finish on another device. The page watches the person's event log (the same source of
// truth the server uses) and retires that run from every device's dialogue context; a device
// still showing the run's step card goes back to its ambient screen, like a display timing out.
let lastSeenSeq = 0;
eventsStore.subscribe((events) => {
  const fresh = events.filter((e) => e.seq > lastSeenSeq && !e.seeded);
  if (events.length) lastSeenSeq = Math.max(lastSeenSeq, events.at(-1)!.seq);
  const ended = new Set(fresh.filter((e) => (e.type === 'run.finished' || e.type === 'run.abandoned') && e.runId).map((e) => e.runId!));
  if (!ended.size) return;
  dialogues.set((d) => {
    let changed = false;
    const next = { ...d };
    for (const r of ROOMS) {
      if (next[r].runId && ended.has(next[r].runId!)) {
        next[r] = { ...next[r], runId: null, stepId: null, awaiting: null };
        changed = true;
      }
    }
    return changed ? next : d;
  });
  screens.set((all) => {
    let changed = false;
    const next = { ...all };
    for (const r of ROOMS) {
      const s = next[r];
      const shown = s.uri ? s.apps[s.uri] : undefined;
      const run = (shown?.result.structuredContent as { run?: { run_id?: string; status?: string } } | undefined)?.run;
      if (run?.run_id && ended.has(run.run_id) && run.status === 'active') {
        next[r] = { ...s, uri: null, notice: null };
        changed = true;
      }
    }
    return changed ? next : all;
  });
});

export function setRoom(room: Room): void {
  roomStore.set(room);
}

export function suggestionsFor(room: Room): string[] {
  return optionsFor(dialogues.get()[room]);
}

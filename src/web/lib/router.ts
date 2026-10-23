// The simulated "Alexa+ NLU": a deterministic utterance -> MCP tool-call router.
//
// A real Alexa+ add-on would let the platform's LLM pick tools using the server's INSTRUCTIONS
// and tool descriptions. This simulator replaces that model with fixed rules (ADR-002: no paid
// LLM in the headline demo), so the demo is reproducible and every turn is explainable.
// Pure module: no DOM, no network. Dialogue state is passed in and returned, never hidden.

export type Intent =
  | { kind: 'start'; routine?: string }
  | { kind: 'done' }
  | { kind: 'all_done' }
  | { kind: 'help' }
  | { kind: 'repeat' }
  | { kind: 'where' }
  | { kind: 'late'; minutes: number | null }
  | { kind: 'skip' }
  | { kind: 'progress' }
  | { kind: 'suggestions' }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'list' }
  | { kind: 'wait' }
  | { kind: 'number'; value: number }
  | { kind: 'unknown' };

export type IntentKind = Intent['kind'];

export interface DialogueState {
  /** run_id from the last step result, while that run is active. */
  runId: string | null;
  /** step_id of the current step, so step_done/need_help are idempotent and never skip a step. */
  stepId: string | null;
  /** proposal_id of the coach suggestion the person was just asked about. */
  proposalId: string | null;
  /** Device / room this dialogue belongs to, passed to start_routine / where_was_i. */
  device: string;
  /** Follow-up question the assistant is waiting on. */
  awaiting: 'minutes' | null;
}

export type Plan =
  | { type: 'call'; intent: Intent; tool: string; args: Record<string, unknown> }
  | { type: 'reply'; intent: Intent; speech: string; options: string[]; awaiting?: 'minutes' | null };

export const initialDialogue = (device: string): DialogueState => ({ runId: null, stepId: null, proposalId: null, device, awaiting: null });

// ------------------------------------------------------------------------------------------
// Normalisation and numbers
// ------------------------------------------------------------------------------------------

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[-_/]/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** Hinglish number words; only trusted when followed by a time unit ("das minute"), since "do" is also English. */
const HINDI: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10,
  gyarah: 11, barah: 12, pandrah: 15, pandra: 15, bees: 20, pachees: 25, pachchis: 25, tees: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50,
};
const MINUTE_WORD = /^(minutes?|mins?|minat|mint)$/;
const HOUR_WORD = /^(hours?|hrs?|ghante|ghanta)$/;

/** Minutes mentioned in an utterance ("10 minutes", "fifteen", "half an hour", "das minute"), or null. */
export function parseMinutes(input: string): number | null {
  const t = normalize(input);
  if (/\b(an?|one|ek) (hour|ghanta) and a half\b|\bdedh ghanta\b/.test(t)) return 90;
  if (/\bhalf (an )?hour\b|\baadha ghanta\b|\badha ghanta\b/.test(t)) return 30;
  if (/\bquarter (of an )?hour\b/.test(t)) return 15;
  if (/\ba couple( of)? (minutes?|mins?)\b/.test(t)) return 2;

  const words = t.split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    let value: number | null = null;
    let used = 1;
    if (/^\d+$/.test(w)) value = Number(w);
    else if (/^\d+(min|mins|m)$/.test(w)) return Number(w.replace(/\D/g, ''));
    else if (w in TENS) {
      value = TENS[w]!;
      const nx = words[i + 1];
      if (nx && nx in UNITS && UNITS[nx]! < 10 && UNITS[nx]! > 0) {
        value += UNITS[nx]!;
        used = 2;
      }
    } else if (w in UNITS) value = UNITS[w]!;
    else if (w in HINDI) {
      const nx = words[i + 1] ?? '';
      if (MINUTE_WORD.test(nx) || HOUR_WORD.test(nx)) value = HINDI[w]!;
    } else if ((w === 'a' || w === 'an') && (MINUTE_WORD.test(words[i + 1] ?? '') || HOUR_WORD.test(words[i + 1] ?? ''))) value = 1;
    if (value === null) continue;
    const unit = words[i + used] ?? '';
    return HOUR_WORD.test(unit) ? value * 60 : value;
  }
  return null;
}

// ------------------------------------------------------------------------------------------
// Intent rules (ordered: the first matching rule wins)
// ------------------------------------------------------------------------------------------

const has = (t: string, re: RegExp) => re.test(t);

const RE = {
  allDone: /\b(all done|all finished|i'?m all done|everything'?s? done|everything is done|done with everything|finished everything|done everything|sab ho gaya|sab ho gya|sab hogaya|sab kar liya|sab khatam|sab done)\b/,
  late: /\b(late|running behind|behind schedule|in a hurry|hurry|rushing|short on time|no time|der ho|der hai|jaldi)\b/,
  timeLeft: /\b(only|have|got|left|bas|hai|remaining)\b/,
  where: /\b(where was i|where were we|where am i|where did i (stop|leave off)|what was i doing|resume|continue|carry on|pick up where|main kahan tha|main kaha tha|mai kahan tha|mai kaha tha|kahan tha|kaha tha|kahan thi|kaha thi|kahaan tha|kahan the)\b/,
  progress: /\b(how am i doing|how'?m i doing|how did i do|how am i getting on|my progress|am i getting better|kaisa chal raha|kaise chal raha|kaisa kar raha|progress)\b/,
  suggestions: /\b(any suggestions?|suggestions?|suggested|what did (priya|my coach|the coach|coach) (suggest|say|send)|any changes|anything new|new routines?|koi suggestion|koi sujhav|sujhav)\b/,
  list: /\b(list (all )?(my )?routines|what routines|which routines|my routines|routines do i have|show (me )?(my )?routines|what can i do|routines)\b/,
  wait: /\b(not (done|finished|yet)|wait|hold on|hang on|one (sec|second|moment)|give me a (minute|sec|second|moment)|ruko|ruk jao|nahi hua|abhi nahi hua)\b/,
  help: /\b(help|stuck|what do i do|what should i do|what am i supposed to|how do i|i don'?t know|don'?t understand|confused|not sure|lost|madad|help karo|samajh nahi|kya karna hai|kya karu|kya karoon|kya karun)\b/,
  done: /\b(done|finished|finish|next|did it|i did|completed|complete|ho gaya|ho gya|hogaya|hogya|ho gayi|kar liya|kar diya|ho chuka|khatam|next step)\b/,
  whatsNext: /\b(what'?s next|what is next|what now|what next|ab kya|aage kya)\b/,
  repeat: /\b(say (that|it) again|repeat|again|one more time|what did you say|pardon|come again|didn'?t hear|phir se|fir se|phirse|firse|dobara|kya bola|kya kaha)\b/,
  skip: /\b(skip|not today|leave it|chhod do|chod do|chhodo|rehne do|rahne do)\b/,
  start: /\b(start|begin|let'?s do|lets do|let'?s start|lets start|let'?s get|lets get|let'?s make|lets make|time for|time to|do my|i want to do|i want to start|take my|make my|catch the|shuru)\b/,
  yes: /^(yes|yeah|yep|yup|ya|sure|ok|okay|please|please do|go ahead|add it|approve|approved|sounds good|haan|han|haa|ha|haan ji|ha ji|ji|ji haan|theek hai|thik hai|accha|achha)\b|\b(yes|approve it|add it|go ahead)\b/,
  no: /\b(no|nope|not now|later|maybe later|don'?t|do not|decline|nahi|nahin|na|abhi nahi|mat karo|baad mein)\b/,
};

const START_FILLER = /\b(start|begin|let'?s|lets|do|get|time|for|to|my|the|a|an|routine|please|now|i|want|can|we|you|it|this|that|again|shuru|karo|karna|hai|chalo|okay|ok)\b/g;

function routineRef(t: string): string | undefined {
  const rest = t.replace(START_FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (!rest) return undefined;
  // "get ready" / "getting ready" are aliases of the morning routine.
  if (/\bget(ting)? ready\b/.test(t) && rest === 'ready') return 'get ready';
  return rest;
}

export function parse(utterance: string): Intent {
  const t = normalize(utterance);
  if (!t) return { kind: 'unknown' };
  if (has(t, RE.allDone)) return { kind: 'all_done' };
  if (has(t, RE.late)) return { kind: 'late', minutes: parseMinutes(t) };
  const mins = parseMinutes(t);
  if (mins !== null && /\b(minutes?|mins?|minat|hours?|ghanta|ghante)\b/.test(t) && has(t, RE.timeLeft)) return { kind: 'late', minutes: mins };
  if (has(t, RE.where)) return { kind: 'where' };
  if (has(t, RE.progress)) return { kind: 'progress' };
  if (has(t, RE.suggestions)) return { kind: 'suggestions' };
  if (has(t, RE.wait)) return { kind: 'wait' };
  if (has(t, RE.help)) return { kind: 'help' };
  if (has(t, RE.whatsNext) && !/\b(done|finished|ho gaya|ho gya|hogaya)\b/.test(t)) return { kind: 'repeat' };
  if (has(t, RE.done)) return { kind: 'done' };
  if (has(t, RE.repeat)) return { kind: 'repeat' };
  if (has(t, RE.skip)) return { kind: 'skip' };
  if (has(t, RE.start)) return { kind: 'start', routine: routineRef(t) };
  if (has(t, RE.list)) return { kind: 'list' };
  if (has(t, RE.no)) return { kind: 'no' };
  if (has(t, RE.yes)) return { kind: 'yes' };
  if (mins !== null && t.split(' ').length <= 3) return { kind: 'number', value: mins };
  return { kind: 'unknown' };
}

// ------------------------------------------------------------------------------------------
// Routing: intent + dialogue state -> tool call or a short local reply
// ------------------------------------------------------------------------------------------

export const IDLE_OPTIONS = ['start my morning', 'where was I?', 'how am I doing?', 'any suggestions?', 'list my routines'];
export const RUN_OPTIONS = ['done', 'help', 'say that again', "I'm running late, 10 minutes", 'skip'];
export const DECISION_OPTIONS = ['yes', 'not now'];

/** Context-aware suggestions (at most five), used for chips and the fallback reply. */
export function optionsFor(s: DialogueState): string[] {
  if (s.awaiting === 'minutes') return ['10 minutes', '5 minutes', '20 minutes'];
  if (s.proposalId) return [...DECISION_OPTIONS, ...(s.runId ? ['done', 'help'] : ['start my morning'])].slice(0, 5);
  if (s.runId) return RUN_OPTIONS;
  return IDLE_OPTIONS;
}

const spokenList = (xs: string[]) => {
  const q = xs.map((x) => x.replace(/[?]$/, ''));
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')}, or ${q.at(-1)}`;
};

export function fallbackSpeech(s: DialogueState): string {
  return `Sorry, I didn't catch that. You can say: ${spokenList(optionsFor(s))}.`;
}

const NO_RUN = "You don't have a routine going right now. You can say: start my morning, or where was I?";

export function route(utterance: string, s: DialogueState): Plan {
  let intent = parse(utterance);
  const reply = (speech: string, options = optionsFor(s), awaiting: 'minutes' | null = null): Plan => ({ type: 'reply', intent, speech, options, awaiting });
  const call = (tool: string, args: Record<string, unknown>): Plan => ({ type: 'call', intent, tool, args });

  // A bare number (or "ten minutes") answers "How many minutes do you have?".
  if (s.awaiting === 'minutes' && (intent.kind === 'number' || intent.kind === 'unknown' || (intent.kind === 'late' && intent.minutes !== null))) {
    const m = intent.kind === 'number' ? intent.value : intent.kind === 'late' ? intent.minutes : parseMinutes(utterance);
    if (m !== null) intent = { kind: 'late', minutes: m };
  }

  const needRun = (fn: (runId: string) => Plan): Plan => (s.runId ? fn(s.runId) : reply(NO_RUN, IDLE_OPTIONS));
  const stepArg = s.stepId ? { step_id: s.stepId } : {};

  switch (intent.kind) {
    case 'start':
      return call('start_routine', { ...(intent.routine ? { routine: intent.routine } : {}), device: s.device });
    case 'done':
      return needRun((run_id) => call('step_done', { run_id, ...stepArg }));
    case 'all_done':
      return needRun((run_id) => call('step_done', { run_id, ...stepArg, all_remaining: true }));
    case 'help':
      return s.runId ? call('need_help', { run_id: s.runId, ...stepArg }) : reply(`${NO_RUN.replace("You don't", "Right now you don't")}`, IDLE_OPTIONS);
    case 'repeat':
      return needRun((run_id) => call('repeat_step', { run_id }));
    case 'where':
      return call('where_was_i', { device: s.device });
    case 'late':
      return needRun((run_id) =>
        intent.kind === 'late' && intent.minutes !== null
          ? call('running_late', { run_id, minutes_left: Math.max(0, Math.min(240, intent.minutes)) })
          : reply('Okay. How many minutes do you have?', ['10 minutes', '5 minutes', '20 minutes'], 'minutes'),
      );
    case 'skip':
      return needRun((run_id) => call('skip_step', { run_id, ...stepArg }));
    case 'progress':
      return call('my_progress', {});
    case 'suggestions':
      return call('review_suggestions', {});
    case 'list':
      return call('list_routines', {});
    case 'yes':
      return s.proposalId ? call('decide_suggestion', { proposal_id: s.proposalId, decision: 'approved' }) : reply(fallbackSpeech(s));
    case 'no':
      return s.proposalId ? call('decide_suggestion', { proposal_id: s.proposalId, decision: 'declined' }) : s.runId ? reply("Okay. Say done when you're ready.") : reply('Okay.');
    case 'wait':
      return s.runId ? reply("Okay, take your time. Say done when you're ready.") : reply(fallbackSpeech(s));
    case 'number':
    case 'unknown':
      return reply(fallbackSpeech(s));
  }
}

// ------------------------------------------------------------------------------------------
// Dialogue state transitions from tool results
// ------------------------------------------------------------------------------------------

interface ResultLike {
  isError?: boolean;
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
}

/** Next dialogue state after `tool` returned `result` (pure; mirrors the server's chaining rules). */
export function nextState(s: DialogueState, tool: string, result: ResultLike): DialogueState {
  const sc = result.structuredContent as Record<string, unknown> | undefined;
  if (result.isError || !sc) {
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    if (/already (finished|abandoned)|could not find that routine|don't have a routine going/i.test(text)) return { ...s, runId: null, stepId: null, awaiting: null };
    return { ...s, awaiting: null };
  }
  const run = sc.run as { run_id: string; status: string } | undefined;
  if (run && 'step' in sc) {
    const step = sc.step as { step_id: string } | null;
    const active = run.status === 'active';
    return { ...s, runId: active ? run.run_id : null, stepId: active ? (step?.step_id ?? null) : null, awaiting: null };
  }
  if (tool === 'review_suggestions') {
    const list = (sc.suggestions as { proposal_id: string; status: string }[] | undefined) ?? [];
    return { ...s, proposalId: list.find((p) => p.status === 'pending')?.proposal_id ?? null, awaiting: null };
  }
  if (tool === 'decide_suggestion') return { ...s, proposalId: null, awaiting: null };
  return { ...s, awaiting: null };
}

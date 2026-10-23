import { describe, expect, it } from 'vitest';
import { fallbackSpeech, initialDialogue, nextState, optionsFor, parse, parseMinutes, route, type DialogueState, type Plan } from './router.ts';

const idle = initialDialogue('bedroom');
const inRun: DialogueState = { ...idle, runId: 'run-1', stepId: 'bag' };
const deciding: DialogueState = { ...idle, proposalId: 'prop-1' };

const callOf = (p: Plan) => {
  expect(p.type).toBe('call');
  return p.type === 'call' ? { tool: p.tool, args: p.args } : null;
};

describe('parse: intents', () => {
  const cases: [string, string][] = [
    ['start my morning', 'start'],
    ['Start my morning routine.', 'start'],
    ["let's get ready", 'start'],
    ['start laundry', 'start'],
    ['take my medicine', 'start'],
    ["let's make lunch", 'start'],
    ['catch the bus', 'start'],
    ['done', 'done'],
    ["I'm done", 'done'],
    ['finished', 'done'],
    ['next', 'done'],
    ['Next step please', 'done'],
    ['ho gaya', 'done'],
    ['hogaya', 'done'],
    ['kar liya', 'done'],
    ['all done', 'all_done'],
    ["I'm all done!", 'all_done'],
    ['sab ho gaya', 'all_done'],
    ['help', 'help'],
    ['what do I do?', 'help'],
    ["I'm stuck", 'help'],
    ['madad', 'help'],
    ['help karo', 'help'],
    ['kya karna hai', 'help'],
    ['say that again', 'repeat'],
    ['repeat', 'repeat'],
    ['phir se bolo', 'repeat'],
    ['dobara bolo', 'repeat'],
    ["what's next?", 'repeat'],
    ['where was I?', 'where'],
    ['main kahan tha', 'where'],
    ['resume', 'where'],
    ["I'm running late, 10 minutes", 'late'],
    ['I only have ten minutes', 'late'],
    ['I have 15 minutes left', 'late'],
    ['der ho gayi', 'late'],
    ['skip', 'skip'],
    ['not today', 'skip'],
    ['chhod do', 'skip'],
    ['how am I doing?', 'progress'],
    ['kaisa chal raha hai', 'progress'],
    ['any suggestions?', 'suggestions'],
    ['what did Priya suggest?', 'suggestions'],
    ['yes', 'yes'],
    ['Yeah, add it', 'yes'],
    ['haan', 'yes'],
    ['theek hai', 'yes'],
    ['no', 'no'],
    ['not now', 'no'],
    ['abhi nahi', 'no'],
    ['nahi', 'no'],
    ['list my routines', 'list'],
    ['what routines do I have?', 'list'],
    ["I'm not done yet", 'wait'],
    ['hold on', 'wait'],
    ['what is the weather', 'unknown'],
    ['', 'unknown'],
  ];
  it.each(cases)('%j -> %s', (u, kind) => {
    expect(parse(u).kind).toBe(kind);
  });

  it('"all done" wins over "done", and "how am I doing" is not "done"', () => {
    expect(parse('all done').kind).toBe('all_done');
    expect(parse('how am I doing').kind).toBe('progress');
  });

  it('"I\'m done, what\'s next?" is done, not repeat', () => {
    expect(parse("I'm done, what's next?").kind).toBe('done');
  });

  it('mentions of a bus pass are not a skip', () => {
    expect(parse("I can't find my bus pass").kind).not.toBe('skip');
  });

  it('extracts the routine reference for start', () => {
    expect(parse('start my morning')).toEqual({ kind: 'start', routine: 'morning' });
    expect(parse('start laundry')).toEqual({ kind: 'start', routine: 'laundry' });
    expect(parse('Start the laundry routine')).toEqual({ kind: 'start', routine: 'laundry' });
    expect(parse('start')).toEqual({ kind: 'start', routine: undefined });
    expect(parse("let's get ready")).toEqual({ kind: 'start', routine: 'get ready' });
    expect(parse('subah shuru karo')).toEqual({ kind: 'start', routine: 'subah' });
  });
});

describe('parseMinutes', () => {
  const cases: [string, number | null][] = [
    ['10 minutes', 10],
    ['I have 10', 10],
    ['ten minutes', 10],
    ['fifteen', 15],
    ['twenty five minutes', 25],
    ['twenty-five minutes', 25],
    ['half an hour', 30],
    ['an hour', 60],
    ['an hour and a half', 90],
    ['2 hours', 120],
    ['a minute', 1],
    ['a couple of minutes', 2],
    ['das minute', 10],
    ['paanch minute', 5],
    ['aadha ghanta', 30],
    ['what do I do', null],
    ['', null],
  ];
  it.each(cases)('%j -> %s', (u, n) => {
    expect(parseMinutes(u)).toBe(n);
  });
});

describe('route: tool calls chained with dialogue state', () => {
  it('start passes routine and device', () => {
    expect(callOf(route('start my morning', idle))).toEqual({ tool: 'start_routine', args: { routine: 'morning', device: 'bedroom' } });
    expect(callOf(route('start', { ...idle, device: 'kitchen' }))).toEqual({ tool: 'start_routine', args: { device: 'kitchen' } });
    expect(callOf(route('take my medicine', idle))).toEqual({ tool: 'start_routine', args: { routine: 'take medicine', device: 'bedroom' } });
    expect(callOf(route('catch the bus', idle))).toEqual({ tool: 'start_routine', args: { routine: 'catch bus', device: 'bedroom' } });
  });

  it('done / all done / help / skip carry run_id and step_id', () => {
    expect(callOf(route('done', inRun))).toEqual({ tool: 'step_done', args: { run_id: 'run-1', step_id: 'bag' } });
    expect(callOf(route('ho gaya', inRun))).toEqual({ tool: 'step_done', args: { run_id: 'run-1', step_id: 'bag' } });
    expect(callOf(route('all done', inRun))).toEqual({ tool: 'step_done', args: { run_id: 'run-1', step_id: 'bag', all_remaining: true } });
    expect(callOf(route('help', inRun))).toEqual({ tool: 'need_help', args: { run_id: 'run-1', step_id: 'bag' } });
    expect(callOf(route('madad', inRun))).toEqual({ tool: 'need_help', args: { run_id: 'run-1', step_id: 'bag' } });
    expect(callOf(route('skip', inRun))).toEqual({ tool: 'skip_step', args: { run_id: 'run-1', step_id: 'bag' } });
    expect(callOf(route('phir se bolo', inRun))).toEqual({ tool: 'repeat_step', args: { run_id: 'run-1' } });
  });

  it('where was I works without a run (cross-device resume) and passes the device', () => {
    expect(callOf(route('where was I?', { ...idle, device: 'kitchen' }))).toEqual({ tool: 'where_was_i', args: { device: 'kitchen' } });
    expect(callOf(route('main kahan tha', { ...idle, device: 'kitchen' }))).toEqual({ tool: 'where_was_i', args: { device: 'kitchen' } });
  });

  it('running late parses minutes, or asks and accepts a bare number next', () => {
    expect(callOf(route("I'm running late, 10 minutes", inRun))).toEqual({ tool: 'running_late', args: { run_id: 'run-1', minutes_left: 10 } });
    expect(callOf(route('I only have fifteen minutes', inRun))).toEqual({ tool: 'running_late', args: { run_id: 'run-1', minutes_left: 15 } });
    const ask = route("I'm late", inRun);
    expect(ask).toMatchObject({ type: 'reply', awaiting: 'minutes' });
    const waiting = { ...inRun, awaiting: 'minutes' as const };
    expect(callOf(route('12', waiting))).toEqual({ tool: 'running_late', args: { run_id: 'run-1', minutes_left: 12 } });
    expect(callOf(route('twenty', waiting))).toEqual({ tool: 'running_late', args: { run_id: 'run-1', minutes_left: 20 } });
  });

  it('minutes are clamped to the tool schema range', () => {
    expect(callOf(route('late, I have 5 hours', inRun))).toEqual({ tool: 'running_late', args: { run_id: 'run-1', minutes_left: 240 } });
  });

  it('suggestions, yes and not now use the pending proposal', () => {
    expect(callOf(route('any suggestions?', idle))).toEqual({ tool: 'review_suggestions', args: {} });
    expect(callOf(route('yes', deciding))).toEqual({ tool: 'decide_suggestion', args: { proposal_id: 'prop-1', decision: 'approved' } });
    expect(callOf(route('haan', deciding))).toEqual({ tool: 'decide_suggestion', args: { proposal_id: 'prop-1', decision: 'approved' } });
    expect(callOf(route('not now', deciding))).toEqual({ tool: 'decide_suggestion', args: { proposal_id: 'prop-1', decision: 'declined' } });
  });

  it('progress and list', () => {
    expect(callOf(route('how am I doing?', idle))).toEqual({ tool: 'my_progress', args: {} });
    expect(callOf(route('list my routines', idle))).toEqual({ tool: 'list_routines', args: {} });
  });

  it('step commands without a run reply gently instead of calling a tool', () => {
    for (const u of ['done', 'all done', 'skip', 'say that again', "I'm late, 10 minutes"]) {
      const p = route(u, idle);
      expect(p.type).toBe('reply');
      if (p.type === 'reply') expect(p.speech).toMatch(/start my morning/);
    }
  });

  it('yes with nothing pending does not approve anything', () => {
    expect(route('yes', idle).type).toBe('reply');
  });

  it('unknown utterances get a fallback listing at most five options', () => {
    for (const s of [idle, inRun, deciding]) {
      const p = route('what is the weather like', s);
      expect(p.type).toBe('reply');
      if (p.type === 'reply') {
        expect(p.options.length).toBeGreaterThan(0);
        expect(p.options.length).toBeLessThanOrEqual(5);
        expect(p.speech).toBe(fallbackSpeech(s));
      }
    }
    expect(fallbackSpeech(inRun)).toBe("Sorry, I didn't catch that. You can say: done, help, say that again, I'm running late, 10 minutes, or skip.");
  });

  it('chips are context-aware', () => {
    expect(optionsFor(idle)[0]).toBe('start my morning');
    expect(optionsFor(inRun)[0]).toBe('done');
    expect(optionsFor(deciding).slice(0, 2)).toEqual(['yes', 'not now']);
  });
});

describe('nextState', () => {
  const stepResult = (status: string, stepId: string | null) => ({
    structuredContent: { speech: '', run: { run_id: 'run-9', status }, step: stepId ? { step_id: stepId } : null },
  });

  it('tracks run and step from step results, and clears them when the run finishes', () => {
    const s1 = nextState(idle, 'start_routine', stepResult('active', 'teeth'));
    expect(s1).toMatchObject({ runId: 'run-9', stepId: 'teeth' });
    const s2 = nextState(s1, 'step_done', stepResult('finished', null));
    expect(s2).toMatchObject({ runId: null, stepId: null });
  });

  it('remembers the first pending proposal and forgets it after a decision', () => {
    const s1 = nextState(idle, 'review_suggestions', {
      structuredContent: { speech: 'x', suggestions: [{ proposal_id: 'p0', status: 'approved' }, { proposal_id: 'p1', status: 'pending' }] },
    });
    expect(s1.proposalId).toBe('p1');
    expect(nextState(s1, 'decide_suggestion', { structuredContent: { speech: 'ok', proposal_id: 'p1' } }).proposalId).toBeNull();
  });

  it('drops a run the server says is finished', () => {
    const s = nextState(inRun, 'step_done', { isError: true, content: [{ type: 'text', text: 'That routine is already finished.' }] });
    expect(s.runId).toBeNull();
  });

  it('clears a pending follow-up question after any result', () => {
    expect(nextState({ ...inRun, awaiting: 'minutes' }, 'list_routines', { structuredContent: { speech: 'x', routines: [] } }).awaiting).toBeNull();
  });
});

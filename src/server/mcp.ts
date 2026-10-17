// The Scaffold MCP server: tools, MCP Apps (ui://) resources and orchestration instructions.
// A fresh McpServer is built per request for the calling Actor (stateless Streamable HTTP), so
// tools/list itself is role-scoped: learners and coaches see different tool sets.

import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  DomainError,
  activeRun,
  cmdComplete,
  cmdDecide,
  cmdHelp,
  cmdPropose,
  cmdSkip,
  cmdStartRun,
  findRoutine,
  planForTime,
} from '../core/engine.ts';
import { levelIndex, type Actor, type LevelChange, type NewEvent, type PersonState, type RoutineDef, type Run } from '../core/model.ts';
import { finishFacts, finishSpeech, helpSpeech, nextSpeech, repeatSpeech, resumeSpeech, startSpeech } from '../core/speech.ts';
import { RoutineDefSchema, validateRoutine } from '../core/validate.ts';
import { independenceReport, stepView } from '../core/views.ts';
import {
  DecideOut,
  ExplainOut,
  LevelEnum,
  ProgressOut,
  ProposeOut,
  ReportOut,
  RoutinesOut,
  SetLevelOut,
  StepResultOut,
  SuggestionsOut,
  changeOut,
  reportOut,
  stepViewOut,
} from './schemas.ts';
import type { ScaffoldService } from './service.ts';
import type { Metrics } from './metrics.ts';

export const SERVER_INFO = { name: 'scaffold', version: '0.1.0', title: 'Scaffold — routine coach that fades itself' };

export const INSTRUCTIONS = `Scaffold coaches an adult through a step-by-step routine (e.g. a morning routine) and fades its prompts as each step is learned.
Rules for the assistant:
1. Speak the "speech" field of every result exactly as written. Never paraphrase or summarise prompts: learners rely on identical wording.
2. When "speech" is empty, say nothing (the person is doing that step on their own).
3. Chain calls with the ids from the previous result: pass run_id and step_id to step_done / need_help / skip_step.
4. "done", "finished", "next" -> step_done. "all done" -> step_done with all_remaining=true. "help", "what do I do", "I'm stuck" -> need_help. "say that again" -> repeat_step. "where was I" -> where_was_i. "I'm late, N minutes" -> running_late.
5. Never tell the person how well they are doing beyond what "speech" says; coaching reports are for coaches.`;

export const UI = {
  step: 'ui://scaffold/step-card.html',
  report: 'ui://scaffold/independence-report.html',
  suggestions: 'ui://scaffold/suggestions.html',
  progress: 'ui://scaffold/progress.html',
} as const;

export interface AppHtml {
  get(name: keyof typeof UI): string;
}

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(structured: { speech: string } & Record<string, unknown>, fallbackText?: string): ToolResult {
  const text = structured.speech || fallbackText || '(no speech: the person is doing this step on their own)';
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

function fail(err: unknown): ToolResult {
  if (err instanceof DomainError) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
  throw err;
}

const titlesOf = (r: RoutineDef): Record<string, string> => Object.fromEntries(r.steps.map((s) => [s.id, s.title]));

function changesSince(state: PersonState, run: Run, beforeCounts: Record<string, number>): z.infer<typeof StepResultOut>['level_changes'] {
  const def = state.versions[run.routineId]![run.version]!;
  const out: z.infer<typeof StepResultOut>['level_changes'] = [];
  for (const s of def.steps) {
    const st = state.stats[`${run.routineId}/${s.id}`]!;
    const before = beforeCounts[s.id] ?? 0;
    st.changes.slice(before).forEach((c: LevelChange) => out.push({ step_id: s.id, title: s.title, ...changeOut(c) }));
  }
  return out;
}

function changeCounts(state: PersonState, routineId: string): Record<string, number> {
  const r = state.routines[routineId];
  if (!r) return {};
  return Object.fromEntries(r.current.steps.map((s) => [s.id, state.stats[`${routineId}/${s.id}`]?.changes.length ?? 0]));
}

function stepResult(
  state: PersonState,
  run: Run,
  speech: string,
  extra: { duplicate?: boolean; level_changes?: z.infer<typeof StepResultOut>['level_changes']; skipped?: string[] } = {},
): z.infer<typeof StepResultOut> {
  const v = run.status === 'active' ? stepView(state, run) : null;
  return {
    speech,
    run: {
      run_id: run.runId,
      routine_id: run.routineId,
      routine_name: state.versions[run.routineId]![run.version]!.name,
      status: run.status,
      done: run.steps.filter((s) => s.status !== 'pending').length,
      total: run.steps.length,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      devices: run.devices,
    },
    step: v ? stepViewOut(v) : null,
    duplicate: extra.duplicate ?? false,
    level_changes: extra.level_changes ?? [],
    skipped: extra.skipped ?? [],
  };
}

function diffRoutines(prev: RoutineDef | undefined, next: RoutineDef) {
  const before = new Map((prev?.steps ?? []).map((s) => [s.id, s]));
  const after = new Map(next.steps.map((s) => [s.id, s]));
  return {
    added: next.steps.filter((s) => !before.has(s.id)).map((s) => s.title),
    removed: (prev?.steps ?? []).filter((s) => !after.has(s.id)).map((s) => s.title),
    changed: next.steps.filter((s) => before.has(s.id) && JSON.stringify(before.get(s.id)) !== JSON.stringify(s)).map((s) => s.title),
  };
}

export interface BuildOptions {
  service: ScaffoldService;
  actor: Actor;
  apps: AppHtml;
  metrics?: Metrics;
  knownPictograms?: ReadonlySet<string>;
}

export function buildMcpServer(opts: BuildOptions): McpServer {
  const { service, actor, apps, metrics } = opts;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const tz = service.timeZone;
  const pid = actor.personId;

  /** Wrap a handler with latency metrics and DomainError -> isError mapping. */
  const handle =
    <A,>(name: string, fn: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      const t0 = performance.now();
      try {
        return await fn(args);
      } catch (err) {
        return fail(err);
      } finally {
        metrics?.record(name, performance.now() - t0);
      }
    };

  const exec = <T,>(decide: (s: PersonState, ctx: Parameters<Parameters<ScaffoldService['execute']>[2]>[1]) => { events: NewEvent[]; result: T }) =>
    service.execute(pid, actor.actorId, decide);

  const stepUi = { ui: { resourceUri: UI.step } };
  const RunRef = { run_id: z.string().describe('run_id from the previous Scaffold result') };

  // ------------------------------------------------------------------ learner tools
  if (actor.role === 'learner') {
    registerAppTool(
      server,
      'start_routine',
      {
        title: 'Start a routine',
        description:
          'Start (or continue) one of the person\'s routines, e.g. "start my morning". Returns the first step at the support level the person has earned. If a run is already in progress it is resumed instead of restarted.',
        inputSchema: z.object({
          routine: z.string().optional().describe('Routine name as spoken, e.g. "morning". Omit for the default routine.'),
          device: z.string().max(40).optional().describe('Device/room the person is using, e.g. "kitchen"'),
        }),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: stepUi,
      },
      handle('start_routine', async ({ routine, device }: { routine?: string; device?: string }) => {
        const { result, state } = await exec((s, ctx) => {
          const r = cmdStartRun(s, ctx, { routineRef: routine, device: device ?? 'echo' });
          return { events: r.events, result: r };
        });
        const run = state.runs[result.runId]!;
        const v = stepView(state, run)!;
        return ok(stepResult(state, run, startSpeech(v, result.resumed)));
      }),
    );

    registerAppTool(
      server,
      'step_done',
      {
        title: 'Mark the current step done',
        description:
          'The person finished the current step ("done", "next", "finished"). Pass the step_id from the previous result: completing an already-completed step is a harmless no-op, so retries never skip a step. Use all_remaining=true for "all done" (only steps the person already does on their own are completed in bulk).',
        inputSchema: z.object({
          ...RunRef,
          step_id: z.string().describe('step_id from the previous result'),
          all_remaining: z.boolean().optional().describe('Person said "all done"'),
        }),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: stepUi,
      },
      handle('step_done', async ({ run_id, step_id, all_remaining }: { run_id: string; step_id: string; all_remaining?: boolean }) => {
        let before: Record<string, number> = {};
        const { result, state } = await exec((s, ctx) => {
          const routineId = s.runs[run_id]?.routineId;
          before = routineId ? changeCounts(s, routineId) : {};
          const r = cmdComplete(s, ctx, { runId: run_id, stepId: step_id, idempotencyKey: `${run_id}/${step_id}`, allRemaining: all_remaining });
          return { events: r.events, result: r };
        });
        const run = state.runs[run_id]!;
        const def = state.versions[run.routineId]![run.version]!;
        const level_changes = result.duplicate ? [] : changesSince(state, run, before);
        let speech: string;
        if (run.status === 'finished') speech = finishSpeech(finishFacts(state, run, titlesOf(def)), tz);
        else if (result.duplicate) speech = repeatSpeech(stepView(state, run)!);
        else speech = nextSpeech(stepView(state, run));
        return ok(stepResult(state, run, speech, { duplicate: result.duplicate, level_changes }));
      }),
    );

    registerAppTool(
      server,
      'need_help',
      {
        title: 'Give more help with the current step',
        description:
          'The person asked for help or seems stuck ("help", "what do I do?"). Gives the current step one level more support (cue -> short prompt -> full prompt). The extra help is recorded and informs future support levels.',
        inputSchema: z.object({ ...RunRef, step_id: z.string().optional().describe('step_id from the previous result') }),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: stepUi,
      },
      handle('need_help', async ({ run_id, step_id }: { run_id: string; step_id?: string }) => {
        const { result, state } = await exec((s, ctx) => {
          const r = cmdHelp(s, ctx, { runId: run_id });
          if (step_id && r.stepId !== step_id) throw new DomainError('step_mismatch', 'That step is already finished.');
          return { events: r.events, result: r };
        });
        const run = state.runs[run_id]!;
        return ok(stepResult(state, run, helpSpeech(stepView(state, run)!, result.atMax)));
      }),
    );

    registerAppTool(
      server,
      'repeat_step',
      {
        title: 'Repeat the current step',
        description: 'Say the current step again with exactly the same words ("say that again"). Does not change support levels.',
        inputSchema: z.object(RunRef),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: stepUi,
      },
      handle('repeat_step', async ({ run_id }: { run_id: string }) => {
        const state = await service.state(pid);
        const run = state.runs[run_id];
        if (!run) throw new DomainError('not_found', 'I could not find that routine.');
        const v = stepView(state, run);
        return ok(stepResult(state, run, v ? repeatSpeech(v) : 'That routine is finished.'));
      }),
    );

    registerAppTool(
      server,
      'where_was_i',
      {
        title: 'Resume where the person left off',
        description:
          'Resume the routine in progress, from any device ("where was I?"). Works across rooms: a run started on the bedroom device can be resumed in the kitchen.',
        inputSchema: z.object({ device: z.string().max(40).optional().describe('Device/room the person is using now') }),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: stepUi,
      },
      handle('where_was_i', async ({ device }: { device?: string }) => {
        const { result, state } = await exec((s, ctx) => {
          const run = activeRun(s, ctx.now);
          if (!run) throw new DomainError('no_active_run', "You don't have a routine going right now. You can say: start my morning.");
          return { events: [{ type: 'run.resumed', runId: run.runId, device: device ?? 'echo', at: ctx.now, actorId: ctx.actorId }], result: run.runId };
        });
        const run = state.runs[result]!;
        return ok(stepResult(state, run, resumeSpeech(stepView(state, run)!)));
      }),
    );

    registerAppTool(
      server,
      'running_late',
      {
        title: 'Replan for the time left',
        description:
          'The person is running late ("I only have 10 minutes"). Keeps every must-do step, keeps optional steps only if they fit, and skips the rest for today. Skipped steps do not count against the person.',
        inputSchema: z.object({ ...RunRef, minutes_left: z.number().min(0).max(240).describe('Minutes until the person must be done') }),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: stepUi,
      },
      handle('running_late', async ({ run_id, minutes_left }: { run_id: string; minutes_left: number }) => {
        const { result, state } = await exec((s, ctx) => {
          const plan = planForTime(s, run_id, minutes_left);
          const run = s.runs[run_id]!;
          const events: NewEvent[] = plan.drop.map((d) => ({ type: 'step.skipped' as const, runId: run_id, stepId: d.id, reason: 'late' as const, at: ctx.now, actorId: ctx.actorId }));
          const pendingAfter = run.steps.filter((x) => x.status === 'pending').length - plan.drop.length;
          if (events.length && pendingAfter === 0) events.push({ type: 'run.finished', runId: run_id, at: ctx.now, actorId: ctx.actorId });
          return { events, result: plan };
        });
        const run = state.runs[run_id]!;
        const skipped = result.drop.map((d) => d.title);
        const v = stepView(state, run);
        const keepTitles = result.keep.map((k) => k.title.toLowerCase());
        let speech = skipped.length
          ? `Okay. Today we'll skip ${skipped.map((t) => t.toLowerCase()).join(' and ')}.`
          : `Okay. You have time for everything left.`;
        if (keepTitles.length && skipped.length) speech += ` Still to do: ${keepTitles.join(', ')}.`;
        if (result.overBySec > 0) speech += ` The must-do steps usually take about ${Math.ceil(result.fitsSec / 60)} minutes.`;
        if (v) {
          const line = nextSpeech(v);
          if (line && line !== 'Okay.') speech += ` ${line}`;
        }
        return ok(stepResult(state, run, speech, { skipped }));
      }),
    );

    registerAppTool(
      server,
      'skip_step',
      {
        title: 'Skip the current step today',
        description: 'Skip the current step for today only ("skip", "not today"). Does not change support levels.',
        inputSchema: z.object({ ...RunRef, step_id: z.string().optional() }),
        outputSchema: StepResultOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: stepUi,
      },
      handle('skip_step', async ({ run_id, step_id }: { run_id: string; step_id?: string }) => {
        let title = '';
        const { state } = await exec((s, ctx) => {
          const run = s.runs[run_id];
          const cur = run?.steps.find((x) => x.status === 'pending');
          if (step_id && cur && cur.stepId !== step_id) throw new DomainError('step_mismatch', 'That step is already finished.');
          if (run && cur) title = s.versions[run.routineId]![run.version]!.steps.find((d) => d.id === cur.stepId)!.title;
          return { events: cmdSkip(s, ctx, { runId: run_id, reason: 'asked' }), result: null };
        });
        const run = state.runs[run_id]!;
        const def = state.versions[run.routineId]![run.version]!;
        const v = stepView(state, run);
        const speech =
          run.status === 'finished'
            ? finishSpeech(finishFacts(state, run, titlesOf(def)), tz)
            : `Okay, skipping ${title.toLowerCase()} today. ${nextSpeech(v)}`.trim();
        return ok(stepResult(state, run, speech, { skipped: title ? [title] : [] }));
      }),
    );

    registerAppTool(
      server,
      'review_suggestions',
      {
        title: "Hear the coach's suggested changes",
        description:
          'List routine changes the coach has suggested that are waiting for the person\'s decision. The person owns their routines: nothing a coach suggests takes effect until the person approves it.',
        inputSchema: z.object({}),
        outputSchema: SuggestionsOut,
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: UI.suggestions } },
      },
      handle('review_suggestions', async () => {
        const state = await service.state(pid);
        const pending = Object.values(state.proposals).filter((p) => p.status === 'pending');
        const suggestions = pending.map((p) => suggestionOut(state, p));
        let speech: string;
        if (!pending.length) speech = 'There are no suggestions waiting.';
        else {
          const p = pending[0]!;
          const coach = p.proposedBy.split(' (')[0];
          speech = `${coach} suggested ${p.baseVersion === null ? `a new routine: ${p.routine.name}, with ${p.routine.steps.length} steps` : `changes to your ${p.routine.name.toLowerCase()}`}. ${p.note ? `${coach} says: ${p.note} ` : ''}Do you want to add it? Say yes or not now.`;
          if (pending.length > 1) speech += ` There ${pending.length - 1 === 1 ? 'is 1 more suggestion' : `are ${pending.length - 1} more suggestions`} after this.`;
        }
        return ok({ speech, suggestions });
      }),
    );

    server.registerTool(
      'decide_suggestion',
      {
        title: 'Approve or decline a suggestion',
        description:
          'Record the person\'s decision on a coach suggestion ("yes" -> approved, "not now" -> declined). Approving publishes the new routine version. Only call this after the person clearly says yes or no.',
        inputSchema: z.object({
          proposal_id: z.string().describe('proposal_id from review_suggestions'),
          decision: z.enum(['approved', 'declined']),
        }),
        outputSchema: DecideOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      handle('decide_suggestion', async ({ proposal_id, decision }: { proposal_id: string; decision: 'approved' | 'declined' }) => {
        const { state } = await exec((s, ctx) => ({ events: cmdDecide(s, ctx, { proposalId: proposal_id, decision }), result: null }));
        const p = state.proposals[proposal_id]!;
        const published = decision === 'approved' ? state.routines[p.routine.routineId]?.version ?? null : null;
        const speech =
          decision === 'approved'
            ? `Done. ${p.routine.name} is ready. Say "start ${p.routine.name.toLowerCase()}" when you want to try it.`
            : `Okay, I won't add it. I'll let ${p.proposedBy.split(' (')[0]} know you said not now.`;
        return ok({ speech, proposal_id, decision, routine_name: p.routine.name, published_version: published });
      }),
    );

    registerAppTool(
      server,
      'my_progress',
      {
        title: "The person's own progress",
        description: 'Tell the person, in their own terms, which steps they now do on their own ("how am I doing?").',
        inputSchema: z.object({ routine: z.string().optional() }),
        outputSchema: ProgressOut,
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: UI.progress } },
      },
      handle('my_progress', async ({ routine }: { routine?: string }) => {
        const state = await service.state(pid);
        const r = findRoutine(state, routine);
        if (!r) throw new DomainError('not_found', 'There are no routines yet.');
        const steps = r.steps.map((s) => ({ step_id: s.id, title: s.title, pictogram: s.pictogram, level: state.stats[`${r.routineId}/${s.id}`]!.level }));
        const own = steps.filter((s) => s.level === 'independent');
        const finished = state.runOrder.filter((id) => state.runs[id]!.routineId === r.routineId && state.runs[id]!.status === 'finished').length;
        const speech = own.length
          ? `You do ${own.length} of ${steps.length} steps of your ${r.name.toLowerCase()} on your own now: ${own.map((s) => s.title.toLowerCase()).join(', ')}.`
          : `You're learning your ${r.name.toLowerCase()}. Every time you do a step without help, I'll need to say less.`;
        return ok({ speech, routine_name: r.name, independent_steps: own.length, total_steps: steps.length, runs_finished: finished, steps });
      }),
    );
  }

  // ------------------------------------------------------------------ shared
  server.registerTool(
    'list_routines',
    {
      title: 'List routines',
      description: "List the person's routines and whether one is in progress.",
      inputSchema: z.object({}),
      outputSchema: RoutinesOut,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handle('list_routines', async () => {
      const state = await service.state(pid);
      const now = service.now(pid).toISOString();
      const routines = Object.values(state.routines).map(({ current, version }) => ({
        routine_id: current.routineId,
        name: current.name,
        version,
        step_count: current.steps.length,
        independent_steps: current.steps.filter((s) => state.stats[`${current.routineId}/${s.id}`]?.level === 'independent').length,
        active_run_id: activeRun(state, now, current.routineId)?.runId ?? null,
      }));
      const speech = routines.length ? `You have ${routines.length === 1 ? 'one routine' : `${routines.length} routines`}: ${routines.map((r) => r.name).join(', ')}.` : 'There are no routines yet.';
      return ok({ speech, routines });
    }),
  );

  // ------------------------------------------------------------------ coach tools
  if (actor.role === 'coach') {
    registerAppTool(
      server,
      'independence_report',
      {
        title: 'Independence report',
        description:
          'Coach view: how much prompting each run needed, which steps are now independent, and which need attention. Every level change has a deterministic, auditable reason. Reports task metrics only; it makes no clinical judgement.',
        inputSchema: z.object({
          routine: z.string().optional().describe('Routine name or id; defaults to the first routine'),
          since: z.string().optional().describe('ISO date; only runs on/after it'),
        }),
        outputSchema: ReportOut,
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: UI.report } },
      },
      handle('independence_report', async ({ routine, since }: { routine?: string; since?: string }) => {
        const state = await service.state(pid);
        const r = findRoutine(state, routine);
        if (!r) throw new DomainError('not_found', 'No routine found.');
        const rep = independenceReport(state, r.routineId, since);
        return ok(reportOut(rep, rep.headline));
      }),
    );

    server.registerTool(
      'explain_step',
      {
        title: 'Why is this step at this level?',
        description: 'Coach view: the full, deterministic history of support-level changes for one step, with the runs that caused each change.',
        inputSchema: z.object({ routine: z.string().optional(), step_id: z.string() }),
        outputSchema: ExplainOut,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      handle('explain_step', async ({ routine, step_id }: { routine?: string; step_id: string }) => {
        const state = await service.state(pid);
        const r = findRoutine(state, routine);
        const sd = r?.steps.find((s) => s.id === step_id);
        if (!r || !sd) throw new DomainError('not_found', 'No such step.');
        const st = state.stats[`${r.routineId}/${sd.id}`]!;
        const runsUntilFade = st.level === 'independent' ? null : Math.max(0, r.policy.fadeAfter - st.unaidedStreak);
        const last = st.changes.at(-1);
        const speech = `${sd.title} is at ${st.level}. ${last ? last.reason : 'No changes yet.'}${runsUntilFade !== null ? ` ${runsUntilFade} more run${runsUntilFade === 1 ? '' : 's'} without help until it fades.` : ''}`;
        return ok({
          speech,
          step_id: sd.id,
          title: sd.title,
          level: st.level,
          next_prompt: st.level === 'independent' ? '' : sd.prompts[st.level],
          unaided_streak: st.unaidedStreak,
          aided_streak: st.aidedStreak,
          runs_until_fade: runsUntilFade,
          needs_attention: st.needsAttention,
          changes: st.changes.map(changeOut),
        });
      }),
    );

    server.registerTool(
      'suggest_routine',
      {
        title: 'Suggest a new or changed routine',
        description:
          'Coach: suggest a routine (a task analysis with a 3-level prompt ladder per step). It is validated, then queued for the person to approve by voice. Nothing changes until they say yes.',
        inputSchema: z.object({
          routine: RoutineDefSchema,
          note: z.string().max(200).default('').describe('Short note read to the person'),
        }),
        outputSchema: ProposeOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      handle('suggest_routine', async ({ routine, note }: { routine: RoutineDef; note: string }) => {
        const issues = validateRoutine(routine, opts.knownPictograms);
        const issuesOut = issues.map((i) => ({ severity: i.severity, step_id: i.stepId ?? null, message: i.message }));
        if (issues.some((i) => i.severity === 'error')) {
          return ok({ speech: `Not sent: ${issues.filter((i) => i.severity === 'error').length} problem(s) to fix first.`, accepted: false, proposal_id: null, issues: issuesOut });
        }
        const { result } = await exec((s, ctx) => {
          const r = cmdPropose(s, ctx, { routine, note, proposedBy: actor.displayName });
          return { events: r.events, result: r.proposalId };
        });
        const warn = issues.length ? ` ${issues.length} suggestion${issues.length === 1 ? '' : 's'} to consider.` : '';
        return ok({ speech: `Sent to the person for approval.${warn}`, accepted: true, proposal_id: result, issues: issuesOut });
      }),
    );

    server.registerTool(
      'set_step_level',
      {
        title: 'Set a step\'s support level',
        description: 'Coach override: set one step to a support level (e.g. after a change at home). Recorded in the audit log with the reason; the person hears the new level next time.',
        inputSchema: z.object({
          routine: z.string().optional(),
          step_id: z.string(),
          level: LevelEnum,
          reason: z.string().min(3).max(200),
        }),
        outputSchema: SetLevelOut,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      handle('set_step_level', async ({ routine, step_id, level, reason }: { routine?: string; step_id: string; level: z.infer<typeof LevelEnum>; reason: string }) => {
        let title = step_id;
        await exec((s, ctx) => {
          const r = findRoutine(s, routine);
          const sd = r?.steps.find((x) => x.id === step_id);
          if (!r || !sd) throw new DomainError('not_found', 'No such step.');
          title = sd.title;
          return { events: [{ type: 'level.set', routineId: r.routineId, stepId: step_id, level, reason, at: ctx.now, actorId: ctx.actorId }], result: null };
        });
        return ok({ speech: `${title} is now at ${level}.`, step_id, title, level });
      }),
    );

    server.registerTool(
      'list_suggestions',
      {
        title: 'Suggestions and their status',
        description: 'Coach view of every suggestion sent to the person and whether they approved it.',
        inputSchema: z.object({}),
        outputSchema: SuggestionsOut,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      handle('list_suggestions', async () => {
        const state = await service.state(pid);
        const suggestions = Object.values(state.proposals).map((p) => suggestionOut(state, p));
        const pending = suggestions.filter((s) => s.status === 'pending').length;
        return ok({ speech: `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}, ${pending} waiting for a decision.`, suggestions });
      }),
    );
  }

  // ------------------------------------------------------------------ MCP Apps resources
  const resource = (name: keyof typeof UI, title: string) =>
    registerAppResource(server, title, UI[name], { description: title, mimeType: RESOURCE_MIME_TYPE }, async () => ({
      contents: [{ uri: UI[name], mimeType: RESOURCE_MIME_TYPE, text: apps.get(name) }],
    }));
  resource('step', 'Step card');
  resource('report', 'Independence report');
  resource('suggestions', 'Suggestion review');
  resource('progress', 'My progress');

  return server;
}

function suggestionOut(state: PersonState, p: import('../core/model.ts').Proposal) {
  const prev = state.routines[p.routine.routineId]?.current;
  const d = diffRoutines(p.baseVersion === null ? undefined : prev, p.routine);
  return {
    proposal_id: p.proposalId,
    routine_id: p.routine.routineId,
    routine_name: p.routine.name,
    is_new: p.baseVersion === null,
    status: p.status,
    note: p.note,
    proposed_by: p.proposedBy,
    proposed_at: p.proposedAt,
    steps: p.routine.steps.map((s) => ({ step_id: s.id, title: s.title, pictogram: s.pictogram, cue: s.prompts.cue, full: s.prompts.full })),
    ...d,
  };
}

export { levelIndex };

# Scaffold — Product Requirements

**One line:** an Alexa+ routine coach for adults with cognitive disabilities that is engineered to be needed less every week.

**Status:** implemented. This PRD describes what the code does. Anything not built is listed under *Not in this release*.

## 1. Problem
Adults with intellectual or developmental disability, acquired brain injury, early-stage cognitive decline or severe executive-function difficulty often live semi-independently. They learn multi-step daily tasks (getting ready, laundry, making tea) through **task analysis**: a task is broken into steps and taught with a **prompt hierarchy** (full verbal → partial → cue → independent). The prompts are then deliberately **faded**. This is standard practice in special education and occupational therapy.

How this works at home today:
- **Prompting depends on people.** A family member or support worker prompts in person or by text, several times every morning.
- **Prompts never fade, so people become dependent on them.** Over-prompting creates prompt dependency, the opposite of the goal.
- **Existing tools don't track learning.**
  - Voice routines (Alexa Routines) announce the same thing at the same time no matter what.
  - Phone apps (visual schedules, MeMinder, MapHabit) need eyes and hands on a screen.
  - Where those apps fade prompts at all, a caregiver must change the level by hand.
- **Nobody measures whether a prompt is still needed.** No system tracks, step by step, whether the person still needs each prompt.

## 2. Users
| User | Need |
|---|---|
| **Learner** (adult, account owner) | Hear the same clear words every time; get more help on request without shame; carry on in another room; feel progress; decide what changes in their own routines. |
| **Coach** (OT, job coach, family member, with access granted by the learner) | Author routines as task analyses with a three-level prompt ladder; see where support is still needed and why; be warned when a step gets harder; adjust levels when circumstances change. |

## 3. Product principles
1. **Designed to be needed less.** Success means fewer words spoken, not more engagement.
2. **Same words every time.** Speech is built only from coach-authored prompts and fixed templates, so it is deterministic and byte-identical for identical state.
3. **Fade one step at a time, and add support back when needed.** Support levels change one rung at a time, and each change comes with a written reason.
4. **The learner owns their routines.** A coach can only *suggest* changes. Nothing takes effect until the learner approves it by voice.
5. **Task metrics only.** No diagnosis, no clinical claims, no inferred health information.
6. **Voice-first, not voice-only.** The Echo Show card repeats the exact words and has large Done, Help and Repeat tap targets for users whose speech is hard for speech recognition.

## 4. What it does (implemented)
### Learner (voice via Alexa+ or the simulated surface; 11 MCP tools)
- **Start a routine** ("start my morning"). Each step is presented at the support level the person has earned for it. If a run is already in progress, saying start again resumes it.
- **Done.** Advances to the next step. The call is idempotent by `step_id`, so a retried call never skips a step. **"All done"** bulk-completes only the steps the person already does without prompts.
- **Help.** Gives one more level of support for this step in this run (cue → short prompt → full prompt). The help is recorded as evidence.
- **Repeat.** Says the same words again.
- **Where was I?** Resumes the routine from any device or room.
- **Running late, N minutes.** Keeps every must-do step, keeps optional steps only if they fit, and skips the rest. Skips made this way don't count against the person.
- **Skip.** Skips the current step for today.
- **How am I doing?** The learner hears which steps they now do on their own.
- **Any suggestions? Yes / not now.** Lets the learner review and decide on a coach's suggested routine.

### Coach (6 MCP tools, separate token, separate tool list)
- **Independence report:**
  - words of prompting per run over time;
  - per-step level;
  - steps needing attention;
  - every level change with its reason and evidence runs;
  - seeded and live runs counted separately.
- **Explain step:** the full level history and how many unaided runs remain until the next fade.
- **Suggest routine:** the routine is validated first. Errors block it; warnings are advisory, such as a cue word that never appears in the fuller prompts. Valid routines are queued for the learner's approval.
- **Set step level:** a direct override with a required reason, written to the audit log.
- **List suggestions** and their status.

### Fading policy (deterministic, per step)
- **Fading:** after `fadeAfter` (default 3) consecutive runs with no help, the step moves one level less support.
- **Adding support back:** after `supportAfter` (default 2) consecutive runs where help was used, the step moves one level more support and is flagged "needs attention" for the coach.
- **Bounded and auditable:** levels never skip a rung and stay within [full, independent]. Every change records a human-readable reason with dates.

### Surfaces
- **Alexa+:** the MCP server (Streamable HTTP, MCP 2025-11-25). Every result carries a verbatim `speech` field, and server `instructions` tell the orchestrator to speak it exactly.
- **Rich media:** four MCP Apps (`ui://scaffold/*`): step card, independence report, suggestion review and progress, sized for an Echo Show 768×480 canvas.
- **Simulated Alexa+ surface (web):** a real MCP client and MCP Apps host, with a deterministic utterance router labelled as a simulation, voice in and out, captions, an "under the hood" protocol trace, a coach view and a replay "time machine".

## 5. Success metrics (what the product reports)
- **Words of prompting per run.** This is the primary signal. In the seeded demo history it falls from 221 to 28 words over 21 days.
- **Steps done without prompts**, out of the total.
- **Steps needing attention**: those where support was added back.
- **Tool latency.** Server p95 is held well under the Alexa+ 500 ms budget; it is measured and shown live.

## 6. Constraints and policies honoured
- **Alexa+ add-on policy:**
  - No child-targeted use; the product is for adults.
  - Not an LLM relay; there is no LLM in the runtime path.
  - No collecting or reciting sensitive personal data by voice.
  - At most 5 options per response.
  - No IDs spoken aloud.
- **Hackathon rules:**
  - Self-hosted MCP server at 2025-11-25 over Streamable HTTP.
  - The simulated surface is explicitly labelled and its source is included.
  - No Alexa logo is used.

## 7. Not in this release (honest limits)
- **No real Alexa+ or Echo integration.** The partner-only toolkit is unavailable, so the Echo Show surface is simulated.
- **No proactive push to devices.** Add-ons can't push. A real deployment would compose with native Alexa Routines, for example a 7:00 routine that says "start my morning".
- **No production account linking.** Auth uses static and sandbox bearer tokens; production would use OAuth 2.1 with PKCE via Alexa account linking.
- **No LLM drafting of task analyses.** It would be authoring-time only and is a possible future extension.
- **One learner per stream.** There is no multi-learner household UI and no multilingual prompt authoring. The router accepts a few Hinglish command synonyms; prompts are in English.
- **No clinical validation.** The prompt ladders and policy follow published practice but have not yet been reviewed by a practitioner for this product.

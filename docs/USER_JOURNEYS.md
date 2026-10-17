# Scaffold — User Journeys

The people below are synthetic demo personas: **Sam**, an adult learner, and **Priya**, Sam's occupational therapist, who acts as coach. The "Day N" history in the demo is seeded, synthetic data, and the demo labels it that way.

## J1 — Morning routine on a day of mixed mastery (learner, voice)
Seeded state at the start of the day: teeth, face and breakfast are done without prompts; dress is at the cue level; bag is at a short prompt and needs attention; door is at the cue level.
1. **"Start my morning."** Brush teeth is a step Sam does on their own, so Scaffold says only *"Okay, morning routine. I'm here if you need me."* The card shows a small pictogram and "You've got this".
2. **"Done."** (Sam has brushed their teeth.) Wash face is also an on-your-own step, so Scaffold says only *"Okay."*
3. **"Done."** Get dressed is at the cue level, so Scaffold says *"Clothes on the chair."*
4. **"Done," "Done."** Breakfast passes silently. Pack your bag gets the short prompt: *"Pack your lunch box, bus pass and phone in your bag."*
5. **"Help."** Scaffold moves up one support level and gives the full prompt: *"Step 5 of 6. Open your bag. Put in your lunch box from the fridge…"* The card's support indicator shows the climb, and the help is recorded.
6. Sam walks to the kitchen and asks the kitchen device **"Where was I?"** Scaffold answers *"You've done 4 of 6. Next is pack your bag. …"* This is the same run, now on a second device.
7. **"Done," "Done."** Scaffold closes with *"Nice, you're done at 7:31 AM."* It announces a fade only if one happened. Covered by `tests/mcp.http.test.ts` → "the headline workflow".

## J2 — The routine gets quieter over weeks (time machine)
Replaying the same event log shows the first step of the routine on three days:
- **Day 1:** *"Let's do your morning routine. Step 1 of 6. Pick up the blue toothbrush…"* (full prompt)
- **Day 10:** *"Toothbrush and paste."* (cue)
- **Day 21:** *"Okay, morning routine. I'm here if you need me."* (Sam is on their own)

Words of prompting per run fall from 221 to 28. Covered by `/api/demo/replay` and its test.

## J3 — Support is added back automatically (coach)
After help was needed on Pack your bag in two runs in a row, twice over, the step went from on-your-own back to cue, and then to a short prompt. The independence report flags the step "needs attention" and gives the reason: *"Added support back (cue to partial) because help was needed in 2 runs in a row (Oct 16, Oct 17)."* Priya can open **Explain step** to see the history and the evidence runs, or override the level with a reason that is recorded in the audit log.

## J4 — Coach suggests, learner decides (consent)
1. Priya drafts a new Laundry routine: four steps, each with a three-level prompt ladder.
2. The validator blocks errors (for example, a duplicate step id) and lists warnings (for example, a cue word that never appears in the fuller prompts).
3. Priya sends it. Nothing changes in Sam's routines yet.
4. Sam asks **"Any suggestions?"** and hears *"Priya suggested a new routine: Laundry, with 4 steps. Priya says: … Do you want to add it? Say yes or not now."*
5. **"Yes."** Version 1 of Laundry is published, and **"start laundry"** works from then on.

Covered by the "coach suggests a routine" test.

## J5 — Running late (learner)
**"I'm late, I only have 10 minutes."** Scaffold keeps every must-do step, drops Eat breakfast for today, and tells Sam so. Skips made this way don't count against Sam's progress. Covered by the engine test "running late keeps must-do steps…".

## J6 — Retry and concurrency safety (system)
The assistant re-sends `step_done` after a timeout, or two devices send it at once. Exactly one step advances: the duplicate call returns `duplicate: true` and the unchanged current step. Covered by the "idempotent" and "concurrent duplicate" tests.

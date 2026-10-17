// Copy of LAUNDRY_TEMPLATE from src/demo/seed.ts (kept separate so the browser bundle never imports
// server/engine code). The coach view pre-fills its "Suggest a routine" form with it.

export interface RoutineDraft {
  routineId: string;
  name: string;
  aliases: string[];
  policy: { fadeAfter: number; supportAfter: number };
  steps: {
    id: string;
    title: string;
    pictogram: string;
    must: boolean;
    estSec: number;
    prompts: { full: string; partial: string; cue: string };
  }[];
}

export const LAUNDRY_TEMPLATE: RoutineDraft = {
  routineId: 'laundry',
  name: 'Laundry',
  aliases: ['laundry', 'washing', 'wash clothes', 'kapde'],
  policy: { fadeAfter: 3, supportAfter: 2 },
  steps: [
    {
      id: 'sort',
      title: 'Sort clothes',
      pictogram: 'basket',
      must: true,
      estSec: 180,
      prompts: {
        full: 'Tip the laundry basket onto the floor. Put white clothes in one pile and coloured clothes in another pile.',
        partial: 'Sort the basket into whites and colours.',
        cue: 'Whites and colours.',
      },
    },
    {
      id: 'load',
      title: 'Load the machine',
      pictogram: 'washer',
      must: true,
      estSec: 120,
      prompts: {
        full: 'Open the washing machine door. Put the coloured pile inside. Close the door until it clicks.',
        partial: 'Put the coloured clothes in the machine and close the door.',
        cue: 'Colours in.',
      },
    },
    {
      id: 'soap',
      title: 'Add detergent',
      pictogram: 'detergent',
      must: true,
      estSec: 60,
      prompts: {
        full: 'Take the blue detergent bottle. Fill the cap up to the line. Pour it into the drawer marked with a two.',
        partial: 'Add one cap of blue detergent to drawer two.',
        cue: 'One cap, drawer two.',
      },
    },
    {
      id: 'start',
      title: 'Start the wash',
      pictogram: 'start-button',
      must: true,
      estSec: 30,
      prompts: {
        full: 'Turn the dial to the green dot. Press the big round button. You will hear water running.',
        partial: 'Turn the dial to the green dot and press start.',
        cue: 'Green dot, start.',
      },
    },
  ],
};

export const DEFAULT_NOTE = "Let's try this on Sunday mornings.";

/** Step metadata of the seeded morning routine, used only to shape replay payloads for the step card. */
export const MORNING_META: Record<string, { pictogram: string; must: boolean; estSec: number }> = {
  teeth: { pictogram: 'toothbrush', must: true, estSec: 150 },
  face: { pictogram: 'face-wash', must: true, estSec: 90 },
  dress: { pictogram: 'shirt', must: true, estSec: 300 },
  breakfast: { pictogram: 'cereal', must: false, estSec: 600 },
  bag: { pictogram: 'backpack', must: true, estSec: 120 },
  door: { pictogram: 'key', must: true, estSec: 90 },
};

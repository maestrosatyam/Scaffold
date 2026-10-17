// Time machine: the same step card replayed from the event log on Day 1, Day 10, Day 21 and Today
// shows the support fading from a full prompt, to a cue word, to Sam doing it on their own.
import { expect, open, test } from './fixtures.ts';

test('time machine shows the first step fading full -> cue -> independent', async ({ page }) => {
  await open(page, '/time-machine');
  await expect(page.getByText('Replay of seeded synthetic history · not real usage')).toBeVisible();

  const cols = page.locator('.tm-col');
  await expect(cols).toHaveCount(4);
  await expect(page.locator('.tm-col .apphost[data-status="ready"]')).toHaveCount(4, { timeout: 20_000 });

  const titles = await cols.locator('.tm-col-head').allInnerTexts();
  expect(titles.map((t) => t.split('\n')[0]?.trim())).toEqual(['Day 1', 'Day 10', 'Day 21', 'Today']);

  // The level chip under each replayed device ("Full prompt", "Cue word", "On their own").
  const levels = await cols.evaluateAll((els) =>
    els.map((el) => {
      const chip = el.querySelector(':scope > .row .lvl');
      return chip ? [...chip.classList].find((c) => c !== 'lvl') : null;
    }),
  );
  expect(levels).toEqual(['full', 'cue', 'independent', 'independent']);
  expect(new Set(levels)).toEqual(new Set(['full', 'cue', 'independent']));

  // Day 1 speaks the whole prompt; once independent, Scaffold opens and then stays silent.
  const speech = await cols.locator('.tm-speech').allInnerTexts();
  expect(speech[0]).toMatch(/Step 1 of 6\./);
  await expect(cols.nth(2).locator('.tm-speech')).toHaveClass(/silent/);

  // Each column's card is a real MCP App view rendered from the replayed state.
  for (let i = 0; i < 4; i++) {
    const frame = page.frameLocator('.tm-col iframe').nth(i);
    await expect(frame.locator('body')).not.toBeEmpty();
  }
});

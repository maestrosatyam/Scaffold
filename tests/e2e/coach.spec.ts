// Coach side of the demo: the independence report counts the live run next to the seeded history,
// and a suggested routine only takes effect after the learner approves it by voice (AC-11, AC-16).
import { activeFrame, appReady, expect, finishMorning, open, say, test } from './fixtures.ts';

const reportHost = '[data-testid="coach-report"] .apphost';

test('coach report shows 1 live run next to the 21 seeded runs after a finished morning', async ({ page }) => {
  await open(page, '/');

  await test.step('before any live run: 21 seeded, 0 live', async () => {
    await page.click('.nav a[href="/coach"]');
    await expect(page.locator(reportHost)).toHaveAttribute('data-status', 'ready');
    await expect(page.getByText(/21 seeded \(synthetic\) runs · 0 live runs from this sandbox/)).toBeVisible();
  });

  await test.step('finish the morning routine on the simulator', async () => {
    await page.click('.nav a[href="/"]');
    await expect(page.locator('.device')).toBeVisible();
    await finishMorning(page);
  });

  await test.step('the report (an MCP App in the coach view) now counts 1 live run', async () => {
    await page.click('.nav a[href="/coach"]');
    await expect(page.locator(reportHost)).toHaveAttribute('data-status', 'ready');
    await expect(page.getByText(/21 seeded \(synthetic\) runs · 1 live run from this sandbox/)).toBeVisible();
    await expect(page.locator('[data-testid="coach-live"]')).toContainText('finished');
    // The report view itself rendered inside its sandboxed iframe.
    const report = page.frameLocator('[data-testid="coach-report"] iframe');
    await expect(report.locator('body')).not.toBeEmpty();
    await expect(page.locator('[data-testid="coach-report"] iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  });
});

test('coach suggests Laundry, the learner approves by voice, then starts laundry', async ({ page }) => {
  await open(page, '/coach');

  await test.step('coach sends the Laundry suggestion (validated by the server)', async () => {
    await page.click('[data-tab="suggest"]');
    await page.click('[data-testid="send-suggestion"]');
    const result = page.locator('[data-testid="suggest-result"]');
    await expect(result).toBeVisible();
    await expect(result).toHaveClass(/\bok\b/);
    await expect(page.locator('[data-testid="suggestions"]')).toContainText('Laundry');
    await expect(page.locator('[data-testid="suggestions"]')).toContainText('Waiting for Sam');
  });

  await test.step('nothing changes until Sam says yes: "start laundry" is not a routine yet', async () => {
    await page.click('.nav a[href="/"]');
    await expect(page.locator('.device')).toBeVisible();
    const t = await say(page, 'start laundry');
    expect(t.speech).toBe("I couldn't find that routine. You have: Morning routine.");
    expect(t.data?.run).toBeUndefined();
  });

  await test.step('"any suggestions?" reads the proposal; "yes" approves it', async () => {
    const review = await say(page, 'any suggestions?');
    expect(review.tool).toBe('review_suggestions');
    expect(review.speech).toMatch(/suggested a new routine: Laundry, with 4 steps/);
    const yes = await say(page, 'yes');
    expect(yes.tool).toBe('decide_suggestion');
    expect(yes.isError).toBe(false);
    expect(yes.speech).toMatch(/Laundry is ready/);
  });

  await test.step('"start laundry" starts the new routine with a full prompt', async () => {
    const t = await say(page, 'start laundry');
    expect(t.tool).toBe('start_routine');
    expect(t.data?.run).toMatchObject({ routine_name: 'Laundry', total: 4, status: 'active' });
    expect(t.data?.step).toMatchObject({ index: 1, level: 'full' });
    expect(t.speech).toMatch(/^Let's do your laundry\. Step 1 of 4\./);
    await appReady(page, 'bedroom');
    await expect(activeFrame(page, 'bedroom').locator('button[data-action="done"]')).toBeVisible();
  });

  await test.step('the coach view shows the suggestion as approved', async () => {
    await page.click('.nav a[href="/coach"]');
    await page.click('[data-tab="suggest"]');
    await expect(page.locator('[data-testid="suggestions"]')).toContainText('Approved');
  });
});

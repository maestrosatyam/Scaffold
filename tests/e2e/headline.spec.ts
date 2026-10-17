// AC-16: the simulated surface is a real MCP client. Utterance -> tools/call -> MCP App render, and a
// tap on the card inside the sandboxed iframe goes back through the same MCP client.
import type { Request } from '@playwright/test';
import { activeApp, activeFrame, appReady, expect, open, say, test, turnCount, waitTurnAfter } from './fixtures.ts';

test('headline flow: start, fade to silence, cue, help climbs, kitchen resume, tap Done on the card, finish', async ({ page }) => {
  const mcpPosts: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/mcp') mcpPosts.push(r);
  });

  await open(page, '/');
  await expect(page.locator('[data-room="bedroom"]')).toHaveAttribute('aria-pressed', 'true');

  await test.step('"start my morning" in the bedroom renders the step card (MCP App)', async () => {
    const t = await say(page, 'start my morning');
    expect(t.tool).toBe('start_routine');
    expect(t.isError).toBe(false);
    expect(t.data?.run).toMatchObject({ status: 'active', done: 0, total: 6 });
    // Steps 1 and 2 have faded to independent: the opening line says nothing about them.
    expect(t.data?.step).toMatchObject({ index: 1, level: 'independent' });
    expect(t.speech).toBe("Okay, morning routine. I'm here if you need me.");
    await appReady(page, 'bedroom');
    await expect(activeApp(page, 'bedroom')).toHaveAttribute('data-uri', 'ui://scaffold/step-card.html');
    const iframe = page.locator('[data-room-screen="bedroom"] .screen-layer[data-active="true"] iframe');
    // MCP Apps host contract: the view runs in an opaque-origin sandbox (scripts only).
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  });

  await test.step('independent steps are silent; the dress step gets a cue word', async () => {
    const t1 = await say(page, 'done');
    expect(t1.tool).toBe('step_done');
    expect(t1.data?.step).toMatchObject({ index: 2, level: 'independent' });
    const t2 = await say(page, 'done');
    expect(t2.data?.step).toMatchObject({ index: 3, level: 'cue' });
    expect(t2.speech).toBe('Clothes on the chair.');
  });

  await test.step('Hinglish "ho gaya" counts as done; the bag step gets a short prompt', async () => {
    const t1 = await say(page, 'ho gaya');
    expect(t1.tool).toBe('step_done');
    expect(t1.data?.step?.index).toBe(4);
    const t2 = await say(page, 'done');
    expect(t2.data?.step).toMatchObject({ index: 5, level: 'partial' });
    expect(t2.speech).toBe('Pack your lunch box, bus pass and phone in your bag.');
  });

  await test.step('"help" climbs one rung of support to the full prompt', async () => {
    const t = await say(page, 'help');
    expect(t.tool).toBe('need_help');
    expect(t.data?.step).toMatchObject({ index: 5, level: 'full' });
    expect(t.speech).toMatch(/^Step 5 of 6\. Open your bag\./);
  });

  await test.step('the kitchen display resumes the same run ("where was I?")', async () => {
    await page.click('[data-room="kitchen"]');
    await expect(page.locator('[data-room="kitchen"]')).toHaveAttribute('aria-pressed', 'true');
    const t = await say(page, 'where was I?');
    expect(t.tool).toBe('where_was_i');
    expect(t.speech).toMatch(/^You've done 4 of 6\. Next is pack your bag\./);
    expect(t.data?.step?.index).toBe(5);
    await appReady(page, 'kitchen');
  });

  await test.step('tapping Done on the card (inside the sandboxed iframe) calls step_done via the MCP client', async () => {
    const before = await turnCount(page);
    const callsBefore = mcpPosts.length;
    await activeFrame(page, 'kitchen').locator('button[data-action="done"]').click();
    const t = await waitTurnAfter(page, before);
    expect(t.source).toBe('card');
    expect(t.tool).toBe('step_done');
    expect(t.isError).toBe(false);
    expect(t.speech).toBe('Shoes and keys.');
    expect(t.data?.step).toMatchObject({ index: 6, level: 'cue' });
    // The host proxied the view's tools/call to the server: a new POST /mcp carrying tools/call step_done.
    const proxied = mcpPosts.slice(callsBefore).map((r) => r.postDataJSON());
    expect(proxied).toContainEqual(expect.objectContaining({ method: 'tools/call', params: expect.objectContaining({ name: 'step_done' }) }));
  });

  await test.step('"all done" finishes the run', async () => {
    const t = await say(page, 'all done');
    expect(t.tool).toBe('step_done');
    expect(t.data?.run?.status).toBe('finished');
    expect(t.speech).toMatch(/^Nice, you're done at \d{1,2}:\d{2} [AP]M\. 3 of 6 steps on your own\.$/);
  });

  await test.step('the browser client speaks MCP 2025-11-25 over Streamable HTTP', async () => {
    const init = mcpPosts.map((r) => r.postDataJSON()).find((b) => b?.method === 'initialize');
    expect(init?.params?.protocolVersion).toBe('2025-11-25');
    expect(await page.evaluate(() => window.scaffold.protocolVersion())).toBe('2025-11-25');
    const call = mcpPosts.find((r) => r.postDataJSON()?.method === 'tools/call');
    expect(call?.headers()['mcp-protocol-version']).toBe('2025-11-25');
    const traced = await page.evaluate(() => window.scaffold.trace().filter((e: any) => e.method === 'tools/call').length);
    expect(traced).toBeGreaterThanOrEqual(9);
  });
});

test('typing in the text box goes through the same path as the automation hook', async ({ page }) => {
  await open(page, '/');
  const before = await turnCount(page);
  await page.getByLabel('What Sam says').first().fill('start my morning');
  await page.getByRole('button', { name: 'Say' }).first().click();
  const t = await waitTurnAfter(page, before);
  expect(t.source).toBe('typed');
  expect(t.tool).toBe('start_routine');
  await appReady(page, 'bedroom');
  await expect(page.locator('.rpc.latest .rpc-head').first()).toContainText('start_routine');
});

// Shared fixtures for the simulator E2E suite. Every test gets a fresh browser context (so a fresh
// private demo sandbox), drives the page through the real UI and `window.scaffold` (the automation
// hook in src/web/main.tsx), and fails if the page or any MCP App iframe logs a console error.
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export const SIM_LABEL = 'Simulated Alexa+ surface — not Amazon software';

/** What the tests read back from a turn (a subset of src/web/lib/assistant.ts Turn). */
export interface TurnInfo {
  tool: string | null;
  source: string;
  speech: string;
  silent: boolean;
  isError: boolean;
  /** structuredContent of the tool result (snake_case wire format), if any. */
  data: Record<string, any> | null;
}

interface ScaffoldHook {
  ready: boolean;
  say(text: string, opts?: { room?: 'bedroom' | 'kitchen' }): Promise<any>;
  turns(): any[];
  trace(): any[];
  protocolVersion(): string | undefined;
}

declare global {
  interface Window {
    scaffold: ScaffoldHook;
  }
}

export type Room = 'bedroom' | 'kitchen';

/** Wait until the page has its sandbox and both MCP clients are connected. */
export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.scaffold?.ready === true, null, { timeout: 30_000 });
}

/** Open a page of the simulator (muted, so no speech synthesis) and wait for the MCP session. */
export async function open(page: Page, path = '/'): Promise<void> {
  const url = new URL(path, 'http://x');
  url.searchParams.set('mute', '1');
  await page.goto(url.pathname + url.search);
  await waitReady(page);
}

const toInfo = (t: any): TurnInfo => ({
  tool: t.tool ?? null,
  source: t.source,
  speech: t.speech,
  silent: !!t.silent,
  isError: !!t.result?.isError,
  data: t.result?.structuredContent ?? null,
});

/** One utterance through the same router + MCP client the text box and mic use. */
export async function say(page: Page, text: string): Promise<TurnInfo> {
  const t = await page.evaluate(async (u) => {
    const turn = await window.scaffold.say(u);
    return JSON.parse(JSON.stringify({ tool: turn.tool, source: turn.source, speech: turn.speech, silent: turn.silent, result: turn.result }));
  }, text);
  return toInfo(t);
}

export async function lastTurn(page: Page): Promise<TurnInfo> {
  return toInfo(await page.evaluate(() => JSON.parse(JSON.stringify(window.scaffold.turns().at(-1)))));
}

export async function turnCount(page: Page): Promise<number> {
  return page.evaluate(() => window.scaffold.turns().length);
}

/** Wait until a turn after `before` has completed. */
export async function waitTurnAfter(page: Page, before: number): Promise<TurnInfo> {
  await page.waitForFunction((n) => window.scaffold.turns().length > n && !window.scaffold.turns().at(-1).pending, before, { timeout: 10_000 });
  return lastTurn(page);
}

/** The MCP App host on the active layer of a room's device screen. */
export const activeApp = (page: Page, room: Room) => page.locator(`[data-room-screen="${room}"] .screen-layer[data-active="true"] .apphost`);

/** Wait for the room's active MCP App view to be initialised (AppBridge handshake done). */
export async function appReady(page: Page, room: Room): Promise<void> {
  await expect(activeApp(page, room)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
}

/** The sandboxed iframe of the room's active MCP App view. */
export const activeFrame = (page: Page, room: Room) => page.frameLocator(`[data-room-screen="${room}"] .screen-layer[data-active="true"] iframe`);

/** Run the morning routine to the end by voice ("start my morning", then "done" until finished). */
export async function finishMorning(page: Page): Promise<TurnInfo> {
  let t = await say(page, 'start my morning');
  expect(t.tool).toBe('start_routine');
  for (let i = 0; i < 10 && t.data?.run?.status !== 'finished'; i++) t = await say(page, 'done');
  expect(t.data?.run?.status).toBe('finished');
  return t;
}

export const test = base.extend<{ consoleErrors: string[] }>({
  // Auto fixture: collect console errors / uncaught exceptions from every frame and fail the test on any.
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[console] ${m.text()} (${m.location().url || 'inline'})`);
      });
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
      await use(errors);
      if (errors.length) await testInfo.attach('console-errors', { body: errors.join('\n'), contentType: 'text/plain' });
      expect(errors, 'no console errors or uncaught exceptions').toEqual([]);
    },
    { auto: true },
  ],
});

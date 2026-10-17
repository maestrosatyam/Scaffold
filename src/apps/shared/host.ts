// Thin wrapper around the MCP Apps View API (@modelcontextprotocol/ext-apps `App`):
// connects to the host over postMessage, delivers tool results to the view, proxies button taps
// to server tools, and applies host context (theme, safe areas, container size).
import { App, applyDocumentTheme, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';

type CallResult = Awaited<ReturnType<App['callServerTool']>>;

export class ToolError extends Error {}

export interface ViewOptions<T> {
  name: string;
  /** 'device': always the dark Echo Show look. 'host': follow the host theme (light default). */
  theme: 'device' | 'host';
  onResult(data: T): void;
  /** The host has started a tool call for this view (arguments known, result pending). */
  onPending?(): void;
  /** The host reported a failed or cancelled tool call. */
  onToolError?(message: string): void;
  onContext?(ctx: McpUiHostContext): void;
}

export interface ViewHandle {
  app: App;
  /** Call a server tool through the host and return its structuredContent. Throws ToolError. */
  call<R>(name: string, args: Record<string, unknown>): Promise<R>;
  context(): McpUiHostContext | undefined;
  /** IANA zone for clock times: host-provided, else the browser's own. */
  timeZone(): string | undefined;
  /** Let the model know what the person did on the card (no follow-up turn is triggered). */
  tellModel(text: string): void;
}

export const textOf = (r: { content?: unknown }): string => {
  const blocks = Array.isArray(r.content) ? (r.content as { type?: string; text?: string }[]) : [];
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join(' ')
    .trim();
};

export function connectView<T>(opts: ViewOptions<T>): ViewHandle {
  const app = new App({ name: `scaffold-${opts.name}`, version: '0.1.0' }, {}, { autoResize: true });
  const root = document.documentElement;
  root.dataset.view = opts.name;

  const applyContext = (ctx: McpUiHostContext | undefined) => {
    if (!ctx) return;
    if (opts.theme === 'host') applyDocumentTheme(ctx.theme ?? 'light');
    const s = ctx.safeAreaInsets;
    if (s) for (const side of ['top', 'right', 'bottom', 'left'] as const) root.style.setProperty(`--safe-${side}`, `${s[side]}px`);
    opts.onContext?.(ctx);
  };
  if (opts.theme === 'device') applyDocumentTheme('dark');

  const handle = (r: CallResult) => {
    if (r.isError) opts.onToolError?.(textOf(r) || 'Something went wrong.');
    else if (r.structuredContent) opts.onResult(r.structuredContent as T);
  };
  // Handlers are registered before connect() so the first notifications are never missed.
  app.addEventListener('toolinput', () => opts.onPending?.());
  app.addEventListener('toolresult', (r) => handle(r as CallResult));
  app.addEventListener('toolcancelled', () => opts.onToolError?.('That was cancelled.'));
  app.addEventListener('hostcontextchanged', () => applyContext(app.getHostContext()));
  app.onteardown = async () => ({});

  app
    .connect()
    .then(() => applyContext(app.getHostContext()))
    .catch((err: unknown) => console.warn('[scaffold] could not connect to the MCP Apps host', err));

  return {
    app,
    async call<R>(name: string, args: Record<string, unknown>): Promise<R> {
      let r: CallResult;
      try {
        r = await app.callServerTool({ name, arguments: args });
      } catch (err) {
        throw new ToolError(err instanceof Error && err.message ? "Sorry, I couldn't reach Scaffold. Try again, or just say it." : String(err));
      }
      if (r.isError) throw new ToolError(textOf(r) || 'Something went wrong.');
      return r.structuredContent as R;
    },
    context: () => app.getHostContext(),
    timeZone: () => app.getHostContext()?.timeZone,
    tellModel(text: string) {
      if (!app.getHostCapabilities()?.updateModelContext) return;
      app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => undefined);
    },
  };
}

/** Marks the document as rendered (used by the dev harness and screenshot script). */
export function markRendered(state: string): void {
  document.documentElement.dataset.rendered = state;
}

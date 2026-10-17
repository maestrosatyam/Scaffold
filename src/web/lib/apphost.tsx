// MCP Apps host: renders a server's ui:// view (read via resources/read) in a sandboxed iframe,
// talks to it with AppBridge over postMessage, sends it the tool input + result, and proxies the
// view's own tools/call requests back to the server through the SAME MCP client. So a tap on the
// card's "Done" button is a real MCP call that shows up in the trace and advances dialogue state.

import { AppBridge, PostMessageTransport, type McpUiHostCapabilities, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScaffoldMcp } from './mcp.ts';

const HOST_INFO = { name: 'scaffold-simulator', version: '0.1.0' };

export interface AppHostProps {
  mcp: ScaffoldMcp;
  uri: string;
  title: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: CallToolResult | null;
  /** Bump to re-send a result even when it is structurally identical. */
  resultSeq?: number;
  theme: 'light' | 'dark';
  /** Fixed size (device screens). Omit height to size the iframe from the view's size-changed notifications. */
  width?: number;
  height?: number;
  minHeight?: number;
  surface: 'device' | 'coach' | 'replay';
  readOnly?: boolean;
  timeZone?: string;
  onCallTool?: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  onMessage?: (text: string) => void;
  /** Hidden hosts stay mounted (and initialised) so switching views never reloads an iframe. */
  hidden?: boolean;
}

type Status = 'loading' | 'ready' | 'error';

export function AppHost(props: AppHostProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const bridgeRef = useRef<AppBridge | null>(null);
  const readyRef = useRef(false);
  const sentRef = useRef<CallToolResult | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [autoHeight, setAutoHeight] = useState<number | null>(null);

  const flush = async () => {
    const b = bridgeRef.current;
    const p = live.current;
    if (!b || !readyRef.current || !p.result || sentRef.current === p.result) return;
    sentRef.current = p.result;
    try {
      await b.sendToolInput({ arguments: p.toolArgs ?? {} });
      await b.sendToolResult(p.result);
    } catch (err) {
      console.warn('[apphost] failed to deliver tool result', err);
    }
  };

  useEffect(() => {
    const box = boxRef.current!;
    let disposed = false;
    const p = live.current;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', p.title);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.className = 'apphost-frame';
    box.appendChild(iframe);

    const fixed = p.height !== undefined;
    const ctx: McpUiHostContext = {
      theme: p.theme,
      displayMode: 'inline',
      availableDisplayModes: ['inline'],
      containerDimensions: fixed ? { width: p.width ?? 768, height: p.height! } : { maxWidth: p.width ?? 420 },
      locale: 'en-US',
      timeZone: p.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: 'web',
      userAgent: 'scaffold-simulator/0.1 (simulated Alexa+ surface)',
      deviceCapabilities: p.surface === 'device' ? { touch: true, hover: false } : { touch: false, hover: true },
      ...(p.toolName && p.mcp.tools.get(p.toolName) ? { toolInfo: { tool: p.mcp.tools.get(p.toolName)! } } : {}),
      'scaffold/surface': p.surface,
      'scaffold/readOnly': !!p.readOnly,
    };
    const caps: McpUiHostCapabilities = { serverTools: {}, serverResources: {}, logging: {}, message: { text: {} } };
    const bridge = new AppBridge(null, HOST_INFO, caps, { hostContext: ctx });
    bridgeRef.current = bridge;

    bridge.oncalltool = async (params) => {
      const cur = live.current;
      if (cur.readOnly || !cur.onCallTool) {
        return { isError: true, content: [{ type: 'text', text: 'This view is a read-only replay.' }] };
      }
      return cur.onCallTool(params.name, (params.arguments ?? {}) as Record<string, unknown>);
    };
    bridge.onreadresource = async (params) => live.current.mcp.client.readResource(params);
    bridge.onlistresources = async (params) => live.current.mcp.client.listResources(params);
    bridge.onmessage = async (params) => {
      const text = params.content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join(' ')
        .trim();
      if (text && live.current.onMessage && !live.current.readOnly) live.current.onMessage(text);
      return {};
    };
    bridge.onopenlink = async () => ({ isError: true });
    bridge.onrequestdisplaymode = async () => ({ mode: 'inline' });
    bridge.onupdatemodelcontext = async () => ({});
    bridge.onloggingmessage = (m) => console.debug('[mcp-app]', live.current.uri, m.level, m.data);
    bridge.addEventListener('sizechange', ({ height }) => {
      if (live.current.height === undefined && typeof height === 'number' && height > 0) setAutoHeight(Math.ceil(height));
    });
    bridge.addEventListener('initialized', () => {
      readyRef.current = true;
      sentRef.current = null;
      setStatus('ready');
      void flush();
    });

    (async () => {
      try {
        const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!);
        await bridge.connect(transport);
        const res = await p.mcp.readUi(p.uri, 'system');
        if (disposed) return;
        iframe.srcdoc = res.html;
      } catch (err) {
        if (disposed) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      readyRef.current = false;
      bridgeRef.current = null;
      const b = bridge;
      void Promise.race([b.teardownResource({}).catch(() => undefined), new Promise((r) => setTimeout(r, 150))]).finally(() => {
        void b.close().catch(() => undefined);
        iframe.remove();
      });
    };
  }, [props.uri, props.mcp]);

  useEffect(() => {
    void flush();
  }, [props.result, props.resultSeq]);

  const h = props.height ?? Math.max(props.minHeight ?? 120, autoHeight ?? props.minHeight ?? 120);
  return (
    <div
      class={`apphost apphost--${props.theme} ${props.hidden ? 'apphost--hidden' : ''}`}
      style={{ width: props.width ? `${props.width}px` : '100%', height: `${h}px` }}
      data-uri={props.uri}
      data-status={status}
      aria-hidden={props.hidden ? 'true' : undefined}
    >
      <div ref={boxRef} class="apphost-box" />
      {status === 'loading' && !props.hidden && (
        <div class="apphost-loading" aria-live="polite">
          <span class="spinner" aria-hidden="true" />
          <span>Loading {props.title}…</span>
        </div>
      )}
      {status === 'error' && (
        <div class="apphost-error" role="alert">
          <strong>Could not load the MCP App view</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

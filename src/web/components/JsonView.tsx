// Collapsible, syntax-coloured JSON viewer for the JSON-RPC trace.
import { useState } from 'preact/hooks';

const MAX_STR = 220;

function Str({ v }: { v: string }) {
  const [full, setFull] = useState(false);
  if (v.length <= MAX_STR || full) return <span class="s">{JSON.stringify(v)}</span>;
  return (
    <span class="s">
      {JSON.stringify(v.slice(0, MAX_STR))}
      <button class="more" onClick={() => setFull(true)}>
        … +{v.length - MAX_STR} chars
      </button>
    </span>
  );
}

function Node({ k, v, depth, open: openDefault, last }: { k?: string; v: unknown; depth: number; open: number; last: boolean }) {
  const [open, setOpen] = useState(depth < openDefault);
  const key = k !== undefined ? (
    <>
      <span class="k">{JSON.stringify(k)}</span>
      <span class="p">: </span>
    </>
  ) : null;
  const comma = last ? null : <span class="p">,</span>;
  if (v === null || typeof v !== 'object') {
    const cls = typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : 'b';
    return (
      <li>
        {key}
        {typeof v === 'string' ? <Str v={v} /> : <span class={cls}>{String(v)}</span>}
        {comma}
      </li>
    );
  }
  const isArr = Array.isArray(v);
  const entries = isArr ? (v as unknown[]).map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
  const [o, c] = isArr ? ['[', ']'] : ['{', '}'];
  if (!entries.length)
    return (
      <li>
        {key}
        <span class="p">{o + c}</span>
        {comma}
      </li>
    );
  return (
    <li>
      <button class="tw" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'}
      </button>
      {key}
      <span class="p">{o}</span>
      {open ? (
        <ul>
          {entries.map(([ek, ev], i) => (
            <Node key={ek} k={isArr ? undefined : ek} v={ev} depth={depth + 1} open={openDefault} last={i === entries.length - 1} />
          ))}
        </ul>
      ) : (
        <button class="more" onClick={() => setOpen(true)}>
          {' '}
          {isArr ? `${entries.length} items` : entries.map(([x]) => x).slice(0, 4).join(', ') + (entries.length > 4 ? ', …' : '')}{' '}
        </button>
      )}
      <span class="p">{c}</span>
      {comma}
    </li>
  );
}

export function JsonView({ value, open = 2 }: { value: unknown; open?: number }) {
  return (
    <div class="json">
      <ul style={{ paddingLeft: 0 }}>
        <Node v={value} depth={0} open={open} last />
      </ul>
    </div>
  );
}

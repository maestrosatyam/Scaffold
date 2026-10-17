// Presentation mode for the demo-video recording (?record=1). The recording drives the page
// through window.scaffold, so the input bar is hidden and the live captions are a little larger
// (styles in app.css under html[data-record]). Nothing else changes: same MCP client, same server.

/** True when the URL asks for presentation mode: `?record`, `?record=1`, `?record=true`. */
export function recordModeFrom(search: string): boolean {
  const v = new URLSearchParams(search).get('record');
  return v !== null && v !== '0' && v.toLowerCase() !== 'false';
}

/** Mark (or unmark) the document root so the record-mode CSS applies. */
export function applyRecordMode(root: { dataset: DOMStringMap }, on: boolean): void {
  if (on) root.dataset.record = 'true';
  else delete root.dataset.record;
}

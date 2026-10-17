// Deterministic date/time formatting (fixed 'en-US' locale; zone from the host when known).

const fmt = (opts: Intl.DateTimeFormatOptions, timeZone?: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, ...(timeZone ? { timeZone } : {}) });
  } catch {
    return new Intl.DateTimeFormat('en-US', opts); // unknown zone: fall back to the browser's
  }
};

/** "7:24 AM" */
export const clockTime = (iso: string, timeZone?: string): string => fmt({ hour: 'numeric', minute: '2-digit' }, timeZone).format(new Date(iso));

/** "Oct 17" */
export const shortDate = (iso: string, timeZone?: string): string => fmt({ month: 'short', day: 'numeric' }, timeZone).format(new Date(iso));

/** "Sat, Oct 17" */
export const dayDate = (iso: string, timeZone?: string): string =>
  fmt({ weekday: 'short', month: 'short', day: 'numeric' }, timeZone).format(new Date(iso));

export const minutesBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

/** First name of a "Priya (occupational therapist)" style display name. */
export const personName = (displayName: string): { name: string; role: string | null } => {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(displayName);
  return m ? { name: m[1]!, role: m[2]! } : { name: displayName, role: null };
};

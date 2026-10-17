// Small inline icon set (stroke icons drawn for this project).
type P = { size?: number; title?: string };
const svg = (size: number, children: preact.ComponentChildren, title?: string) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
    {title && <title>{title}</title>}
    {children}
  </svg>
);

export const MicIcon = ({ size = 22, title }: P) =>
  svg(size, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>, title);
export const SendIcon = ({ size = 18 }: P) => svg(size, <><path d="M4 12h14" /><path d="m13 6 6 6-6 6" /></>);
export const SpeakerIcon = ({ size = 20 }: P) => svg(size, <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>);
export const MuteIcon = ({ size = 20 }: P) => svg(size, <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>);
export const ChevronIcon = ({ size = 16, dir = 'right' }: P & { dir?: 'right' | 'left' | 'down' }) =>
  svg(size, <path d={dir === 'right' ? 'm9 6 6 6-6 6' : dir === 'left' ? 'm15 6-6 6 6 6' : 'm6 9 6 6 6-6'} />);
export const InfoIcon = ({ size = 15 }: P) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>);
export const PlayIcon = ({ size = 16 }: P) => svg(size, <path d="M7 5v14l11-7z" fill="currentColor" />);
export const RefreshIcon = ({ size = 15 }: P) => svg(size, <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></>);
export const BedIcon = ({ size = 16 }: P) => svg(size, <><path d="M3 18v-8" /><path d="M21 18v-5a3 3 0 0 0-3-3h-8v5" /><path d="M3 15h18" /><circle cx="6.5" cy="11.5" r="1.5" /></>);
export const KitchenIcon = ({ size = 16 }: P) => svg(size, <><path d="M7 3v8" /><path d="M4.5 3v4a2.5 2.5 0 0 0 5 0V3" /><path d="M7 11v10" /><path d="M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" /></>);

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg class="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="5" width="24" height="5" rx="2.5" fill="#2ec4b6" />
      <rect x="4" y="13.5" width="17" height="5" rx="2.5" fill="#2ec4b6" fill-opacity=".65" />
      <rect x="4" y="22" width="10" height="5" rx="2.5" fill="#2ec4b6" fill-opacity=".35" />
    </svg>
  );
}

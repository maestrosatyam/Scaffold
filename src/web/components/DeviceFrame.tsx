// A generic smart-display frame (no vendor trade dress) around an exactly 768x480 CSS-px screen,
// scaled as a whole to fit its container so the MCP App inside always renders at native size.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export const SCREEN_W = 768;
export const SCREEN_H = 480;
const FRAME_W = SCREEN_W + 48;
const FRAME_H = SCREEN_H + 58 + 16; // bezel + stand

export interface DeviceFrameProps {
  children: ComponentChildren;
  voice?: 'idle' | 'listening' | 'speaking';
  chin?: ComponentChildren;
  maxScale?: number;
  /** Fixed scale (skips measuring), e.g. for the time-machine grid. */
  scale?: number;
  label?: string;
}

export function DeviceFrame({ children, voice = 'idle', chin, maxScale = 1.25, scale: fixedScale, label }: DeviceFrameProps) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(fixedScale ?? 0);

  useLayoutEffect(() => {
    if (fixedScale !== undefined) return;
    const el = outer.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(maxScale, r.width / FRAME_W, r.height / FRAME_H);
      setScale(Math.max(0.3, Math.floor(s * 1000) / 1000));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedScale, maxScale]);

  const s = fixedScale ?? scale;
  return (
    <div ref={outer} class="device-fit" style={{ width: `${FRAME_W * s}px`, height: `${FRAME_H * s}px`, opacity: s ? 1 : 0 }}>
      <div class="device-fit-inner" style={{ transform: `scale(${s})`, width: `${FRAME_W}px` }}>
        <div class="device" data-voice={voice}>
          <span class="device-camera" aria-hidden="true" />
          <div class="device-screen" role="region" aria-label={label ?? 'Device screen'}>
            {children}
          </div>
          <div class="device-chin">{chin}</div>
        </div>
        <div class="device-stand" aria-hidden="true" />
      </div>
    </div>
  );
}

export function VoiceWave() {
  return (
    <span class="voice-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

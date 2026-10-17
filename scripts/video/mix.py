"""Mix the voice track of the demo video from the take's timeline.

  $VENV/bin/python -I scripts/video/mix.py [ASSETS_DIR]

Reads  ASSETS/build/timeline.json (from the take) and ASSETS/build/audio/manifest.json
Writes ASSETS/build/voice.wav  (mono, 24 kHz; loudness-normalised to -16 LUFS later by ffmpeg)

Every voiced line is placed at the time the take logged for it. A line the take cut short (Sam
tapped Done mid-sentence) is played only up to that point, with a short fade.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

ASSETS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '../../../submission/VIDEO_ASSETS'))
BUILD = os.path.join(ASSETS, 'build')
SR = 24000
TARGET_DBFS = -20.0  # active-speech RMS per clip before the final loudness normalisation
GAIN_DB = {'narrator': 0.0, 'assistant': -0.5, 'sam': -1.0}


def active_rms(x: np.ndarray) -> float:
    frame = int(0.02 * SR)
    n = len(x) // frame
    if n == 0:
        return float(np.sqrt(np.mean(x ** 2)) + 1e-9)
    f = x[: n * frame].reshape(n, frame)
    e = np.sqrt(np.mean(f ** 2, axis=1))
    thr = max(1e-4, np.percentile(e, 95) * 0.1)
    act = e[e > thr]
    return float(np.sqrt(np.mean(act ** 2)) + 1e-9) if len(act) else float(np.sqrt(np.mean(x ** 2)) + 1e-9)


def main() -> None:
    tl = json.load(open(os.path.join(BUILD, 'timeline.json')))
    total = int((tl['duration'] + 1.0) * SR)
    out = np.zeros(total, dtype=np.float64)
    spans = []
    for e in tl['events']:
        if e.get('type') != 'line' or e.get('muted') or not e.get('file'):
            continue
        y, sr = sf.read(os.path.join(BUILD, e['file']), dtype='float64')
        assert sr == SR, (e['file'], sr)
        n = min(len(y), int(round(e['dur'] * SR)))
        clip = y[:n].copy()
        fi = int(0.005 * SR)
        clip[:fi] *= np.linspace(0, 1, fi)
        if e.get('cut'):
            fo = min(n, int(0.09 * SR))
            clip[n - fo:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, fo)))
        g = 10 ** ((TARGET_DBFS + GAIN_DB[e['who']]) / 20) / active_rms(clip)
        clip *= g
        # Gentle soft clip on the rare loud peaks so the final loudness pass can stay linear.
        lim = 0.6
        if np.max(np.abs(clip)) > lim:
            clip = lim * np.tanh(clip / lim)
        a = int(round(e['t'] * SR))
        if a < 0:
            clip, a = clip[-a:], 0
        b = min(total, a + len(clip))
        out[a:b] += clip[: b - a]
        spans.append((e['t'], e['t'] + n / SR, e['who'], e['text'][:40]))
    spans.sort()
    for (a0, a1, w0, t0), (b0, b1, w1, t1) in zip(spans, spans[1:]):
        if b0 < a1 - 0.02:
            print(f'overlap {a1 - b0:.2f}s at {b0:.2f}s: {w0} "{t0}" / {w1} "{t1}"')
    peak = np.max(np.abs(out))
    if peak > 0.95:
        out *= 0.95 / peak
    sf.write(os.path.join(BUILD, 'voice.wav'), out.astype(np.float32), SR, subtype='FLOAT')
    print(f'voice.wav: {total / SR:.2f}s, {len(spans)} clips, peak {peak:.2f}')


if __name__ == '__main__':
    main()

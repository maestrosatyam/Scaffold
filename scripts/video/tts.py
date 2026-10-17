"""Synthesize every voice line of the demo video with Kokoro-82M (kokoro-onnx, Apache-2.0).

  $VENV/bin/python -I scripts/video/tts.py [ASSETS_DIR]

Reads  ASSETS/build/lines.json   (written by `node scripts/record-demo.mjs --dry`)
Writes ASSETS/build/audio/*.wav  + ASSETS/build/audio/manifest.json
       {"<voice>|<text>": {"file", "ms", "sentenceEnds": [ms, ...], "voice", "kokoroVoice"}}

Each line is synthesized sentence by sentence (so a line can be cut cleanly at a sentence end,
e.g. when Sam taps Done mid-sentence), silence-trimmed and joined with a fixed pause.
The text shown in captions is the line's `text`; only the TTS input is normalised
(times like 7:25 AM, "Alexa+", quotes) so the voice reads it naturally.
"""
import hashlib
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ASSETS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '../../../submission/VIDEO_ASSETS'))
BUILD = os.path.join(ASSETS, 'build')
OUT = os.path.join(BUILD, 'audio')
MODELS = os.path.join(ASSETS, 'tools/models')
os.makedirs(OUT, exist_ok=True)

# Three distinct Kokoro voices. The assistant voice is "the simulated assistant voice" — it is not
# Alexa and not any Amazon voice.
VOICES = {
    'narrator': {'voice': 'am_michael', 'lang': 'en-us', 'speed': 1.1, 'pause': 0.3},
    'assistant': {'voice': 'af_heart', 'lang': 'en-us', 'speed': 0.97, 'pause': 0.26},
    'sam': {'voice': 'am_fenrir', 'lang': 'en-us', 'speed': 0.95, 'pause': 0.22},
}
# Phoneme fixes applied after espeak phonemization (name pronunciations).
PHONEME_FIXES = [('pɹˈɪjə', 'pɹˈiːjə')]  # Priya: PREE-yah
VERSION = 'kokoro-v1.0.int8|2'


def tts_text(s: str) -> str:
    s = s.replace('’', "'").replace('‘', "'").replace('“', '').replace('”', '').replace('"', '')
    s = re.sub(r'\b(\d{1,2}):(\d{2})\s*(AM|PM)\b', lambda m: f"{m.group(1)} {m.group(2)} {m.group(3)}", s)
    s = s.replace('Alexa+', 'Alexa plus')
    return s


def sentences(s: str) -> list[str]:
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9])', s.strip())
    return [p for p in parts if p]


def trim(x: np.ndarray, sr: int, thr: float = 0.006, keep: float = 0.03) -> np.ndarray:
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - int(keep * sr))
    b = min(len(x), idx[-1] + int(keep * sr * 2))
    return x[a:b]


def main() -> None:
    lines = json.load(open(os.path.join(BUILD, 'lines.json')))
    k = Kokoro(os.path.join(MODELS, 'kokoro-v1.0.int8.onnx'), os.path.join(MODELS, 'voices-v1.0.bin'))
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    made = 0
    for ln in lines:
        cfg = VOICES[ln['voice']]
        src = tts_text(ln.get('tts') or ln['text'])
        h = hashlib.sha1(f"{VERSION}|{cfg['voice']}|{cfg['speed']}|{cfg['pause']}|{src}".encode()).hexdigest()[:16]
        name = f"{ln['voice']}-{h}.wav"
        path = os.path.join(OUT, name)
        key = f"{ln['voice']}|{ln['text']}"
        if os.path.exists(path) and key in manifest and manifest[key]['file'] == f'audio/{name}':
            continue
        sr = 24000
        chunks, ends, t = [np.zeros(int(0.03 * sr), dtype=np.float32)], [], 0.03
        for i, sent in enumerate(sentences(src)):
            ph = k.tokenizer.phonemize(sent, cfg['lang'])
            for a, b in PHONEME_FIXES:
                ph = ph.replace(a, b)
            audio, sr = k.create(ph, voice=cfg['voice'], speed=cfg['speed'], lang=cfg['lang'], is_phonemes=True)
            audio = trim(audio.astype(np.float32), sr)
            if i:
                chunks.append(np.zeros(int(cfg['pause'] * sr), dtype=np.float32))
                t += cfg['pause']
            chunks.append(audio)
            t += len(audio) / sr
            ends.append(round(t * 1000))
        chunks.append(np.zeros(int(0.06 * sr), dtype=np.float32))
        y = np.concatenate(chunks)
        sf.write(path, y, sr, subtype='PCM_16')
        manifest[key] = {'file': f'audio/{name}', 'ms': round(len(y) / sr * 1000), 'sentenceEnds': ends, 'voice': ln['voice'], 'kokoroVoice': cfg['voice'], 'ttsText': src}
        made += 1
        print(f"{ln['voice']:9s} {manifest[key]['ms'] / 1000:6.2f}s  {ln['text'][:80]}")
    # Drop manifest entries for lines no longer in the story, and their WAVs.
    keep = {f"{ln['voice']}|{ln['text']}" for ln in lines}
    for key in [x for x in manifest if x not in keep]:
        del manifest[key]
    used = {v['file'] for v in manifest.values()}
    for f in os.listdir(OUT):
        if f.endswith('.wav') and f'audio/{f}' not in used:
            os.remove(os.path.join(OUT, f))
    json.dump(manifest, open(man_path, 'w'), indent=1, ensure_ascii=False)
    total = {v: round(sum(m['ms'] for key, m in manifest.items() if m['voice'] == v and 'done at' not in key) / 1000, 1) for v in VOICES}
    print(f'synthesized {made} new lines; {len(manifest)} in manifest; seconds per voice (excluding finish-time variants): {total}')


if __name__ == '__main__':
    main()

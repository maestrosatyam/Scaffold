import { describe, expect, it } from 'vitest';
import { recognitionErrorMessage } from './voice.ts';

describe('recognitionErrorMessage', () => {
  it('stays quiet when the person simply said nothing or stopped', () => {
    expect(recognitionErrorMessage('no-speech')).toBeNull();
    expect(recognitionErrorMessage('aborted')).toBeNull();
  });

  it('explains a browser without a speech service instead of showing "network"', () => {
    const msg = recognitionErrorMessage('network')!;
    expect(msg).not.toMatch(/error: network/);
    expect(msg).toMatch(/Chrome, Edge or Safari/);
    expect(msg).toMatch(/type instead/);
  });

  it('always offers typing as the way forward', () => {
    for (const code of ['audio-capture', 'service-not-allowed', 'bad-grammar']) expect(recognitionErrorMessage(code)).toMatch(/type instead/i);
  });
});

import { describe, expect, it } from 'vitest';
import { applyRecordMode, recordModeFrom } from './present.ts';

describe('record (presentation) mode', () => {
  it('is on only when the URL asks for it', () => {
    expect(recordModeFrom('')).toBe(false);
    expect(recordModeFrom('?mute=1')).toBe(false);
    expect(recordModeFrom('?record=0')).toBe(false);
    expect(recordModeFrom('?record=false')).toBe(false);
    expect(recordModeFrom('?record=1')).toBe(true);
    expect(recordModeFrom('?record')).toBe(true);
    expect(recordModeFrom('?layout=split&record=true')).toBe(true);
  });

  it('marks and unmarks the document root', () => {
    const root = { dataset: {} as DOMStringMap };
    applyRecordMode(root, true);
    expect(root.dataset.record).toBe('true');
    applyRecordMode(root, false);
    expect(root.dataset.record).toBeUndefined();
  });
});

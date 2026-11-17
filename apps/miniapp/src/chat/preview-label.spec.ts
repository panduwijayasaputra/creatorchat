import { describe, expect, it } from 'vitest';
import { previewLabel } from './preview-label';

describe('previewLabel', () => {
  it('keeps text, and names a media-only message', () => {
    expect(previewLabel('Halo', null)).toBe('Halo');
    expect(previewLabel('Halo', 'VIDEO')).toBe('Halo');
    expect(previewLabel('', 'PHOTO')).toBe('Foto');
    expect(previewLabel('', 'VIDEO')).toBe('Video');
    expect(previewLabel('', null)).toBe('');
  });
});

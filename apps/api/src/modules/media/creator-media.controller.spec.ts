import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { CreatorMediaController } from './creator-media.controller.js';
import { parseRange } from './dev-storage.controller.js';

describe('CreatorMediaController without storage', () => {
  it('answers 503 SERVICE_UNAVAILABLE instead of crashing', () => {
    const controller = new CreatorMediaController(null);
    try {
      controller.limits();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).httpStatus).toBe(503);
      expect((error as AppError).code).toBe('SERVICE_UNAVAILABLE');
    }
  });
});

describe('parseRange', () => {
  it('parses closed, open and suffix ranges and clamps the end', () => {
    expect(parseRange('bytes=2-5', 100)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('refuses unsatisfiable or malformed ranges', () => {
    expect(parseRange('bytes=100-200', 100)).toBeNull();
    expect(parseRange('bytes=5-2', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('items=1-2', 100)).toBeNull();
    expect(parseRange('bytes=1-2,5-6', 100)).toBeNull();
  });
});

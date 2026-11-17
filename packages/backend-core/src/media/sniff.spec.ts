import { describe, expect, it } from 'vitest';
import { sniffMediaType } from './sniff.js';

const ftyp = (brand: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftyp'),
    Buffer.from(brand),
    Buffer.alloc(8),
  ]);

describe('sniffMediaType', () => {
  it('recognises the three photo formats', () => {
    expect(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({
      kind: 'PHOTO',
      mime: 'image/jpeg',
    });
    expect(
      sniffMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toEqual({ kind: 'PHOTO', mime: 'image/png' });
    expect(
      sniffMediaType(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]),
      ),
    ).toEqual({ kind: 'PHOTO', mime: 'image/webp' });
  });

  it('tells QuickTime from MP4 by the ftyp brand', () => {
    expect(sniffMediaType(ftyp('qt  '))).toEqual({ kind: 'VIDEO', mime: 'video/quicktime' });
    for (const brand of ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'hvc1']) {
      expect(sniffMediaType(ftyp(brand))).toEqual({ kind: 'VIDEO', mime: 'video/mp4' });
    }
  });

  it('refuses a renamed text file, a RIFF file that is not WebP, and truncated buffers', () => {
    expect(sniffMediaType(Buffer.from('hello, this is not a photo'))).toBeNull();
    expect(
      sniffMediaType(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]),
      ),
    ).toBeNull();
    expect(sniffMediaType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffMediaType(Buffer.alloc(0))).toBeNull();
    expect(sniffMediaType(Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
  });
});

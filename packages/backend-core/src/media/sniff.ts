export interface SniffedMedia {
  kind: 'PHOTO' | 'VIDEO';
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime';
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b);

/**
 * What the first bytes of a file really are (never the client's claim). Photos: JPEG, PNG, WebP.
 * Videos: ISO base media files (`ftyp` at offset 4), QuickTime when the brand is `qt  `. Anything
 * else, or a buffer too short to tell, is `null`.
 */
export function sniffMediaType(head: Buffer): SniffedMedia | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: 'PHOTO', mime: 'image/jpeg' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'PHOTO', mime: 'image/png' };
  }
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: 'PHOTO', mime: 'image/webp' };
  }
  if (head.length >= 12 && startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = head.subarray(8, 12).toString('latin1');
    return { kind: 'VIDEO', mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  return null;
}

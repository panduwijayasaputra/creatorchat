/**
 * The line a list shows for a message: its text, or for a message that is only a photo or video the
 * word "Foto" / "Video". design gap: the boards show text previews only.
 */
export function previewLabel(preview: string, mediaKind: 'PHOTO' | 'VIDEO' | null): string {
  if (preview !== '') return preview;
  return mediaKind === 'VIDEO' ? 'Video' : mediaKind === 'PHOTO' ? 'Foto' : '';
}

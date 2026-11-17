import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GalleryTile } from './GalleryTile';

afterEach(cleanup);

describe('GalleryTile', () => {
  it('shows a photo thumbnail, and "Baru" when new', () => {
    const { container } = render(
      <GalleryTile
        state="ready"
        kind="PHOTO"
        thumbnailUrl="https://x.test/t.webp"
        isNew
        label="Foto"
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x.test/t.webp');
    expect(screen.getByText('Baru')).toBeInTheDocument();
    expect(screen.queryByText(/\d:\d\d/)).toBeNull();
  });

  it('shows the duration badge on a video only', () => {
    render(
      <GalleryTile
        state="ready"
        kind="VIDEO"
        thumbnailUrl={null}
        durationSeconds={72}
        label="Video"
      />,
    );
    expect(screen.getByText('1:12')).toBeInTheDocument();
  });

  it('renders no image element, only a placeholder, without a thumbnail', () => {
    const { container } = render(
      <GalleryTile state="ready" kind="PHOTO" thumbnailUrl={null} label="Foto" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('tile-placeholder')).toBeInTheDocument();
  });

  it('is a button only when it can be opened, and reports it', () => {
    const open = vi.fn();
    const { rerender } = render(
      <GalleryTile state="ready" kind="PHOTO" thumbnailUrl={null} label="Buka foto" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <GalleryTile
        state="ready"
        kind="PHOTO"
        thumbnailUrl={null}
        label="Buka foto"
        onOpen={open}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buka foto' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('reflects selection and a failing thumbnail', () => {
    const onError = vi.fn();
    const { container } = render(
      <GalleryTile
        state="ready"
        kind="PHOTO"
        thumbnailUrl="https://x.test/t.webp"
        label="Foto"
        selected
        onOpen={() => undefined}
        onThumbnailError={onError}
      />,
    );
    expect(screen.getByRole('button', { name: 'Foto' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('shows upload progress as a progressbar with the percentage', () => {
    render(<GalleryTile state="uploading" progress={64} />);
    const bar = screen.getByRole('progressbar', { name: 'Mengunggah' });
    expect(bar).toHaveAttribute('aria-valuenow', '64');
    expect(screen.getByText('64%')).toBeInTheDocument();
  });

  it('clamps progress to 0..100', () => {
    render(<GalleryTile state="uploading" progress={140} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows Gagal and Coba Lagi, and retries on click', () => {
    const retry = vi.fn();
    render(<GalleryTile state="failed" onRetry={retry} />);
    expect(screen.getByText('Gagal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unggahan gagal. Coba lagi' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText('Coba Lagi')).toBeInTheDocument();
  });

  it('uses a 4:5 frame in the portrait grid', () => {
    render(
      <GalleryTile state="ready" kind="PHOTO" thumbnailUrl={null} label="Foto" aspect="portrait" />,
    );
    expect(screen.getByRole('img', { name: 'Foto' }).className).toMatch(/portrait/);
  });
});

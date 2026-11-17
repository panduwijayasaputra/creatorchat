import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaViewer } from './MediaViewer';

afterEach(cleanup);

describe('MediaViewer', () => {
  it('shows a photo with the position and footer, and closes', () => {
    const onClose = vi.fn();
    const { container } = render(
      <MediaViewer
        kind="PHOTO"
        src="https://x.test/p.jpg"
        positionLabel="1 / 12"
        onClose={onClose}
        footer="Diunggah 12 Nov 2026, 06.41 WIB"
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x.test/p.jpg');
    expect(screen.getByText('1 / 12')).toBeInTheDocument();
    expect(screen.getByText('Diunggah 12 Nov 2026, 06.41 WIB')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows navigation only where there is somewhere to go', () => {
    const next = vi.fn();
    const { rerender } = render(
      <MediaViewer
        kind="PHOTO"
        src="x"
        positionLabel="1 / 2"
        onClose={() => undefined}
        onNext={next}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Media sebelumnya' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Media berikutnya' }));
    expect(next).toHaveBeenCalledOnce();
    rerender(
      <MediaViewer
        kind="PHOTO"
        src="x"
        positionLabel="2 / 2"
        onClose={() => undefined}
        onPrevious={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Media sebelumnya' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Media berikutnya' })).toBeNull();
  });

  it('reports a failing photo, and shows children instead of media without a link', () => {
    const onError = vi.fn();
    const { container, rerender } = render(
      <MediaViewer
        kind="PHOTO"
        src="x"
        positionLabel="1 / 1"
        onClose={() => undefined}
        onMediaError={onError}
      />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(onError).toHaveBeenCalledOnce();
    rerender(
      <MediaViewer kind="PHOTO" src={null} positionLabel="" onClose={() => undefined}>
        <span>Pesan</span>
      </MediaViewer>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Pesan')).toBeInTheDocument();
  });

  it('seeks a video through the position control', () => {
    const { container } = render(
      <MediaViewer
        kind="VIDEO"
        src="v.mp4"
        durationSeconds={48}
        positionLabel="2 / 3"
        onClose={() => undefined}
      />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    fireEvent.change(screen.getByLabelText('Posisi video'), { target: { value: '18' } });
    expect(video.currentTime).toBe(18);
    expect(screen.getByText('0:18')).toBeInTheDocument();
  });
});

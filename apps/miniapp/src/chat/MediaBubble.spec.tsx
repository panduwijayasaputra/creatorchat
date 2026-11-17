import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bubble } from './ChatThread';
import { MediaBubble } from './MediaBubble';

afterEach(cleanup);

const photo = {
  kind: 'PHOTO' as const,
  duration_seconds: null,
  thumbnail_url: 'https://x.test/t.webp',
};
const video = {
  kind: 'VIDEO' as const,
  duration_seconds: 48,
  thumbnail_url: 'https://x.test/p.webp',
};

describe('MediaBubble', () => {
  it('shows a photo with its message and time, without a duration', () => {
    const { container } = render(
      <MediaBubble attachment={photo} body="Ini tepungnya" mine time="09.25" />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x.test/t.webp');
    expect(screen.getByText('Ini tepungnya')).toBeInTheDocument();
    expect(screen.getByText('09.25')).toBeInTheDocument();
    expect(screen.queryByText(/\d:\d\d/)).toBeNull();
  });

  it('shows a video poster with its length and no text when there is none', () => {
    render(<MediaBubble attachment={video} body={null} mine={false} time="09.25" />);
    expect(screen.getByText('0:48')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Video' })).toBeInTheDocument();
  });

  it('is a button only when it can be opened, and a failing thumbnail is reported', () => {
    const open = vi.fn();
    const error = vi.fn();
    const { container, rerender } = render(
      <MediaBubble attachment={photo} body={null} mine time="x" onThumbnailError={error} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(error).toHaveBeenCalledOnce();
    rerender(<MediaBubble attachment={photo} body={null} mine time="x" onOpen={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka foto' }));
    expect(open).toHaveBeenCalledOnce();
  });
});

describe('Bubble with an attachment', () => {
  const message = {
    body: 'lihat',
    created_at: '2026-11-17T02:25:00.000Z',
    attachments: [{ id: 'a1', ...video }],
  };

  it('renders the media bubble with the Manual tag only when asked', () => {
    const { rerender } = render(
      <Bubble message={message} mine manualTag timeZone="Asia/Jakarta" />,
    );
    expect(screen.getByTestId('media-bubble')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('09.25')).toBeInTheDocument();
    rerender(<Bubble message={message} mine={false} timeZone="Asia/Jakarta" />);
    expect(screen.queryByText('Manual')).toBeNull();
  });

  it('keeps a plain text message as a text bubble', () => {
    render(
      <Bubble
        message={{ body: 'halo', created_at: '2026-11-17T02:25:00.000Z', attachments: [] }}
        mine={false}
        timeZone="Asia/Jakarta"
      />,
    );
    expect(screen.queryByTestId('media-bubble')).toBeNull();
    expect(screen.getByText('halo')).toBeInTheDocument();
  });
});

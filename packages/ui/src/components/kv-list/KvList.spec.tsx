import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip } from '../status-chip/StatusChip';
import { KvList } from './KvList';

describe('KvList', () => {
  it('renders dt/dd pairs', () => {
    const { container } = render(
      <KvList
        items={[
          { label: 'Status', value: <StatusChip status="active" /> },
          { label: 'Mulai', value: '28 Okt 2026' },
        ]}
      />,
    );
    expect(container.querySelector('dl')).not.toBeNull();
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(container.querySelectorAll('dd')).toHaveLength(2);
    expect(screen.getByText('Mulai')).toBeInTheDocument();
    expect(screen.getByText('28 Okt 2026')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
